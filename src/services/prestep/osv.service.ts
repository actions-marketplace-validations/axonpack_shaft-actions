import * as core from '@actions/core';
import type { Octokit } from '../../types/octokit.type';
import type { NetworkScript } from '../../types/prestep.type';
import type { Ecosystem, Pin } from '../../utils/lockfile.util';
import { depsDiff } from './deps-diff.service';

const OSV = 'https://api.osv.dev/v1';
/** Names the client and nothing about the repo or who runs it. */
const USER_AGENT = 'axon-shaft-action';
const CALL_MS = 10_000;
const TOTAL_MS = 60_000;
/** osv.dev's limit on one `querybatch`. */
const BATCH = 1000;
/** GitHub's advisory API takes one package a call, so the fallback checks at most this many. */
const GITHUB_MAX = 50;
const GITHUB_ECOSYSTEM: Record<Ecosystem, string> = { npm: 'npm', PyPI: 'pip', Go: 'go', 'crates.io': 'rust' };
const RANK: Record<string, number> = { critical: 4, high: 3, moderate: 2, medium: 2, low: 1 };

type Checked = Pin & { file: string; ecosystem: Ecosystem };
type Advisory = { id: string; severity: string; summary: string; fixed: string[] };
type Signal = () => AbortSignal;

async function getJson(url: string, signal: AbortSignal, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'user-agent': USER_AGENT, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) throw new Error(`osv.dev answered ${res.status}`);
  return res.json();
}

/** One advisory from an osv.dev record: its GHSA ID when it has one, its rating, and the versions that fix `name`. */
function fromOsvRecord(v: any, name: string): Advisory {
  const ids: string[] = [v.id, ...(v.aliases ?? [])];
  const affected = (v.affected ?? []).filter((a: any) => String(a.package?.name).toLowerCase() === name.toLowerCase());
  return {
    id: ids.find((id) => id.startsWith('GHSA-')) ?? v.id,
    // A MAL- record is a malicious package, which osv.dev doesn't rate.
    severity: v.id.startsWith('MAL-') ? 'critical' : String(v.database_specific?.severity ?? 'unrated').toLowerCase(),
    summary: v.summary ?? '',
    fixed: affected.flatMap((a: any) => (a.ranges ?? []).filter((r: any) => r.type !== 'GIT').flatMap((r: any) => r.events ?? [])).flatMap((e: any) => (e.fixed ? [e.fixed] : [])),
  };
}

/** One `querybatch` per 1,000 versions, then each advisory found, once. Any failed call fails the lot. */
async function fromOsv(pins: Checked[], signal: Signal): Promise<Advisory[][]> {
  const ids: string[][] = [];
  for (let i = 0; i < pins.length; i += BATCH) {
    const queries = pins.slice(i, i + BATCH).map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version }));
    const { results } = await getJson(`${OSV}/querybatch`, signal(), { queries });
    for (const r of results) ids.push((r.vulns ?? []).map((v: { id: string }) => v.id));
  }
  const unique = [...new Set(ids.flat())];
  const records = new Map(await Promise.all(unique.map(async (id) => [id, await getJson(`${OSV}/vulns/${encodeURIComponent(id)}`, signal())] as const)));
  return pins.map((p, i) => (ids[i] ?? []).map((id) => fromOsvRecord(records.get(id), p.name)));
}

/** GitHub's advisory database, one call per version, with the run's token. */
function fromGitHub(octokit: Octokit, pins: Checked[], signal: Signal): Promise<Advisory[][]> {
  return Promise.all(
    pins.map(async (p) => {
      const { data } = await octokit.request('GET /advisories', {
        affects: `${p.name}@${p.version}`,
        ecosystem: GITHUB_ECOSYSTEM[p.ecosystem] as 'npm',
        per_page: 100,
        request: { signal: signal() },
      });
      return data.map((a) => ({
        id: a.ghsa_id,
        severity: a.severity,
        summary: a.summary,
        fixed: (a.vulnerabilities ?? [])
          .filter((v) => v.package?.name === p.name)
          .flatMap((v) => {
            const fix = v.first_patched_version as string | { identifier?: string } | null;
            const version = typeof fix === 'string' ? fix : fix?.identifier;
            return version ? [version] : [];
          }),
      }));
    }),
  );
}

/** A package version's advisories as one finding: blocking when any is high or critical. Records that alias each other are merged. */
function finding(p: Checked, found: Advisory[]) {
  const byId = new Map<string, Advisory>();
  for (const a of found) {
    const seen = byId.get(a.id);
    byId.set(a.id, seen ? { ...seen, severity: (RANK[a.severity] ?? 0) > (RANK[seen.severity] ?? 0) ? a.severity : seen.severity, fixed: [...seen.fixed, ...a.fixed] } : a);
  }
  const all = [...byId.values()].sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0));
  const fixed = [...new Set(all.flatMap((a) => a.fixed))];
  return {
    severity: all.some((a) => (RANK[a.severity] ?? 0) >= RANK.high!) ? ('blocking' as const) : ('should-fix' as const),
    file: p.file,
    line: p.line,
    title: `${p.name} ${p.version} has a known vulnerability (${all[0]!.id}${all.length > 1 ? ` and ${all.length - 1} more` : ''})`,
    body: [
      `\`${p.name}\` ${p.version} has ${all.length === 1 ? 'a published advisory' : `${all.length} published advisories`}:`,
      ...all.map((a) => `- ${a.id} (${a.severity})${a.summary ? `: ${a.summary}` : ''}. ${a.fixed.length ? `Fixed in ${[...new Set(a.fixed)].join(', ')}.` : 'No fixed version yet.'}`),
      fixed.length ? `Upgrade to a fixed version, or say in the pull request why this one is safe here.` : `No version fixes it yet, so say in the pull request why it's safe here or pick another package.`,
    ].join('\n'),
  };
}

/**
 * Advisories for each version a lockfile adds or changes, from osv.dev, or from GitHub's advisory
 * database when osv.dev fails. Only public packages are sent: never a scoped (`@x/y`) package, a
 * private registry's, git or URL package, or a version the pull request leaves as it was. When
 * neither source answers, this throws, so the checklist is skipped and never passes.
 */
export const osv: NetworkScript = async (input) => {
  const pins: Checked[] = (await depsDiff(input)).flatMap(({ file, ecosystem, changes }) =>
    changes.flatMap((c) => c.to.filter((p) => p.public && !p.name.startsWith('@')).map((p) => ({ ...p, file, ecosystem }))),
  );
  if (!pins.length) return [];
  const total = AbortSignal.timeout(TOTAL_MS);
  const signal = () => AbortSignal.any([total, AbortSignal.timeout(CALL_MS)]);
  let found: Advisory[][];
  try {
    found = await fromOsv(pins, signal);
  } catch (e) {
    const why = (e as Error).message;
    core.warning(`osv.dev failed (${why}), so GitHub's advisory database is asked instead.`);
    try {
      found = await fromGitHub(input.octokit, pins.slice(0, GITHUB_MAX), signal);
    } catch (e2) {
      throw new Error(`osv.dev and GitHub's advisory database both failed (${why}; ${(e2 as Error).message}), so no package was checked.`);
    }
    // Unchecked versions with nothing found would read as a pass.
    if (pins.length > GITHUB_MAX && !found.flat().length) {
      throw new Error(`osv.dev failed (${why}), and GitHub's advisory database checked only ${GITHUB_MAX} of the ${pins.length} versions, finding nothing.`);
    }
  }
  return pins.flatMap((p, i) => (found[i]?.length ? [finding(p, found[i])] : []));
};
