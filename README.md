# Axon Shaft

A GitHub Action that reviews pull requests with Claude. It runs the Claude Agent SDK on your own GitHub runners. The model reads the code and returns its findings as JSON; the action posts one summary comment, which it edits on every push, and one review with inline comments.

Task mode (`@axonshaft fix ...` in a comment) is not built yet.

## Setup

1. Install the [AxonShaft app](https://github.com/apps/axonshaft/installations/new) on the repo.
2. Sign in on [shaft.axonpack.dev](https://shaft.axonpack.dev) and save a Claude token for the repo or its account. With a Pro or Max plan, that is the output of `claude setup-token`; with Console billing, an API key. An OAuth token belongs to one person's plan, so a repo that several people use is better on an API key.
3. Add `.github/workflows/shaft.yml`:

   ```yaml
   name: Axon Shaft
   on:
     pull_request:
       types: [opened, synchronize, reopened, ready_for_review]
     issue_comment:
       types: [created]
   permissions:
     contents: write
     pull-requests: write
     issues: write
     id-token: write
   jobs:
     shaft:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v6
           with:
             persist-credentials: false
         - uses: axonpack/shaft-actions@v1
   ```

4. Open a pull request. To see the output in the job log before anything is posted, add `with: { dry_run: true }`.

The workflow holds no secrets. With `id-token: write`, the action gets an OIDC token for the run and sends it to the Axon Shaft API, which answers with a GitHub token for this repo only, the saved Claude token and the review settings from the dashboard. Comments come from `axonshaft[bot]`, and after the review the action sends the verdict, model and finding counts to the dashboard's run history.

### Using your own tokens

Any input you set wins over the dashboard:

- `claude_code_oauth_token` or `anthropic_api_key` (from a repo secret) replaces the saved Claude token.
- `app_id` and `private_key` post as your own GitHub App instead of AxonShaft. Give the app contents, pull requests and issues (write) and metadata (read), and install it on the repo.
- `model`, `effort`, `depth` and `nits` replace the dashboard's settings.

Without the app installed or without `id-token: write`, set a Claude token input. The comments then come from `github-actions[bot]` through `github_token`.

A pull request from a fork gets no secrets and no OIDC token, so Axon Shaft skips it and leaves a notice in the log: a maintainer can comment `@axonshaft review` instead.

## Inputs

None are required. Each setting comes from the first place that sets it: the input, then the dashboard, then the default below.

| Input | Default | What it does |
|---|---|---|
| `claude_code_oauth_token` | the dashboard's | A Pro or Max plan token from `claude setup-token`. Set this or `anthropic_api_key`, not both. |
| `anthropic_api_key` | the dashboard's | A Console API key. |
| `app_id`, `private_key` | | Post as this GitHub App instead of AxonShaft. Set both or neither. |
| `github_token` | `${{ github.token }}` | Used when there are no app inputs and the Axon Shaft API can't be reached. |
| `model` | `auto` | `auto` picks a model from the diff. Or any Claude model ID or alias (`opus`, `sonnet`, `haiku`). |
| `effort` | `auto` | `auto` picks from the diff. Or `low`, `medium`, `high`, `xhigh`, `max`. |
| `depth` | `standard` | `standard` runs one session. `deep` runs correctness, breakage and security as separate subagents, then a verifier, for about 3x the cost. |
| `mode` | `auto` | `auto` picks from the event. `review` or `task` forces one, for example in a `workflow_dispatch` run. |
| `max_turns` | `30` | The Agent SDK turn limit per run. |
| `timeout_minutes` | `15` | The run stops after this long and says so in the summary. |
| `nits` | `summary` | `summary` counts nits in the summary, `inline` posts them as inline comments too, `off` drops them. |
| `task_tools` | | Extra tools for task mode, such as `Bash(bun test:*)`. Review mode never gets them. |
| `config_path` | `.github/shaft.yml` | Where the repo's review rules live. Axon Shaft reads the base branch's copy. |
| `dry_run` | `false` | Print the summary and inline comments to the job log instead of posting them. |

With `model: auto`, a small change gets `sonnet`, docs and config get `haiku`, and large or sensitive changes (auth, crypto, payments, workflows, migrations, dependency changes, or a `focus` path) get `opus`. The summary footer shows the model, the effort and the reason.

## Review rules (`.github/shaft.yml`)

A repo can add its own review rules in `.github/shaft.yml`:

```yaml
rules: |
  Every user-facing change needs a changeset.
  New API routes need a test for the 401 case.
skip:
  - "**/generated/**"
  - "**/*.snap"
focus:
  - "src/billing/**"
```

- `rules` is free text the model applies along with its own review steps. Its safety rules (it never runs the PR's code or posts a secret) still win.
- `skip` lists globs for changed files to leave out of the review. The summary says how many files were skipped. When neither the dashboard nor this file sets `skip`, Axon Shaft skips lockfiles and generated files: `**/*.lock`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/dist/**`, `**/*.min.js` and `**/*.snap`. Setting `skip` replaces that list, and `skip: []` reviews everything.
- `focus` lists globs for files that get a closer look. The model is told which changed files match, and with `model: auto` a match picks `opus` with `high` effort.

Globs match the whole path from the repo root, so `*.snap` only matches at the root and `**/*.snap` matches in any folder.

Axon Shaft reads the file from the PR's base branch, so a PR can't change the rules its own review uses. A change to the file applies once it is merged.

Rules saved on the dashboard come first and the file's rules are added after them. For `skip` and `focus`, a list set on the dashboard replaces the file's. Other keys in the file are ignored with a warning in the log, and a file that isn't valid YAML, or a key with the wrong type, fails the run with a message naming the problem.

### Errors from the Axon Shaft API

When no input has a Claude token, the run fails if the API can't give one:

- Without `id-token: write`, the log says to add `permissions: id-token: write`.
- When AxonShaft isn't installed on the repo, the log links the install page.
- When the API refuses the OIDC token (401 or 403), the log shows its answer.
- When the repo is over its rate limit (429), the log shows the `Retry-After` value.
- When the dashboard has no Claude token for the repo, the log links shaft.axonpack.dev.

If recording the run afterwards fails, the action logs a warning and the run still passes.

## Outputs

| Output | What it holds |
|---|---|
| `verdict` | `blocking`, `needs-changes` or `looks-good`. |
| `findings` | The number of blocking and should-fix findings. |
| `summary_url` | The link to the summary comment. Empty on a dry run. |

## What the review can do

The model reads the repo with `Read`, `Grep`, `Glob`, `git diff`, `git log` and `git show`. It never edits files, installs anything or runs the PR's code, and it doesn't load the repo's Claude Code settings, hooks or MCP servers. Before anything is posted, the action replaces the tokens it holds with `***`, and it masks every token in the job log.

## Development

```sh
bun install
bun run lint
bun run typecheck
bun run test
bun run build   # writes dist/index.js, which is committed
```

How the code is laid out and how files are named: [CONVENTIONS.md](CONVENTIONS.md).

## License

MIT
