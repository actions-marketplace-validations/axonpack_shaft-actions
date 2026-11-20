import type { Facts } from '../../types/prestep.type';
import { matches } from '../../utils/auto-pick.util';
import { capFacts } from '../../utils/facts.util';

/** JSON locale files under the folders translations usually live in. */
const LOCALES = ['**/{locales,locale,i18n,lang,langs,translations,messages}/**/*.json'];
const LOCALE_CODE = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,4})?$/;
/** The most keys a line lists. */
const KEYS_MAX = 30;

/**
 * The siblings a locale file is compared with, and its locale: `locales/en.json` is `en` among
 * `locales/*.json`, and `locales/en/common.json` is `en` among `locales/* /common.json`.
 */
function localeOf(path: string): [group: string, locale: string] | undefined {
  const parts = path.split('/');
  const file = parts.pop()!;
  const stem = file.replace(/\.json$/, '');
  if (LOCALE_CODE.test(stem)) return [`${parts.join('/')}/*.json`, stem];
  const dir = parts.pop();
  if (dir && LOCALE_CODE.test(dir)) return [`${parts.join('/')}/*/${file}`, dir];
  return undefined;
}

/** A JSON file's keys as dotted paths to its leaves, or undefined when it isn't a JSON object. */
function keysOf(text: string | undefined): Set<string> | undefined {
  try {
    const walk = (o: unknown, at: string): string[] =>
      o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => walk(v, at ? `${at}.${k}` : k)) : [at];
    const json: unknown = JSON.parse(text ?? '');
    return json && typeof json === 'object' && !Array.isArray(json) ? new Set(walk(json, '')) : undefined;
  } catch {
    return undefined;
  }
}

const list = (keys: string[]) => `${keys.slice(0, KEYS_MAX).map((k) => `\`${k}\``).join(', ')}${keys.length > KEYS_MAX ? ` and ${keys.length - KEYS_MAX} more` : ''}`;

/**
 * The `locale-keys` facts: the keys each changed JSON locale file adds (against the base branch's
 * copy), and which of them each sibling locale in the checkout lacks.
 */
export const localeKeys: Facts = async ({ files, checkout, base }) => {
  const all = checkout
    .find(LOCALES)
    .filter((p) => localeOf(p))
    .sort();
  const changed = files.filter((f) => f.status !== 'removed' && matches(f.filename, LOCALES) && localeOf(f.filename));
  if (!changed.length)
    return all.length
      ? `No locale file changed. The repo has ${all.length} locale files, such as ${all.slice(0, 5).join(', ')}.`
      : 'No locale file changed, and the repo has no JSON locale files under a `locales`, `locale`, `i18n`, `lang`, `langs`, `translations` or `messages` folder.';
  const lines: string[] = [];
  for (const f of changed) {
    const [group, locale] = localeOf(f.filename)!;
    const head = keysOf(checkout.read(f.filename));
    if (!head) {
      lines.push(`${f.filename} (${locale}): couldn't read it as a JSON object.`);
      continue;
    }
    const was = f.status === 'added' ? new Set<string>() : (keysOf(await base(f.filename)) ?? new Set<string>());
    const added = [...head].filter((k) => !was.has(k));
    if (!added.length) {
      lines.push(`${f.filename} (${locale}): adds no key.`);
      continue;
    }
    lines.push(`${f.filename} (${locale}): adds ${added.length} key${added.length === 1 ? '' : 's'}: ${list(added)}`);
    const siblings = all.filter((p) => p !== f.filename && localeOf(p)![0] === group);
    let complete = 0;
    for (const p of siblings) {
      const keys = keysOf(checkout.read(p));
      const missing = keys ? added.filter((k) => !keys.has(k)) : added;
      if (missing.length) lines.push(`- missing in ${p} (${localeOf(p)![1]}): ${keys ? list(missing) : "couldn't read it as a JSON object"}`);
      else complete++;
    }
    lines.push(siblings.length ? `- ${complete} of ${siblings.length} other locales have them all.` : '- No other locale has this file.');
  }
  return capFacts(lines, '');
};
