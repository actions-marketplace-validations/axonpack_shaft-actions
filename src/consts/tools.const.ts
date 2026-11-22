/**
 * The linters the `script+model` checklists run, each pinned to one release, downloaded only from that
 * project's own GitHub release, and run only once its sha256 matches the one recorded here. The API
 * never names a tool, a version, a URL or a hash: they change only with a new release of the action.
 * Linux on x64 and arm64 only, since they run in the bubblewrap sandbox.
 *
 * `archive`: `bin` is the program itself, `tar.gz` and `zip` hold it as `file`. Each sha256 is the one
 * the project publishes beside its release (squawk publishes none, so its hashes are of the files as
 * this release downloaded them).
 */
export type Tool = { version: string; archive: 'bin' | 'tar.gz' | 'zip'; file: string; assets: Record<'x64' | 'arm64', { url: string; sha256: string }> };

const GH = 'https://github.com';

export const TOOLS = {
  actionlint: {
    version: '1.7.12',
    archive: 'tar.gz',
    file: 'actionlint',
    assets: {
      x64: { url: `${GH}/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz`, sha256: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8' },
      arm64: { url: `${GH}/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_arm64.tar.gz`, sha256: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6' },
    },
  },
  hadolint: {
    version: '2.15.1',
    archive: 'bin',
    file: 'hadolint',
    assets: {
      x64: { url: `${GH}/hadolint/hadolint/releases/download/v2.15.1/hadolint-linux-x86_64`, sha256: 'c7187db94eeeeca956519a6af171adc31453941a1e777961f6e680f697c8c507' },
      arm64: { url: `${GH}/hadolint/hadolint/releases/download/v2.15.1/hadolint-linux-arm64`, sha256: 'f6198ef8090f404dbb771abfee086eb8c48ac177f30da7fd3510aca35b344b5d' },
    },
  },
  squawk: {
    version: '2.71.0',
    archive: 'bin',
    file: 'squawk',
    assets: {
      x64: { url: `${GH}/sbdchd/squawk/releases/download/v2.71.0/squawk-linux-x64`, sha256: 'ab978cb412e5e5eb2f06aaa4c5035a1567f6eba53274d7d1e068f73169b88bbd' },
      arm64: { url: `${GH}/sbdchd/squawk/releases/download/v2.71.0/squawk-linux-arm64`, sha256: 'cc6b563f205e9d93472232ca21113c736d6e1f45a7ce700170b7e17bcecc9b7f' },
    },
  },
  tflint: {
    version: '0.66.0',
    archive: 'zip',
    file: 'tflint',
    assets: {
      x64: { url: `${GH}/terraform-linters/tflint/releases/download/v0.66.0/tflint_linux_amd64.zip`, sha256: '22be11cadc25cd02401e94c0ccc91aa63467debb8485c2a755d98f4c0a9d1e2e' },
      arm64: { url: `${GH}/terraform-linters/tflint/releases/download/v0.66.0/tflint_linux_arm64.zip`, sha256: '1105a0a5ddee7cdac7957a3475571a946b839192ea1bc0c722c6c4686001067e' },
    },
  },
  oasdiff: {
    version: '1.37.0',
    archive: 'tar.gz',
    file: 'oasdiff',
    assets: {
      x64: { url: `${GH}/oasdiff/oasdiff/releases/download/v1.37.0/oasdiff_1.37.0_linux_amd64.tar.gz`, sha256: 'eac87307d31d08c36800c58a409c247f1c5db37fbb72e2544402f22a87cbca3c' },
      arm64: { url: `${GH}/oasdiff/oasdiff/releases/download/v1.37.0/oasdiff_1.37.0_linux_arm64.tar.gz`, sha256: '072a425ac647ecf2808721e91293fd644cee7935d2b32e650b3158539b2c7898' },
    },
  },
  buf: {
    version: '1.75.0',
    archive: 'bin',
    file: 'buf',
    assets: {
      x64: { url: `${GH}/bufbuild/buf/releases/download/v1.75.0/buf-Linux-x86_64`, sha256: 'fad1e38d6909bbb583a4da81d8c02a01046e2cd663bde7e337dd24277393764b' },
      arm64: { url: `${GH}/bufbuild/buf/releases/download/v1.75.0/buf-Linux-aarch64`, sha256: '00eb190aa82df17f393e05b04889cc60a0b13b3259d336e21a87d5f23ab4fd26' },
    },
  },
} satisfies Record<string, Tool>;

export type ToolName = keyof typeof TOOLS;

/** The biggest download, and how long one may take. */
export const TOOL_MAX_BYTES = 150_000_000;
export const TOOL_DOWNLOAD_MS = 120_000;
/** How long one run of a linter may take, and the most it may print. */
export const TOOL_RUN_MS = 60_000;
export const TOOL_MAX_OUTPUT = 5_000_000;
