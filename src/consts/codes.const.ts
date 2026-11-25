/**
 * The codes the action reports itself, with what each means. A `failure` fails the step and shows its
 * card; a `notice` ends the run with a notice and the step passes; `push_failed` can be either. The
 * Axon Shaft API's own codes (`not_installed`, `spending_cap`, `paused`, …) live in the API. The docs'
 * codes page is generated from these, through `dist/meta.json`.
 */
export const ACTION_CODES: Record<string, { kind: 'failure' | 'notice' | 'both'; message: string }> = {
  missing_id_token: { kind: 'failure', message: "The workflow has no `permissions: id-token: write`, so the action can't sign in to the Axon Shaft API." },
  api_unreachable: { kind: 'failure', message: "The action couldn't reach the Axon Shaft API, or the API took over 30 seconds to answer." },
  api_error: {
    kind: 'failure',
    message: "The Axon Shaft API failed, or its answer couldn't be used: a setting the action can't run with, or an error page from something in front of the API.",
  },
  review_timed_out: { kind: 'failure', message: 'The review, reply or task ran past the time limit set on the dashboard.' },
  review_invalid_reply: { kind: 'failure', message: "The model's reply didn't match the review, reply or task format twice, so nothing was posted." },
  review_failed: { kind: 'failure', message: 'The review, reply or task stopped for another reason, such as an Agent SDK error or the turn limit.' },
  claude_binary_unverified: {
    kind: 'failure',
    message: "The Claude Code binary the action downloads from npm didn't match the sha512 this release records, or the release records none for the runner's platform, so it wasn't run.",
  },
  opencode_binary_unverified: {
    kind: 'failure',
    message: "The OpenCode binary the action downloads from npm didn't match the sha512 this release records, or the release records none for the runner's platform, so it wasn't run.",
  },
  opencode_unavailable: { kind: 'failure', message: "OpenCode's search tools need ripgrep (`rg`) on the runner, and the action couldn't install it from the runner's Ubuntu archive." },
  opencode_guard_missing: {
    kind: 'failure',
    message: "OpenCode ran without Axon Shaft's tool guard plugin loaded, so its reply wasn't used and nothing was posted or pushed.",
  },
  opencode_provider_error: {
    kind: 'failure',
    message: "OpenCode's provider refused the run and it couldn't recover: a usage limit, an auth or billing error, or a model the provider doesn't have. The run stops at once rather than wait for the time limit.",
  },
  opencode_model_unknown: {
    kind: 'failure',
    message: "The OpenCode model isn't in the model list of the OpenCode version this release pins, or its provider's key isn't set, so no model ran.",
  },
  opencode_key_missing: {
    kind: 'failure',
    message: "An OpenCode key kept in GitHub isn't set on the runner: add it as an Actions secret, and map it under `env:` on the Axon Shaft step in the workflow.",
  },
  opencode_key_refused: {
    kind: 'failure',
    message: "An OpenCode key's name isn't one the action passes on: a key's name is upper-case and ends in `_KEY` or `_TOKEN`, and is never `NODE_OPTIONS`, `PATH` or a runner, GitHub, loader or Claude variable.",
  },
  mcp_unavailable: {
    kind: 'failure',
    message: "The action couldn't get its MCP token from the Axon Shaft API, or Axon Shaft's MCP server didn't answer `tools/list`, so the review didn't start.",
  },
  push_failed: {
    kind: 'both',
    message: "A task couldn't push its commit: Push mode, a fork's branch or the default branch ruled it out, the change touched `.github/`, or GitHub refused the push.",
  },
  cancelled: {
    kind: 'notice',
    message: 'The workflow was cancelled before the review finished. Its check runs end as cancelled.',
  },
  nothing_to_fix: { kind: 'notice', message: "A bare `/fix` had nothing to fix: the last review has no open findings, or there's no review yet." },
  nothing_to_resolve: { kind: 'notice', message: '`/resolve` had nothing to do: the pull request already has everything from its base branch.' },
  merge_needs_decision: {
    kind: 'notice',
    message: "`/resolve` stopped before the model: merging the base branch left a conflict only a person can settle, such as a file one side deleted or a binary file, so nothing was pushed.",
  },
  self_hosted_unsupported: { kind: 'notice', message: 'A task ran on a self-hosted runner. Tasks run only on GitHub-hosted runners, so no session ran.' },
  credentials_in_checkout: {
    kind: 'notice',
    message: "A task's checkout kept a token in `.git/config`, so no session ran. Set `persist-credentials: false` on `actions/checkout`.",
  },
  sandbox_unavailable: { kind: 'notice', message: "A task couldn't start its sandbox on this runner, so no session ran." },
  fork_pull_request: {
    kind: 'notice',
    message: "A fork's pull request ran the workflow on `pull_request`, where GitHub gives it no OIDC token. Run the workflow on `pull_request_target` to review it.",
  },
  not_a_pull_request: { kind: 'notice', message: '`/review`, `/ask`, `/fix` and `/axonshaft` work on a pull request, and this comment was on an issue.' },
  not_a_finding: {
    kind: 'notice',
    message: "`/dismiss` or `/undismiss` wasn't a reply in the thread of a finding from the last review, or the finding was already as asked, so nothing changed.",
  },
  abuse_blocked: {
    kind: 'notice',
    message: 'An abuse rule refused a command or a push: the request or the change looked like an attempt to misuse Axon Shaft, such as asking for its secrets or piping a download into a shell.',
  },
  abuse_leak: { kind: 'failure', message: "The model's reply repeated Axon Shaft's system prompt or its canary line, so nothing was posted." },
  user_blocked: {
    kind: 'notice',
    message: 'The person who opened the pull request or wrote the command has 3 active abuse strikes on this account, so Axon Shaft doesn\'t run for them. An admin can clear the strikes on the dashboard.',
  },
  no_write_access: { kind: 'notice', message: 'The commenter has no write access to the repo. Only people with write access can start a run.' },
};
