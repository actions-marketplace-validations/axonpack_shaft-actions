# Axon Shaft

A GitHub Action that reviews pull requests with Claude. It runs the Claude Agent SDK on your own GitHub runners. The model reads the code and returns its findings as JSON; the action posts one summary comment, which it edits on every push, and one review with inline comments.

Task mode (`@axonshaft fix ...` in a comment) is not built yet.

## Setup

1. Install the [AxonShaft app](https://github.com/apps/axonshaft/installations/new) on the repo.
2. Sign in on [shaft.axonpack.dev](https://shaft.axonpack.dev), add the repo as a project, and save a Claude token for the repo or its account. With a Pro or Max plan, that is the output of `claude setup-token`; with Console billing, an API key. An OAuth token belongs to one person's plan, so a repo that several people use is better on an API key.
3. Add `.github/workflows/shaft.yml`:

   ```yaml
   name: Axon Shaft
   on:
     pull_request:
       types: [opened, synchronize, reopened, ready_for_review]
     issue_comment:
       types: [created]
     pull_request_review_comment:
       types: [created]
     pull_request_review:
       types: [submitted]
   # A new push cancels the review of the commit before it. Comments each run on their own.
   concurrency:
     group: axon-shaft-${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id }}
     cancel-in-progress: true
   permissions:
     contents: read
     # The run's OIDC token is how the action signs in to Axon Shaft, which answers with
     # a GitHub token for this repo, the Claude token and the settings from the dashboard.
     id-token: write
   jobs:
     axon-shaft:
       # Skip comments that don't mention the app, so they don't start a runner.
       if: >-
         github.event_name == 'pull_request' ||
         contains(github.event.comment.body, '@axonshaft') ||
         contains(github.event.review.body, '@axonshaft')
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v7
         - uses: axonpack/shaft-actions@v1
   ```

4. Open a pull request. To see the output in the job log before anything is posted, add `with: { dry_run: true }`.

The workflow holds no secrets. With `id-token: write`, the action gets an OIDC token for the run and sends it to the Axon Shaft API with the job (`review` for a pull request event, `task` for a comment that mentions `@axonshaft`) and, for a pull request, which event it was. When the job is on for that event, the API answers with a GitHub token for this repo only, the saved Claude token, the settings and the review steps from the dashboard. Comments come from `axonshaft[bot]` through that token, so the workflow's own token only needs `contents: read`. After the review the action sends the verdict, model and finding counts to the dashboard's run history.

When the Code review job is off on the dashboard, or the event isn't one of its "When it runs" choices, the API says so and the run ends with a notice giving its reason. Nothing is posted.

### Using your own tokens

Any input you set wins over the dashboard:

- `claude_code_oauth_token` or `anthropic_api_key` (from a repo secret) replaces the saved Claude token.
- `app_id` and `private_key` post as your own GitHub App instead of AxonShaft. Give the app contents, pull requests and issues (write) and metadata (read), and install it on the repo.
- `github_token` posts as `github-actions[bot]` instead. The workflow then needs `pull-requests: write` and `issues: write`.
- `model`, `effort`, `depth`, `nits`, `max_turns` and `timeout_minutes` replace the dashboard's settings.

A pull request from a fork gets no secrets and no OIDC token, so Axon Shaft skips it and leaves a notice in the log: a maintainer can comment `@axonshaft review` instead.

### Standalone mode

With a Claude token input and either `github_token` or `app_id` and `private_key`, the action never calls the Axon Shaft API, and the repo needs neither the app nor a project on the dashboard. Settings come from the inputs, then `.github/shaft.yml`, then the defaults, and the review runs its built-in steps, the same ones the dashboard's Code review job starts with. Nothing is recorded in a run history.

Comments posted with `github_token` come from `github-actions[bot]`, so the workflow's token needs write access to pull requests and issues. Keep the `on`, `concurrency` and `if` from the workflow above and change the rest:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
jobs:
  axon-shaft:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: axonpack/shaft-actions@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github_token: ${{ github.token }}
```

## Inputs

None are required. Each setting comes from the first place that sets it: the input, then the dashboard, then `.github/shaft.yml`, then the default. The second column says where the value comes from when the input is empty.

| Input | When it's empty | What it does |
|---|---|---|
| `claude_code_oauth_token` | the dashboard's Claude token | A Pro or Max plan token from `claude setup-token`. Set this or `anthropic_api_key`, not both. |
| `anthropic_api_key` | the dashboard's Claude token | A Console API key. |
| `app_id`, `private_key` | the dashboard's GitHub token | Post as this GitHub App instead of AxonShaft. Set both or neither. |
| `github_token` | the dashboard's GitHub token | Post as `github-actions[bot]` with this token, such as `${{ github.token }}`. |
| `model` | the dashboard's, else `auto` | `auto` picks a model from the diff. Or any Claude model ID or alias (`opus`, `sonnet`, `haiku`). |
| `effort` | the dashboard's, else `auto` | `auto` picks from the diff. Or `low`, `medium`, `high`, `xhigh`, `max`. |
| `depth` | the Code review job's, else `standard` | `standard` runs one session. `deep` runs correctness, breakage and security as separate subagents, then a verifier, for about 3x the cost. |
| `nits` | the Code review job's, else `summary` | `summary` counts nits in the summary, `inline` posts them as inline comments too, `off` drops them. |
| `max_turns` | the dashboard's, else `30` | The Agent SDK turn limit per run. |
| `timeout_minutes` | the dashboard's, else `15` | The run stops after this many minutes and says so in the summary. |
| `mode` | `auto` | `auto` picks from the event. `review` or `task` forces one, for example in a `workflow_dispatch` run. |
| `task_tools` | none | Extra tools for task mode, such as `Bash(bun test:*)`. Review mode never gets them. |
| `config_path` | `.github/shaft.yml` | Where the repo's review rules live. Axon Shaft reads the base branch's copy. |
| `dry_run` | `false` | Print the summary and inline comments to the job log instead of posting them. |

With `model: auto`, a small change gets `sonnet`, docs and config get `haiku`, and large or sensitive changes (auth, crypto, payments, workflows, migrations, dependency changes, or a `focus` path) get `opus`. The summary footer shows the model, the effort and the reason.

## Review steps

The steps the review walks come from the repo's Code review job on the dashboard, where a check can be turned off and the repo can add checks of its own. Findings from an added check are labelled `rules`. In standalone mode the action uses its built-in steps, which match the job's defaults. The safety rules (never run the PR's code, never post a secret) and the shape of the reply are part of the action and apply either way.

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

When the action calls the API (some token isn't given as an input), the run fails if the API can't answer:

- Without `id-token: write`, the log says to add `permissions: id-token: write`.
- When AxonShaft isn't installed on the repo, the log links the install page.
- When the app is installed but the repo isn't a project on the dashboard yet, the log links the page to add it.
- When the API refuses the OIDC token (401 or 403), the log shows its answer.
- When the repo is over its rate limit (429), the log shows the `Retry-After` value.
- When neither an input nor the dashboard has a Claude token, the log links shaft.axonpack.dev.

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
