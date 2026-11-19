import { expect, test } from 'vitest';
import { pushDenial } from '../push.util';

const pr = { defaultBranch: 'main', pullBranch: 'fix-login' };

test.each([
  ['disabled', { ...pr, branch: 'fix-login' }, /turned off/],
  ['', { ...pr, branch: 'fix-login' }, /turned off/],
  ['always', { ...pr, branch: 'fix-login' }, /turned off/],
  ['restricted', { ...pr, branch: 'fix-login' }, undefined],
  ['restricted', { ...pr, branch: 'main' }, /default branch/],
  ['restricted', { ...pr, branch: 'other' }, /only to the pull request's branch, fix-login, not other/],
  ['restricted', { defaultBranch: 'main', branch: 'shaft/issue-3-x' }, /own branch/],
  ['restricted', { ...pr, branch: 'fix-login', fork: true }, /own branch/],
  ['enabled', { ...pr, branch: 'fix-login' }, undefined],
  ['enabled', { defaultBranch: 'main', branch: 'shaft/issue-3-x' }, undefined],
  ['enabled', { ...pr, branch: 'main' }, /default branch/],
])('%s push to %o', (mode, target, why) => {
  const out = pushDenial(mode, target);
  if (why) expect(out).toMatch(why);
  else expect(out).toBeUndefined();
});
