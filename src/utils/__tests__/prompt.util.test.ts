import { describe, expect, test } from 'vitest';
import { diffText, generatedGlobs, trimmed } from '../prompt.util';

const file = (filename: string) => ({ filename, status: 'modified', additions: 300, deletions: 20, patch: '@@ -1 +1 @@\n-old\n+SECRET_PATCH' });

describe('the trimmed diff', () => {
  test('lockfiles, snapshots, minified files and dist leave the diff as one line', () => {
    for (const name of ['bun.lock', 'apps/web/package-lock.json', 'src/__snapshots__/a.test.ts.snap', 'public/app.min.js', 'dist/index.js']) {
      const text = diffText([file(name)], []);
      expect(text).toContain(`diff --git a/${name}`);
      expect(text).toContain('+300 -20 lines');
      expect(text).not.toContain('SECRET_PATCH');
    }
  });

  test('other files keep their patch', () => {
    expect(diffText([file('src/app.ts'), file('src/dist.ts')], [])).toContain('SECRET_PATCH');
    expect(trimmed('src/distance/a.ts')).toBe(false);
  });

  test('.gitattributes linguist-generated, at any depth or from the root, and not when set false', () => {
    const globs = generatedGlobs('# comment\n*.pb.go linguist-generated\n/gen/ linguist-generated=true\napi/schema.ts -diff linguist-generated\nkeep.ts linguist-generated=false\n');
    expect(trimmed('a.pb.go', globs)).toBe(true);
    expect(trimmed('x/y/a.pb.go', globs)).toBe(true);
    expect(trimmed('gen/a.ts', globs)).toBe(true);
    expect(trimmed('api/schema.ts', globs)).toBe(true);
    expect(trimmed('keep.ts', globs)).toBe(false);
    expect(trimmed('src/api/schema.ts', globs)).toBe(false);
    expect(diffText([file('x/a.pb.go')], [], globs)).not.toContain('SECRET_PATCH');
  });
});
