import { beforeEach, expect, test, vi } from 'vitest';

const warnings: string[] = [];
vi.doMock('@actions/core', () => ({ warning: (s: string) => warnings.push(s) }));
const { collectContext } = await import('../context.service');

const say = (login: string, author_association: string, type = 'User') => ({ id: 1, user: { login, type }, author_association, body: `from ${login}` });

/** A fake Octokit with these comments, where `permissions` answers the permission endpoint (a missing login fails). */
function octokit(issueComments: object[], reviewComments: object[], permissions: Record<string, string>) {
  const asked: string[] = [];
  const [listFiles, listCommits, listComments, listReviewComments] = [0, 1, 2, 3].map(() => async () => ({}));
  const lists = new Map<unknown, unknown[]>([
    [listFiles, []],
    [listCommits, []],
    [listComments, issueComments],
    [listReviewComments, reviewComments],
  ]);
  return {
    asked,
    paginate: async (fn: unknown) => lists.get(fn),
    rest: {
      pulls: {
        get: async () => ({ data: { title: 't', body: '', user: { login: 'author' }, head: { sha: 'abc', ref: 'feature' }, base: { ref: 'main' } } }),
        listFiles,
        listCommits,
        listReviewComments,
      },
      issues: { listComments },
      repos: {
        getContent: async () => {
          throw Object.assign(new Error('Not Found'), { status: 404 });
        },
        getCollaboratorPermissionLevel: async ({ username }: { username: string }) => {
          asked.push(username);
          if (!(username in permissions)) throw new Error('Resource not accessible by integration');
          return { data: { permission: permissions[username] } };
        },
      },
    },
  };
}

const trusted = async (fake: ReturnType<typeof octokit>) => {
  const ctx = await collectContext(fake as any, 'o', 'r', 7, 'axonshaft[bot]');
  return [...ctx.comments, ...ctx.reviewComments].filter((c) => c.trusted).map((c) => c.author);
};

beforeEach(() => {
  warnings.length = 0;
});

test('an author the association leaves out is trusted with write access on the repo, and dropped with read', async () => {
  const fake = octokit(
    [say('lead', 'MEMBER'), say('teammate', 'CONTRIBUTOR'), say('private-member', 'NONE'), say('reader', 'CONTRIBUTOR'), say('helper[bot]', 'NONE', 'Bot')],
    [],
    { teammate: 'write', 'private-member': 'admin', reader: 'read' },
  );
  expect(await trusted(fake)).toEqual(['lead', 'teammate', 'private-member']);
  // Inside associations and bots are never asked about.
  expect(fake.asked).toEqual(['teammate', 'private-member', 'reader']);
});

test('a failed permission call drops the author with one warning', async () => {
  const fake = octokit([say('someone', 'CONTRIBUTOR'), say('someone', 'CONTRIBUTOR')], [say('someone', 'CONTRIBUTOR')], {});
  expect(await trusted(fake)).toEqual([]);
  expect(warnings).toEqual(["Couldn't check someone's access to the repo, so their comments are left out of the review: Resource not accessible by integration"]);
});

test('each login is asked about once per run, across comments and review threads', async () => {
  const fake = octokit([say('teammate', 'CONTRIBUTOR'), say('teammate', 'CONTRIBUTOR')], [say('teammate', 'CONTRIBUTOR')], { teammate: 'write' });
  expect(await trusted(fake)).toEqual(['teammate', 'teammate', 'teammate']);
  expect(fake.asked).toEqual(['teammate']);
});
