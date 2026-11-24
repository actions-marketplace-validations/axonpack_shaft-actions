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
  injection_blocked: {
    kind: 'notice',
    message: 'A guardrail rule refused a command or a push: the request or the change looked like an attempt to misuse Axon Shaft, such as asking for its secrets or piping a download into a shell.',
  },
  injection_leak: { kind: 'failure', message: "The model's reply repeated Axon Shaft's system prompt or its canary line, so nothing was posted." },
  user_blocked: {
    kind: 'notice',
    message: 'The person who opened the pull request or wrote the command has 3 active guardrail strikes on this account, so Axon Shaft doesn\'t run for them. An admin can clear the strikes on the dashboard.',
  },
  no_write_access: { kind: 'notice', message: 'The commenter has no write access to the repo. Only people with write access can start a run.' },
};
