import type { Script, ScriptFinding } from '../../types/prestep.type';
import { TEST } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';

/** A focused test, which makes the runner skip every other test in the file or the run. */
const FOCUSED = /\b(?:(?:describe|it|test|context|suite)\.only|fdescribe|fit)\s*\(/;
/** A skipped test: often on purpose, so only a nit. */
const SKIPPED = /\b(?:(?:describe|it|test|context|suite)\.skip|xdescribe|xit)\s*\(/;

/** `.only`, `fdescribe` and `fit` on an added line of a test file are blocking; `.skip`, `xdescribe` and `xit` are nits. */
export const focusedTests: Script = ({ files }) =>
  files
    .filter((f) => TEST.test(f.filename))
    .flatMap((f) =>
      [...diffLines(f.patch, true)].flatMap(([line, text]): ScriptFinding[] => {
        if (/^\s*(?:\/\/|\*)/.test(text)) return [];
        const call = (FOCUSED.exec(text) ?? SKIPPED.exec(text))?.[0].replace(/\s*\($/, '');
        if (!call) return [];
        return FOCUSED.test(text)
          ? [{ severity: 'blocking', file: f.filename, line, title: `Focused test: \`${call}\``, body: `\`${call}\` makes the test runner skip every other test, so CI passes without running them. Remove it before merging.` }]
          : [{ severity: 'nit', file: f.filename, line, title: `Skipped test: \`${call}\``, body: `\`${call}\` turns this test off. If that's on purpose, a comment or an issue link saying why helps.` }];
      }),
    );
