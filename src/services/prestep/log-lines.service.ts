import type { Facts } from '../../types/prestep.type';
import { CODE, factsText, TEST } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';

/** Calls that send data somewhere people or services read it, by kind; the first that matches a line names it. */
const CALLS: [kind: string, call: RegExp][] = [
  ['error report', /\b(?:Sentry|Bugsnag|Rollbar|bugsnag|rollbar|newrelic|honeybadger)\.\w+\(|\bcapture(?:Exception|Message|Event)\(|\bnotice_?[eE]rror\(/],
  ['analytics', /\b(?:analytics|posthog|mixpanel|amplitude|segment|rudderanalytics|heap)\.(?:track|identify|capture|page|screen|logEvent|alias|group|people)\w*\(|\b(?:gtag|logEvent|trackEvent)\(/],
  ['metric', /\b(?:metrics?|statsd|meter|histogram|counter|gauge|prom\w*)\.(?:inc\w*|dec\w*|observe|record|gauge|histogram|count|timing|distribution|add|set)\(/i],
  [
    'log',
    /\b(?:console|logger|log|logging|winston|pino|bunyan|structlog|slog|zap|glog|klog|tracing|core|Log|Logger)\.(?:log|info|warn|warning|error|debug|trace|fatal|critical|exception|notice|verbose|[dievw]|(?:Print|Fatal|Panic|Info|Warn|Error|Debug)\w*)\(|\b(?:fmt\.F?[pP]rint\w*|print|NSLog|os_log)\(|\b(?:println|eprintln|dbg|info|warn|error|debug|trace)!\(|\bputs\b|\bRails\.logger\.\w+/,
  ],
];
const MAX_CODE = 200;

/** The `log-lines` facts: each log, metric, analytics and error-report call on an added line outside tests, with its kind and code. */
export const logLines: Facts = async ({ files }) => {
  const lines = files
    .filter((f) => CODE.test(f.filename) && !TEST.test(f.filename))
    .flatMap((f) =>
      [...diffLines(f.patch, true)].flatMap(([line, text]) => {
        const kind = CALLS.find(([, call]) => call.test(text))?.[0];
        const code = text.trim();
        return kind ? [`- ${f.filename}:${line} ${kind}: ${code.length > MAX_CODE ? `${code.slice(0, MAX_CODE)}...` : code}`] : [];
      }),
    );
  return factsText(lines.length ? ['Log, metric, analytics and error-report calls on added lines:', ...lines] : [], '');
};
