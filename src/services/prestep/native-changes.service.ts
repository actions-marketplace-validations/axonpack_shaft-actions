import type { Facts } from '../../types/prestep.type';
import { matches } from '../../utils/auto-pick.util';
import { factsText } from '../../utils/facts.util';
import { diffLines, removedLines } from '../../utils/render.util';

/** Native projects, app config and the native settings files of iOS and Android. */
const NATIVE = ['**/ios/**', '**/android/**', '**/*.podspec', '**/app.json', '**/app.config.*', '**/eas.json', '**/*.xcprivacy', '**/*.entitlements', '**/Info.plist', '**/AndroidManifest.xml'];
const APP_CONFIG = ['**/app.json', '**/app.config.{js,ts,mjs,cjs,json}'];
/** A package whose name says it likely ships native code. */
const NATIVE_PACKAGE = /^(?:react-native(?:-|$)|@react-native|expo(?:-|$)|@expo\/|@capacitor\/|cordova-|@[^/]+\/react-native|.+-react-native$)/;
const DEP_LINE = /^\s*"([^"]+)"\s*:\s*"([^"]*)"/;
/** The most app config files compared. */
const CONFIGS_MAX = 5;

/** A setting's value in an app config's text, with its whitespace squeezed, or `not set`. */
const setting = (text: string | undefined, key: string) =>
  new RegExp(`["']?\\b${key}["']?\\s*:\\s*(\\{[^}]*\\}|"[^"]*"|'[^']*'|[^,\\n}]+)`).exec(text ?? '')?.[1]!.replace(/\s+/g, ' ').trim() ?? 'not set';

/**
 * The `native-changes` facts: the native files the pull request changes, the packages with native
 * code its `package.json` files add, remove or change, and each app config's `runtimeVersion` and
 * `version` before (the base branch's copy) and after (the checkout's).
 */
export const nativeChanges: Facts = async ({ files, checkout, base }) => {
  const native = files.filter((f) => matches(f.filename, NATIVE)).map((f) => `- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`);
  const packages = files
    .filter((f) => f.filename.endsWith('package.json'))
    .flatMap((f) => {
      const pins = (lines: string[]) => new Map(lines.flatMap((l) => [DEP_LINE.exec(l)].filter((m) => m && NATIVE_PACKAGE.test(m[1]!)).map((m) => [m![1]!, m![2]!] as const)));
      const [was, now] = [pins(removedLines(f.patch)), pins([...diffLines(f.patch, true).values()])];
      return [...new Set([...was.keys(), ...now.keys()])]
        .filter((n) => was.get(n) !== now.get(n))
        .map((n) => `- ${f.filename}: ${!was.has(n) ? `added ${n} ${now.get(n)}` : !now.has(n) ? `removed ${n} ${was.get(n)}` : `changed ${n} ${was.get(n)} -> ${now.get(n)}`}`);
    });
  if (!native.length && !packages.length) return 'No native file or package with native code changed.';
  const configs = await Promise.all(
    checkout
      .find(APP_CONFIG)
      .sort()
      .slice(0, CONFIGS_MAX)
      .map(async (p) => {
        const [before, after] = [await base(p), checkout.read(p)];
        return ['runtimeVersion', 'version'].map((k) => {
          const [b, a] = [setting(before, k), setting(after, k)];
          return `- ${p} ${k}: ${b === a ? `${a} (unchanged)` : `${b} -> ${a}`}`;
        });
      }),
  );
  return factsText(
    [
      ...(native.length ? ['Native files changed:', ...native] : []),
      ...(packages.length ? ['Packages with native code changed:', ...packages] : []),
      ...(configs.length ? ['App config, base branch -> pull request:', ...configs.flat()] : ['The repo has no app.json or app.config file.']),
    ],
    '',
  );
};
