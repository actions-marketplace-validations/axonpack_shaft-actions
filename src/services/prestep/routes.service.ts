import type { Facts } from '../../types/prestep.type';
import { capFacts } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';

/** Route definitions, each giving its method and path where it can. */
const ROUTES: RegExp[] = [
  // Express, Fastify, Koa, Hono, Elysia, chi, gin, echo: `.get('/users/:id'`
  /\.(get|post|put|patch|delete|all|head|options|route|any)\(\s*['"`](\/[^'"`]*)/i,
  // Nest, Spring, Flask, FastAPI and their kind: `@Get(':id')`, `@app.post("/x")`, `@GetMapping("/x")`
  /@(?:\w+\.)?(get|post|put|patch|delete|route|api_route|request)(?:mapping)?\(\s*['"]?([^'")]*)/i,
  // File-based route handlers (Next, SvelteKit, Remix, Astro): `export async function POST(`
  /\bexport\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|loader|action)\b()/,
  // Go's net/http and Django: `HandleFunc("/x"`, `path('users/<id>'`
  /\b(Handle(?:Func)?|path|re_path)\(\s*['"`]([^'"`]*)/,
];
/** Words that suggest an auth or ownership check. */
const AUTH =
  /\b(?:auth\w*|\w*Auth\w*|session|currentUser|getUser|requireUser|user_id|userId|ownerId|owner|tenant\w*|role\w*|permission\w*|can|isAdmin|guard\w*|UseGuards|jwt|verify\w*|beforeHandle|login_required|Depends|policy|policies|authorize\w*|forbidden|unauthori[sz]ed|401|403)\b/i;
/** How far around a route the auth search looks, in lines. */
const NEAR = 15;

/**
 * The `routes` facts: each route definition an added line makes, with its method and path, and the
 * lines within 15 of it in the checkout's copy of the file that look like an auth or ownership check.
 */
export const routes: Facts = async ({ files, checkout }) => {
  const lines: string[] = [];
  for (const f of files) {
    const text = checkout.read(f.filename)?.split('\n');
    for (const [line, code] of diffLines(f.patch, true)) {
      const m = ROUTES.map((r) => r.exec(code)).find(Boolean);
      if (!m) continue;
      const near = (text ?? [])
        .map((l, i) => [i + 1, l] as const)
        .filter(([n, l]) => Math.abs(n - line) <= NEAR && AUTH.test(l))
        .slice(0, 5)
        .map(([n, l]) => `line ${n} \`${l.trim().slice(0, 120)}\``);
      lines.push(
        `- ${f.filename}:${line} ${m[1]!.toUpperCase()} ${m[2] || '(path from the file)'}: ${text === undefined ? "the checkout doesn't have the file" : near.length ? `auth nearby: ${near.join(', ')}` : `no auth call within ${NEAR} lines`}`,
      );
    }
  }
  return capFacts(lines, 'The added lines define no route.');
};
