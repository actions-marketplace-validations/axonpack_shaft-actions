import { expect, test } from 'vitest';
import { newFiles } from '../new-files.service';
import { changed, input } from './fixtures/input';

const added = (filename: string, lines: string[] = ['x']) => ({ ...changed(filename, lines), status: 'added' });

test('each added or moved file with its folder, suffix and name case, and how many components a tsx file exports', async () => {
  const files = [
    added('src/services/user-profile.service.ts'),
    added('src/components/UserCard.tsx', ['export function UserCard() {}', 'export const UserAvatar = () => null;', 'const local = 1;']),
    added('src/routes/[id]/index.ts'),
    added('Dockerfile'),
    added('src/.env.example'),
    added('app/order_items.py'),
    { ...changed('src/utils/formatDate.ts', []), status: 'renamed' },
    changed('src/main.ts', ['x']),
  ];
  expect(await newFiles(input(files))).toBe(
    [
      'Added and moved files:',
      '- src/services/user-profile.service.ts (added): folder src/services/, suffix .service.ts, kebab-case',
      '- src/components/UserCard.tsx (added): folder src/components/, suffix .tsx, PascalCase, exports 2 components',
      '- src/routes/[id]/index.ts (added): folder src/routes/[id]/, suffix .ts, lowercase',
      '- Dockerfile (added): folder ./, suffix none, PascalCase',
      '- src/.env.example (added): folder src/, suffix .example, mixed',
      '- app/order_items.py (added): folder app/, suffix .py, snake_case',
      '- src/utils/formatDate.ts (moved here): folder src/utils/, suffix .ts, camelCase',
    ].join('\n'),
  );
  expect(await newFiles(input([changed('src/main.ts', ['x'])]))).toBe('');
});
