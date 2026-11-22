import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ScriptInput } from '../../../types/prestep.type';
import { changed, input } from './fixtures/input';
import { lockInput } from './fixtures/lockfile';

vi.mock('@actions/core', () => ({ warning: () => {}, getIDToken: async () => 'oidc' }));
const { osv } = await import('../osv.service');

const API = 'https://api-shaft.axonpack.dev/v1/packages/check';
/** osv.dev's records by ID, and the IDs each `name@version` matches. */
let records: Record<string, object> = {};
let matches: Record<string, string[]> = {};
let osvDown = false;
/** The Axon Shaft API's answer to `POST /v1/packages/check`; by default an older API's, which has no such route. */
let api: (body: any) => Response;
const olderApi = () => new Response('', { status: 403 });
/** Every request osv.dev or the API got: the method and URL, and the body of a POST. */
const sent: string[] = [];

beforeEach(() => {
  [records, matches, osvDown, sent.length, api] = [{}, {}, false, 0, olderApi];
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://oidc.example';
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push(`${init.method} ${url}${init.body ? ` ${init.body}` : ''}`);
    if (url === API) return api(JSON.parse(String(init.body)));
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
    '`lodash` 4.17.21 has a published advisory:\n- [GHSA-35jh-r3h4-6jhm](https://github.com/advisories/GHSA-35jh-r3h4-6jhm) (high): A flaw in lodash. Fixed in 4.17.22.\nUpgrade to a fixed version, or say in the pull request why this one is safe here.',
  );
  expect(found[0]!.url).toBe('https://github.com/advisories/GHSA-35jh-r3h4-6jhm');
  // The older API has no POST /v1/packages/check, so osv.dev is asked straight.
  expect(sent[0]).toBe(`POST ${API} {"packages":[{"ecosystem":"npm","name":"lodash","version":"4.17.21"},{"ecosystem":"npm","name":"express","version":"4.18.2"}],"check":["vulnerabilities"]}`);
  expect(sent.slice(1)).toEqual([
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
  expect(found[5]!.body).toContain('- [GHSA-ffff](https://github.com/advisories/GHSA-ffff) (high): A flaw in f. Fixed in 1.2.0.');
  // An ID with no GHSA alias links to its record on osv.dev.
  expect(found.map((f) => f.url)).toEqual([
    'https://github.com/advisories/GHSA-aaaa',
    'https://osv.dev/vulnerability/MAL-2026-1',
    'https://github.com/advisories/GHSA-cccc',
    'https://github.com/advisories/GHSA-dddd',
    'https://osv.dev/vulnerability/PYSEC-2026-5',
    'https://github.com/advisories/GHSA-ffff',
  ]);
  expect(found[4]!.body).toContain('- [PYSEC-2026-5](https://osv.dev/vulnerability/PYSEC-2026-5) (unrated)');
});

test("a package with several advisories links to the most severe one's page", async () => {
  records = { 'GHSA-low1': record('GHSA-low1', 'lodash', 'LOW'), 'RUSTSEC-2026-1': record('RUSTSEC-2026-1', 'lodash', 'CRITICAL') };
  matches = { 'lodash@4.17.21': ['GHSA-low1', 'RUSTSEC-2026-1'] };
  const [found] = await osv(lockInput('package-lock.json'));
  expect(found!.url).toBe('https://osv.dev/vulnerability/RUSTSEC-2026-1');
  expect(found!.body).toContain('- [GHSA-low1](https://github.com/advisories/GHSA-low1) (low)');
});

test("when osv.dev fails, GitHub's advisory database is asked, one call per version, and each advisory links to its html_url", async () => {
  osvDown = true;
  const { asked, extra } = github({
    'lodash@4.17.21': [{ ghsa_id: 'GHSA-35jh-r3h4-6jhm', html_url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm', severity: 'medium', summary: 'Prototype pollution', vulnerabilities: [{ package: { ecosystem: 'npm', name: 'lodash' }, first_patched_version: '4.17.22' }] }],
  });
  const found = await osv(lockInput('package-lock.json', {}, extra));
  expect(asked).toEqual(['GET /advisories npm lodash@4.17.21', 'GET /advisories npm express@4.18.2']);
  expect(show(found)).toEqual(['should-fix package-lock.json:23 lodash 4.17.21 has a known vulnerability (GHSA-35jh-r3h4-6jhm)']);
  expect(found[0]!.body).toContain('- [GHSA-35jh-r3h4-6jhm](https://github.com/advisories/GHSA-35jh-r3h4-6jhm) (medium): Prototype pollution. Fixed in 4.17.22.');
  expect(found[0]!.url).toBe('https://github.com/advisories/GHSA-35jh-r3h4-6jhm');
});

test('when both fail, or the fallback checks only some versions and finds nothing, it throws, so the checklist is skipped and never passes', async () => {
  osvDown = true;
  await expect(osv(lockInput('Cargo.lock', {}, github({}, true).extra))).rejects.toThrow(
    "osv.dev and GitHub's advisory database both failed (osv.dev answered 503; Service Unavailable), so no package was checked.",
  );
  const many = input([changed('requirements.txt', [])], { 'requirements.txt': Array.from({ length: 60 }, (_, i) => `p${i}==1.0.0`).join('\n') }, github({}).extra);
  await expect(osv(many)).rejects.toThrow("GitHub's advisory database checked only 50 of the 60 versions, finding nothing.");
});

test('the Axon Shaft API answers: it gets only each public version once, osv.dev is never asked, and the findings read as before', async () => {
  const advisory = { id: 'GHSA-35jh-r3h4-6jhm', url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm', severity: 'high', summary: 'A flaw in lodash', fixed: ['4.17.22'] };
  api = ({ packages }) => Response.json({ vulnerabilities: packages.map((p: any) => ({ ...p, advisories: p.name === 'lodash' ? [advisory] : [] })), licences: [] });
  const found = await osv(lockInput('package-lock.json'));
  expect(sent).toEqual([
    `POST ${API} {"packages":[{"ecosystem":"npm","name":"lodash","version":"4.17.21"},{"ecosystem":"npm","name":"express","version":"4.18.2"}],"check":["vulnerabilities"]}`,
  ]);
  expect(show(found)).toEqual(['blocking package-lock.json:23 lodash 4.17.21 has a known vulnerability (GHSA-35jh-r3h4-6jhm)']);
  expect(found[0]!.body).toBe(
    '`lodash` 4.17.21 has a published advisory:\n- [GHSA-35jh-r3h4-6jhm](https://github.com/advisories/GHSA-35jh-r3h4-6jhm) (high): A flaw in lodash. Fixed in 4.17.22.\nUpgrade to a fixed version, or say in the pull request why this one is safe here.',
  );
  // The scoped, private and unchanged packages of a Bun lockfile never reach the API either.
  sent.length = 0;
  await osv(lockInput('bun.lock'));
  for (const name of ['@acme/ui', 'internal-kit', 'tiny', 'left-pad', 'minimist']) expect(sent.join('\n')).not.toContain(name);
});

test("the API's refusal skips the checklist, versions it left out with nothing found throw, and an older API's 404 falls back to osv.dev", async () => {
  api = () => Response.json({ error: 'packages_check_failed', message: "osv.dev and GitHub's advisory database both failed." }, { status: 502 });
  await expect(osv(lockInput('package-lock.json'))).rejects.toThrow("osv.dev and GitHub's advisory database both failed.");
  api = ({ packages }) => Response.json({ vulnerabilities: [{ ...packages[0], advisories: [] }], licences: [] });
  await expect(osv(lockInput('package-lock.json'))).rejects.toThrow('The Axon Shaft API checked only 1 of the 2 versions, finding nothing.');
  expect(sent.every((s) => s.startsWith(`POST ${API}`))).toBe(true);
  api = () => new Response('Not Found', { status: 404 });
  matches = { 'lodash@4.17.21': ['GHSA-x'] };
  records = { 'GHSA-x': record('GHSA-x', 'lodash', 'LOW') };
  expect(show(await osv(lockInput('package-lock.json')))).toEqual(['should-fix package-lock.json:23 lodash 4.17.21 has a known vulnerability (GHSA-x)']);
  expect(sent.at(-2)).toContain('POST https://api.osv.dev/v1/querybatch');
});
