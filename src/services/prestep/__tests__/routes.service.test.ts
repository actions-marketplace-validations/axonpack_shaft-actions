import { expect, test } from 'vitest';
import { routes } from '../routes.service';
import { changed, input } from './fixtures/input';

const api = [
  "app.get('/health', (c) => c.text('ok'));",
  ...Array(20).fill(''),
  "app.use('/users', requireAuth);",
  "app.delete('/users/:id', async (c) => {",
  '  await db.delete(users).where(eq(users.id, c.req.param("id")));',
  '});',
];

test('each added route with its method and path, and the auth lines near it in the checkout', async () => {
  const files = [
    changed('src/api.ts', api),
    changed('app/api/items/route.ts', ['export async function POST(req: Request) {', '  const session = await getSession();']),
    changed('app/views.py', ['@app.post("/items")', 'def create_item(item: Item, user = Depends(current_user)):']),
    changed('src/cache.ts', ["cache.get('key');"]),
  ];
  const tree = { 'src/api.ts': api.join('\n'), 'app/api/items/route.ts': 'export async function POST(req: Request) {\n  const session = await getSession();', 'app/views.py': '' };
  expect((await routes(input(files, tree))).split('\n')).toEqual([
    '- src/api.ts:1 GET /health: no auth call within 15 lines',
    "- src/api.ts:23 DELETE /users/:id: auth nearby: line 22 `app.use('/users', requireAuth);`",
    '- app/api/items/route.ts:1 POST (path from the file): auth nearby: line 2 `const session = await getSession();`',
    '- app/views.py:1 POST /items: no auth call within 15 lines',
  ]);
});

test('no route says so, and a file the checkout lacks says so', async () => {
  expect(await routes(input([changed('src/a.ts', ['const x = 1;'])]))).toBe('The added lines define no route.');
  expect(await routes(input([changed('src/r.ts', ["router.post('/x', h);"])]))).toBe("- src/r.ts:1 POST /x: the checkout doesn't have the file");
});
