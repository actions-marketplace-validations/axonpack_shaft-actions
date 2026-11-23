import { LINK_HOSTS, TOKEN_SHAPES } from './guardrail.const';

/** Keys whose text is code or a path: only token shapes are taken out of them, the rest stays as written. */
const CODE_KEYS = new Set(['suggestion', 'file', 'path', 'fp', 'step']);

/** `text` with every token shape replaced by `***`, and whether there was one. */
function tokens(text: string): { text: string; hit: boolean } {
  const out = TOKEN_SHAPES.reduce((t, re) => t.replace(re, '***'), text);
  return { text: out, hit: out !== text };
}

/**
 * The model's text made safe to post: token shapes redacted, links outside GitHub and axonpack.dev
 * turned into inert code (images are `prose`'s, in render.util), `@` mentions made inert so the bot can't ping
 * anyone, and a `/command` at a line's start escaped so the bot can't command itself.
 */
export function cleanOutput(text: string): { text: string; hits: string[] } {
  const hits: string[] = [];
  const t = tokens(text);
  if (t.hit) hits.push('output.token');
  // Code isn't rendered as links or mentions, and must stay as written.
  const out = t.text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : prose(part, hits)))
    .join('');
  return { text: out, hits: [...new Set(hits)] };
}

function prose(text: string, hits: string[]): string {
  return text
    .replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, label: string, url: string) => (LINK_HOSTS.test(url) || !/^[a-z]+:/i.test(url) ? m : (hits.push('output.link'), `${label} (\`${url.replace(/`/g, '')}\`)`)))
    .replace(/(^|[^\w`/])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[\w.-]+)?)\b/g, '$1`@$2`')
    .replace(/^(\s*)\/(?=[a-z])/gim, '$1\\/');
}

/**
 * The model's structured reply with `cleanOutput` applied to every string (only token shapes in
 * code fields), and whether any string held the `canary`: the system prompt leaked.
 */
export function scanOutput<T>(reply: T, canary: string): { reply: T; leak: boolean; hits: string[] } {
  let leak = false;
  const hits = new Set<string>();
  const walk = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') {
      if (v.includes(canary)) leak = true;
      if (CODE_KEYS.has(key)) {
        const t = tokens(v);
        if (t.hit) hits.add('output.token');
        return t.text;
      }
      const c = cleanOutput(v);
      c.hits.forEach((h) => hits.add(h));
      return c.text;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return { reply: walk(reply) as T, leak, hits: [...hits] };
}

/** A user the API says has active strikes, from the grant. */
/** `exempt`: an admin or maintainer, never blocked; missing from an older API means false. */
export type Flagged = { user_id: number; login: string; strikes: number; exempt?: boolean };

/**
 * One summary line for each user with strikes: the API's count plus this run's strike, and the rule
 * of this run's strike when there is one. Never the text itself, which would repeat the injection.
 */
export function flaggedLines(flagged: Flagged[], events: { user_id: number; login: string; rule: string; severity: string }[], names: (rule: string) => string): string[] {
  const users = new Map(flagged.map((f) => [f.user_id, { ...f }]));
  for (const e of events.filter((x) => x.severity === 'strike')) {
    const u = users.get(e.user_id) ?? { user_id: e.user_id, login: e.login, strikes: 0 };
    users.set(e.user_id, { ...u, strikes: u.strikes + 1 });
  }
  return [...users.values()].map((u) => {
    const rule = events.find((e) => e.user_id === u.user_id && e.severity === 'strike')?.rule;
    const named = rule ? `: ${names(rule)}` : '';
    if ('exempt' in u && u.exempt) return `⚠️ @${u.login} has ${u.strikes} guardrail strike${u.strikes === 1 ? '' : 's'}${named}. Admins and maintainers aren't blocked.`;
    if (u.strikes >= 3) return `@${u.login} is blocked on this account after 3 strikes. An admin can review and clear them on the dashboard.`;
    return `⚠️ @${u.login} is flagged (${u.strikes} of 3)${named}. A third strike stops Axon Shaft from running for them on this account.`;
  });
}
