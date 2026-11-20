import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ScriptInput } from '../../../types/prestep.type';
import { changed, input } from './fixtures/input';
import { lockInput } from './fixtures/lockfile';

vi.mock('@actions/core', () => ({ warning: () => {} }));
const { osv } = await import('../osv.service');

/** osv.dev's records by ID, and the IDs each `name@version` matches. */
let records: Record<string, object> = {};
let matches: Record<string, string[]> = {};
let osvDown = false;
/** Every request the fake osv.dev got: the method and URL, and the body of a POST. */
const sent: string[] = [];

beforeEach(() => {
  [records, matches, osvDown, sent.length] = [{}, {}, false, 0];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push(`${init.method} ${url}${init.body ? ` ${init.body}` : ''}`);
    expect((init.headers as Record<string, string>)['user-agent']).toBe('axon-shaft-action');
    if (osvDown) return new Response('', { status: 503 });
    if (url.endsWith('/querybatch')) {
      const { queries } = JSON.parse(String(init.body));
      return Response.json({ results: queries.map((q: any) => ({ vulns: (matches[`${q.package.name}@${q.version}`] ?? []).map((id) => ({ id })) })) });
    }
    const id = decodeURIComponent(url.split('/').pop()!);
    return records[id] ? Response.json(records[id]) : new Response('', { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const record = (id: string, name: string, severity?: string, fixed?: string, aliases: string[] = []) => ({
  id,
  aliases,
  summary: `A flaw in ${name}`,
  ...(severity && { database_specific: { severity } }),
  affected: [{ package: { name, ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, ...(fixed ? [{ fixed }] : [])] }] }],
});

/** A GitHub client whose advisory API answers from `advisories`, by `affects`, or fails when `down`. */
const github = (advisories: Record<string, object[]>, down = false) => {
  const asked: string[] = [];
  const octokit = {
    request: async (route: string, o: { affects: string; ecosystem: string }) => {
      asked.push(`${route} ${o.ecosystem} ${o.affects}`);
      if (down) throw new Error('Service Unavailable');
      return { data: advisories[o.affects] ?? [] };
    },
  };
  return { asked, extra: { octokit } as unknown as Partial<ScriptInput> };
};

const show = (found: Awaited<ReturnType<typeof osv>>) => found.map((f) => `${f.severity} ${f.file}:${f.line} ${f.title}`);

test('one batch query for the public versions added or changed: a vulnerable one is a finding with its advisory, fix and line, a clean one is not', async () => {
  records = { 'GHSA-35jh-r3h4-6jhm': record('GHSA-35jh-r3h4-6jhm', 'lodash', 'HIGH', '4.17.22') };
  matches = { 'lodash@4.17.21': ['GHSA-35jh-r3h4-6jhm'] };
  const found = await osv(lockInput('package-lock.json'));
  expect(show(found)).toEqual(['blocking package-lock.json:23 lodash 4.17.21 has a known vulnerability (GHSA-35jh-r3h4-6jhm)']);
  expect(found[0]!.body).toBe(
    '`lodash` 4.17.21 has a published advisory:\n- GHSA-35jh-r3h4-6jhm (high): A flaw in lodash. Fixed in 4.17.22.\nUpgrade to a fixed version, or say in the pull request why this one is safe here.',
  );
  expect(sent).toEqual([
    'POST https://api.osv.dev/v1/querybatch {"queries":[{"package":{"name":"lodash","ecosystem":"npm"},"version":"4.17.21"},{"package":{"name":"express","ecosystem":"npm"},"version":"4.18.2"}]}',
    'GET https://api.osv.dev/v1/vulns/GHSA-35jh-r3h4-6jhm',
  ]);
});

test('scoped, private registry and git packages, removed versions and unchanged ones are never sent', async () => {
  await osv(lockInput('bun.lock'));
  const body = sent.join('\n');
  for (const name of ['@acme/ui', 'internal-kit', 'tiny', 'left-pad', 'minimist']) expect(body).not.toContain(name);
  expect(body).toContain('"lodash"');
  sent.length = 0;
  // A repo whose npm config points at its own registry sends no npm package at all.
  expect(await osv(lockInput('yarn.lock', { '.npmrc': 'registry=https://npm.acme.dev/\n' }))).toEqual([]);
  expect(await osv(input([changed('src/a.ts', ['x'])]))).toEqual([]);
  expect(sent).toEqual([]);
});

test('high, critical and malicious packages are blocking; moderate, low and unrated are should-fix; aliases merge under the GHSA ID', async () => {
  const lines = (text: string) => input([changed('requirements.txt', [])], { 'requirements.txt': text });
  const pkgs = ['a', 'b', 'c', 'd', 'e', 'f'];
  records = {
    'GHSA-aaaa': record('GHSA-aaaa', 'a', 'CRITICAL'),
    'MAL-2026-1': record('MAL-2026-1', 'b'),
    'GHSA-cccc': record('GHSA-cccc', 'c', 'MODERATE', '1.0.1'),
    'GHSA-dddd': record('GHSA-dddd', 'd', 'LOW'),
    'PYSEC-2026-5': record('PYSEC-2026-5', 'e', undefined, '2.0.0'),
    // The same flaw twice: osv.dev's PyPI record carries no rating, its GHSA alias does.
    'PYSEC-2026-6': record('PYSEC-2026-6', 'f', undefined, '1.2.0', ['GHSA-ffff']),
    'GHSA-ffff': record('GHSA-ffff', 'f', 'HIGH', '1.2.0', ['PYSEC-2026-6']),
  };
  matches = { 'a@1.0.0': ['GHSA-aaaa'], 'b@1.0.0': ['MAL-2026-1'], 'c@1.0.0': ['GHSA-cccc'], 'd@1.0.0': ['GHSA-dddd'], 'e@1.0.0': ['PYSEC-2026-5'], 'f@1.0.0': ['PYSEC-2026-6', 'GHSA-ffff'] };
  const found = await osv(lines(pkgs.map((p) => `${p}==1.0.0`).join('\n')));
  expect(show(found)).toEqual([
    'blocking requirements.txt:1 a 1.0.0 has a known vulnerability (GHSA-aaaa)',
    'blocking requirements.txt:2 b 1.0.0 has a known vulnerability (MAL-2026-1)',
    'should-fix requirements.txt:3 c 1.0.0 has a known vulnerability (GHSA-cccc)',
    'should-fix requirements.txt:4 d 1.0.0 has a known vulnerability (GHSA-dddd)',
    'should-fix requirements.txt:5 e 1.0.0 has a known vulnerability (PYSEC-2026-5)',
    'blocking requirements.txt:6 f 1.0.0 has a known vulnerability (GHSA-ffff)',
  ]);
  expect(found[1]!.body).toContain('No fixed version yet.');
  expect(found[5]!.body).toContain('- GHSA-ffff (high): A flaw in f. Fixed in 1.2.0.');
});

test("when osv.dev fails, GitHub's advisory database is asked, one call per version", async () => {
  osvDown = true;
  const { asked, extra } = github({
    'lodash@4.17.21': [{ ghsa_id: 'GHSA-35jh-r3h4-6jhm', severity: 'medium', summary: 'Prototype pollution', vulnerabilities: [{ package: { ecosystem: 'npm', name: 'lodash' }, first_patched_version: '4.17.22' }] }],
  });
  const found = await osv(lockInput('package-lock.json', {}, extra));
  expect(asked).toEqual(['GET /advisories npm lodash@4.17.21', 'GET /advisories npm express@4.18.2']);
  expect(show(found)).toEqual(['should-fix package-lock.json:23 lodash 4.17.21 has a known vulnerability (GHSA-35jh-r3h4-6jhm)']);
  expect(found[0]!.body).toContain('- GHSA-35jh-r3h4-6jhm (medium): Prototype pollution. Fixed in 4.17.22.');
});

test('when both fail, or the fallback checks only some versions and finds nothing, it throws, so the checklist is skipped and never passes', async () => {
  osvDown = true;
  await expect(osv(lockInput('Cargo.lock', {}, github({}, true).extra))).rejects.toThrow(
    "osv.dev and GitHub's advisory database both failed (osv.dev answered 503; Service Unavailable), so no package was checked.",
  );
  const many = input([changed('requirements.txt', [])], { 'requirements.txt': Array.from({ length: 60 }, (_, i) => `p${i}==1.0.0`).join('\n') }, github({}).extra);
  await expect(osv(many)).rejects.toThrow("GitHub's advisory database checked only 50 of the 60 versions, finding nothing.");
});
