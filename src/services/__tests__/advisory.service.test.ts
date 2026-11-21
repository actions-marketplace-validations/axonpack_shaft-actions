import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Placed } from '../../utils/render.util';

const logs: string[] = [];
vi.doMock('@actions/core', () => ({
  getIDToken: async () => 'oidc',
  info: (s: string) => logs.push(`info ${s}`),
  warning: (s: string) => logs.push(`warning ${s}`),
}));
const { openAdvisories, WITHHELD_TITLE, withheldBody } = await import('../advisory.service');

/** What the fake API got, and how it answers: a draft per fingerprint (public repo when `withhold`), or a refusal. */
const sent: unknown[] = [];
let answer: (fp: string) => Response;
beforeEach(() => {
  logs.length = 0;
  sent.length = 0;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://oidc.example';
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('https://api-shaft.axonpack.dev/v1/advisories');
    const body = JSON.parse(init.body as string);
    sent.push(body);
    return answer(body.fp);
  });
});
afterEach(() => vi.unstubAllGlobals());

const draft = (withhold: boolean) => (fp: string) => Response.json({ ghsa_id: `GHSA-${fp}`, html_url: `https://github.com/o/r/security/advisories/GHSA-${fp}`, withhold });
const finding = (fp: string, step = 'security', severity: Placed['severity'] = 'blocking'): Placed => ({
  fp,
  step,
  severity,
  file: 'src/db.ts',
  line: 4,
  title: 'SQL built from the request',
  body: 'The `id` query goes into the SQL string: `?id=1 OR 1=1` reads every row.',
  suggestion: 'db.query("select * from t where id = $1", [id])',
  inline: true,
});
const options = { pull: 7, dryRun: false, clean: (s: string) => s.replace('OR 1=1', '***') };

test('on a public repo each blocking security finding links to its draft, and its title, body and suggestion give way to the short note; the fingerprint stays', async () => {
  answer = draft(true);
  const placed = [finding('aaa111'), finding('bbb222', 'security', 'should-fix'), finding('ccc333', 'correctness')];
  expect(await openAdvisories(placed, options)).toBeUndefined();
  expect(sent).toEqual([{ fp: 'aaa111', title: 'SQL built from the request', body: 'The `id` query goes into the SQL string: `?id=1 ***` reads every row.', file: 'src/db.ts', line: 4, pull: 7 }]);
  const url = 'https://github.com/o/r/security/advisories/GHSA-aaa111';
  expect(placed[0]).toEqual({ fp: 'aaa111', step: 'security', severity: 'blocking', file: 'src/db.ts', line: 4, inline: true, url, title: WITHHELD_TITLE, body: withheldBody(url) });
  expect(withheldBody(url)).toBe(
    `Axon Shaft found a blocking security issue on these lines. The details are in a [private draft security advisory](${url}) that the repo's admins and security managers can open.`,
  );
  expect(placed.slice(1).map((p) => p.title)).toEqual(['SQL built from the request', 'SQL built from the request']);
  expect(logs).toEqual([]);
});

test('on a private repo the finding keeps its text and links to its draft; only the first 3 are asked for', async () => {
  answer = draft(false);
  const placed = ['a1', 'a2', 'a3', 'a4'].map((fp) => finding(fp));
  await openAdvisories(placed, options);
  expect(sent.map((s) => (s as { fp: string }).fp)).toEqual(['a1', 'a2', 'a3']);
  expect(placed[0]).toMatchObject({ title: 'SQL built from the request', suggestion: finding('a1').suggestion, url: 'https://github.com/o/r/security/advisories/GHSA-a1' });
  expect(placed[3]!.url).toBeUndefined();
});

test("a refused or failed request keeps the finding as it is, warns without the finding's text, and gives the summary one line", async () => {
  answer = (fp) => (fp === 'aaa111' ? Response.json({ error: 'advisory_failed', message: 'This run already opened 3 drafts.' }, { status: 403 }) : new Response('', { status: 502 }));
  const placed = [finding('aaa111'), finding('bbb222')];
  expect(await openAdvisories(placed, options)).toBe(
    "Couldn't open a private draft advisory for `aaa111` (This run already opened 3 drafts), `bbb222` (The Axon Shaft API answered 502. Rerun the job in a few minutes), so those findings show in full.",
  );
  expect(placed).toEqual([finding('aaa111'), finding('bbb222')]);
  expect(logs).toEqual([
    'warning Couldn\'t open a draft advisory for aaa111, so the finding is posted as it is: This run already opened 3 drafts',
    "warning Couldn't open a draft advisory for bbb222, so the finding is posted as it is: The Axon Shaft API answered 502. Rerun the job in a few minutes",
  ]);
  for (const l of logs) expect(l).not.toContain('SQL');
});

test('a dry run asks for nothing and logs which drafts it would open', async () => {
  const placed = [finding('aaa111')];
  expect(await openAdvisories(placed, { ...options, dryRun: true })).toBeUndefined();
  expect(sent).toEqual([]);
  expect(placed).toEqual([finding('aaa111')]);
  expect(logs).toEqual(['info Would open a draft advisory for aaa111']);
});
