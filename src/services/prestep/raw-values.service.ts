import type { Facts } from '../../types/prestep.type';
import { matches } from '../../utils/auto-pick.util';
import { capFacts } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';

/** UI, style and script files a style can live in. */
const STYLED = ['**/*.{tsx,jsx,ts,js,mjs,vue,svelte,astro,html,css,scss,sass,less}'];
/** Files that hold a theme or its tokens; their values are the tokens, so they're left out. */
const THEME = ['**/*{theme,Theme,tokens,Tokens,colors,Colors,palette,Palette}*', '**/{theme,themes,tokens}/**', '**/tailwind.config.*'];
/** Hex colours, `rgb()` and `hsl()`, pixel sizes, and React Native's unitless sizes. */
const RAW =
  /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\([^)]*\)|\b\d+(?:\.\d+)?px\b|\b(?:margin|padding|gap|fontSize|lineHeight|letterSpacing|borderRadius|borderWidth|width|height|top|left|right|bottom)\w*\s*:\s*\d+(?:\.\d+)?\b/g;
const COMMENT = /^\s*(?:\/\/|\/\*|\*|<!--)/;
/** The most theme files named. */
const THEMES_MAX = 10;

/**
 * The `raw-values` facts: hex, `rgb()` and `hsl()` colours, pixel sizes and React Native sizes on
 * added lines of UI and style files, one line per diff line, outside theme and token files; and
 * the theme and token files in the checkout, where the tokens to use instead live.
 */
export const rawValues: Facts = async ({ files, checkout }) => {
  const lines = files
    .filter((f) => matches(f.filename, STYLED) && !matches(f.filename, THEME))
    .flatMap((f) =>
      [...diffLines(f.patch, true)].flatMap(([line, text]) => {
        const found = COMMENT.test(text) ? [] : [...new Set(text.match(RAW))];
        return found.length ? [`- ${f.filename}:${line} ${found.join(', ')}`] : [];
      }),
    );
  if (!lines.length) return 'The added lines of UI and style files have no raw colour or size.';
  const themes = checkout
    .find(THEME)
    .filter((p) => matches(p, STYLED) || p.endsWith('.json'))
    .sort();
  const where = themes.length
    ? `Theme and token files in the repo: ${themes.slice(0, THEMES_MAX).join(', ')}${themes.length > THEMES_MAX ? ` and ${themes.length - THEMES_MAX} more` : ''}.`
    : 'The repo has no file named for a theme, tokens, colours or a palette.';
  return capFacts([where, 'Raw values on added lines:', ...lines], '');
};
