import type { Script, ScriptFinding } from '../../types/prestep.type';

const TEMPLATE = '.github/pull_request_template.md';
const HEADING = /^#{1,6}\s+(.+?)[\s#]*$/;
/** A template line that asks for an issue. */
const ASKS_ISSUE = /\bissues?\b|\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#/i;
/** `#12`, an issue URL, or a tracker key such as `ENG-12`. */
export const ISSUE_REF = /(?:^|[\s(])#\d+\b|\/issues\/\d+|\b[A-Z][A-Z0-9]+-\d+\b/;
export const CONVENTIONAL = /^\w+(?:\([^)]+\))?!?: \S/;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The body's sections by heading, each with its text minus HTML comments. */
function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | undefined;
  for (const l of body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const h = HEADING.exec(l);
    if (h) out.set((current = norm(h[1]!)), '');
    else if (current !== undefined) out.set(current, `${out.get(current)}${l.trim()}`);
  }
  return out;
}

/**
 * The pull request against the repo's template and guides: each template section missing or left
 * empty, no linked issue when the template asks for one, and a title that isn't a Conventional Commit
 * when a guide asks for them. All nits; a finding points at the template or guide line it comes from.
 */
export const prMeta: Script = ({ pr, guides }) => {
  const out: ScriptFinding[] = [];
  const nit = (file: string, line: number, title: string, body: string) => out.push({ severity: 'nit', file, line, title, body });
  const template = guides.find((g) => g.path === TEMPLATE)?.text.split(/\r?\n/) ?? [];
  const body = sections(pr.body);
  template.forEach((l, i) => {
    const h = HEADING.exec(l)?.[1];
    if (!h) return;
    if (!body.has(norm(h))) nit(TEMPLATE, i + 1, `Template section "${h}" is missing`, `The pull request template has a "${h}" section, and the description doesn't.`);
    else if (!body.get(norm(h))) nit(TEMPLATE, i + 1, `Template section "${h}" is empty`, `The description has the template's "${h}" heading with nothing under it.`);
  });
  const asks = template.findIndex((l) => ASKS_ISSUE.test(l));
  if (asks >= 0 && !ISSUE_REF.test(pr.body)) nit(TEMPLATE, asks + 1, 'No linked issue', 'The pull request template asks for an issue, and the description links none.');
  for (const g of guides) {
    const at = g.text.split(/\r?\n/).findIndex((l) => /conventional commits?/i.test(l));
    if (at < 0) continue;
    if (!CONVENTIONAL.test(pr.title)) nit(g.path, at + 1, "Title isn't a Conventional Commit", `\`${g.path}\` asks for Conventional Commits, and the title doesn't start with a type such as \`fix:\` or \`feat(scope):\`.`);
    break;
  }
  return out;
};
