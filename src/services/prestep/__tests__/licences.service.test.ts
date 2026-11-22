import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { lockInput } from './fixtures/lockfile';

vi.mock('@actions/core', () => ({ getIDToken: async () => 'oidc' }));
const { licences } = await import('../licences.service');

const API = 'https://api-shaft.axonpack.dev/v1/packages/check';
/** The fake Axon Shaft API's licence for each package by name; a name it lacks is left out of the answer. */
let declared: Record<string, { licence: string; denied: boolean }> = {};
let answer: ((body: any) => Response) | undefined;
const sent: string[] = [];

beforeEach(() => {
  [declared, answer, sent.length] = [{}, undefined, 0];
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://oidc.example';
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push(`${init.method} ${url} ${init.body}`);
    if (url !== API) return new Response('', { status: 599 });
    const body = JSON.parse(String(init.body));
    if (answer) return answer(body);
    return Response.json({ vulnerabilities: [], licences: body.packages.flatMap((p: any) => (declared[p.name] ? [{ ...p, ...declared[p.name] }] : [])) });
  });
});
afterEach(() => vi.unstubAllGlobals());

const show = (found: Awaited<ReturnType<typeof licences>>) => found.map((f) => `${f.severity} ${f.file}:${f.line} ${f.title}`);

test('only the public packages a lockfile adds are sent; a denied licence is blocking, none declared should-fix, the rest pass', async () => {
  declared = { express: { licence: 'GPL-3.0-only', denied: true } };
  const found = await licences(lockInput('package-lock.json'));
  // Not the upgraded lodash, the scoped @acme/ui or the private internal-kit.
  expect(sent).toEqual([`POST ${API} {"packages":[{"ecosystem":"npm","name":"express","version":"4.18.2"}],"check":["licences"]}`]);
  expect(show(found)).toEqual(['blocking package-lock.json:18 express 4.18.2 is licensed GPL-3.0-only']);
  expect(found[0]!.body).toBe(
    "`express` 4.18.2 declares the licence `GPL-3.0-only`, which is strong copyleft and on the deny list. Pick another package, or say in the pull request why it's fine here.",
  );
  declared = { tokio: { licence: 'unknown', denied: false } };
  expect(show(await licences(lockInput('Cargo.lock')))).toEqual(['should-fix Cargo.lock:25 tokio 1.35.0 declares no licence']);
  declared = { flask: { licence: 'BSD-3-Clause', denied: false } };
  expect(await licences(lockInput('poetry.lock'))).toEqual([]);
  // Go has no registry that declares a licence, so nothing is sent.
  sent.length = 0;
  expect(await licences(lockInput('go.sum'))).toEqual([]);
  expect(sent).toEqual([]);
});

test("an older API, the API's refusal, or a version left out with nothing found: it throws, so the checklist is skipped", async () => {
  await expect(licences(lockInput('package-lock.json'))).rejects.toThrow('The Axon Shaft API checked only 0 of the 1 licences, finding nothing.');
  answer = () => new Response('', { status: 403 });
  await expect(licences(lockInput('package-lock.json'))).rejects.toThrow("The Axon Shaft API doesn't look up licences yet, so no package was checked.");
  answer = () => Response.json({ error: 'packages_check_failed', message: 'This run has no open review on a pull request.' }, { status: 403 });
  await expect(licences(lockInput('package-lock.json'))).rejects.toThrow('This run has no open review on a pull request.');
});
