/** The facts' cap: about 4k tokens at 4 characters a token. */
export const FACTS_MAX = 16_000;

/** The lines as one text, cut at about 4k tokens with what was cut said at the end, or `none` when there are no lines. */
export function capFacts(lines: string[], none: string): string {
  if (!lines.length) return none;
  let text = '';
  for (const [i, l] of lines.entries()) {
    if (text.length + l.length > FACTS_MAX) return `${text}... and ${lines.length - i} more lines, cut to fit.`;
    text += `${l}\n`;
  }
  return text.trimEnd();
}

/** A patch's removed lines, without their `-`. */
export const removedLines = (patch: string | undefined) =>
  (patch ?? '')
    .split('\n')
    .filter((l) => l.startsWith('-'))
    .map((l) => l.slice(1));
