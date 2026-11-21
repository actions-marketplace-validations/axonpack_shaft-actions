import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { input } from './fixtures/input';

vi.doMock('@actions/core', () => ({ getIDToken: async () => 'oidc' }));
const { codeQuality } = await import('../code-quality.service');

/** What the fake Axon Shaft API got, and its answer to `POST /v1/code-quality`. */
const sent: string[] = [];
let answer: () => Response;
beforeEach(() => {
  sent.length = 0;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://oidc.example';
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push(`${init.method} ${url} ${init.body}`);
    return answer();
  });
});
afterEach(() => vi.unstubAllGlobals());

/** `src/pay.ts` changes lines 10 to 12 of the base into 10 to 13. */
const files = [{ filename: 'src/pay.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -10,3 +10,4 @@\n ctx\n-old\n+new\n+more\n ctx' }];
const finding = (number: number, path: string, start_line: number, severity: string) => ({
  number,
  path,
  start_line,
  end_line: start_line,
  severity,
  title: 'Unused variable',
  message_markdown: 'Variable `x` is never read.',
});

test("the findings in a hunk's old side are reported at its first new line, error as should-fix and the rest as nits; the others are dropped", async () => {
  answer = () => Response.json([finding(4, 'src/pay.ts', 11, 'error'), finding(5, 'src/pay.ts', 12, 'warning'), finding(6, 'src/pay.ts', 40, 'error'), finding(7, 'src/other.ts', 11, 'error')]);
  expect(await codeQuality(input(files))).toEqual([
    {
      severity: 'should-fix',
      file: 'src/pay.ts',
      line: 10,
      title: 'Unused variable',
      body: "Variable `x` is never read.\n\nFinding #4 on the default branch, under the repo's Security and quality tab, Code quality.",
    },
    expect.objectContaining({ severity: 'nit', line: 10, body: expect.stringContaining('Finding #5 ') }),
  ]);
  expect(sent).toEqual(['POST https://api-shaft.axonpack.dev/v1/code-quality {}']);
});

test("the API's refusal skips the checklist with its message", async () => {
  answer = () => Response.json({ error: 'code_quality_failed', message: "GitHub Code Quality isn't on for this repo." }, { status: 403 });
  await expect(codeQuality(input(files))).rejects.toThrow("GitHub Code Quality isn't on for this repo.");
  answer = () => Response.json({ findings: [] });
  await expect(codeQuality(input(files))).rejects.toThrow('The Axon Shaft API sent an incomplete answer');
});

test("a pull request into a branch that isn't the default is skipped without asking the API", async () => {
  const into = input(files);
  await expect(codeQuality({ ...into, pr: { ...into.pr, base: 'release' } })).rejects.toThrow(
    "GitHub Code Quality's findings are the default branch's (main), and this pull request goes into release",
  );
  expect(sent).toEqual([]);
});
