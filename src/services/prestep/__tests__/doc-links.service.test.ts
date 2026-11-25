import { expect, test } from 'vitest';
import { docLinks } from '../doc-links.service';
import { changed, input } from './fixtures/input';

const tree = { 'docs/guide.md': '# Guide\n## Set up `x`\n## Set up `x`\n', 'docs/img/a.png': 'x', 'README.md': '# Hi' };

test('a link to a missing file blocks, a missing heading is should-fix, and good links pass', () => {
  const file = changed('docs/guide.md', [
    '[a](./missing.md) [b](guide.md#nope)',
    '[ok](../README.md) ![img](img/a.png) [same](#set-up-x-1) [dir](img/) [web](https://x.dev/y) [site](/docs/z) [mail](mailto:a@b.c)',
  ]);
  expect(docLinks(input([file], tree)).map((f) => `${f.severity} ${f.line} ${f.title}`)).toEqual([
    'blocking 1 Broken link: `./missing.md`',
    'should-fix 1 Link to a missing heading: `#nope`',
  ]);
});
