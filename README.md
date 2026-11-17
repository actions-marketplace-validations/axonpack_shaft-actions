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
- `github_token` posts with that token instead. With the run's own `${{ github.token }}`, comments come from `github-actions[bot]`, and the workflow needs `pull-requests: write` and `issues: write`.
- `model`, `effort`, `depth`, `nits`, `max_turns` and `timeout_minutes` replace the dashboard's settings.

A pull request from a fork gets no secrets and no OIDC token, so Axon Shaft skips it and leaves a notice in the log.

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
| `depth` | the Code review job's, else `standard` | `standard` runs one session. `deep` also runs the correctness, breakage and security checks as separate subagents, then a verifier, for about 3x the cost. A check turned off in the Code review job gets no subagent. |
| `nits` | the Code review job's, else `summary` | `summary` counts nits in the summary, `inline` posts them as inline comments too, `off` drops them. |
| `max_turns` | the dashboard's, else `30` | The Agent SDK turn limit per run. |
| `timeout_minutes` | the dashboard's, else `15` | The run stops after this many minutes and says so in the summary. |
| `mode` | `auto` | `auto` picks from the event. `review` forces a review of the event's pull request, for example from a comment. `task` forces task mode, which isn't built yet. |
| `task_tools` | none | Extra tools for task mode, such as `Bash(bun test:*)`. Task mode isn't built yet, so this does nothing for now. Review mode never gets them. |
| `config_path` | `.github/shaft.yml` | Where the repo's review rules live. Axon Shaft reads the base branch's copy. |
| `dry_run` | `false` | Print the summary and inline comments to the job log instead of posting them. |

With `model` and `effort` on `auto`, the first row that matches the diff (after `skip`) picks both:

| The diff | Model | Effort |
|---|---|---|
| Touches a `focus` path or a sensitive one: auth, crypto, payments, billing, workflows, migrations, or dependencies in `package.json` | `opus` | `high` |
| Any diff with `depth: deep` (the subagents run on `sonnet`) | `opus` | `high` |
| Over 1,000 changed lines or over 30 files | `opus` | `medium` |
| Only docs, comments, lockfiles or config | `haiku` | `low` |
| Anything else | `sonnet` | `medium` |

Setting `model` or `effort` turns `auto` off for that one only. If the Claude plan can't use the picked model, the review falls back to the next smaller one and the footer says so. The footer always shows the model, the effort and the reason.

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

## What the comment looks like

Axon Shaft keeps one summary comment on the PR and edits it on every push. From the top:

- A card in a GitHub alert: red (`CAUTION`) for blocking, amber (`WARNING`) for needs changes, green (`TIP`) for looks good. It holds the verdict, the headline, chips with the number of blocking, should-fix and nit findings and how many earlier findings this push fixed, and a chip per check: ✅ nothing found, ⚠️ only should-fix or nit findings, ❌ a blocking finding, ➖ turned off on the dashboard. Checks the repo added on the dashboard share one chip, "Your checks", shown only when they found something. The last line gives the kind of change, the model's confidence and the reviewed commit.
- A table of blocking and should-fix findings. Each location links to the lines at the reviewed commit. A finding with an inline comment says "inline"; a finding outside the diff has its text in the table, and its suggested change, if any, in a fold below.
- The nits, folded.
- The earlier findings this push fixed, and how many files `skip` left out, one line each when there are any.
- "What this PR does", folded: what the PR claims, its impact, its scope and what the review couldn't check.
- A footer with the run link, the model, the effort and why `auto` picked them.

Inline comments go on the lines in the diff, one per blocking or should-fix finding, and nits too with `nits: inline`. A finding that already has an inline comment isn't posted again on the next push, and when a push fixes a finding, its thread is resolved.

A dry run prints the same text to the job log.

## What the review can do

The model reads the repo from the workflow's checkout, so keep the `actions/checkout` step. It uses `Read`, `Grep`, `Glob`, `git diff`, `git log` and `git show`, and a diff longer than 200,000 characters is cut, with the model reading the rest from the checkout. It never edits files, installs anything or runs the PR's code, and it doesn't load the repo's Claude Code settings, hooks or MCP servers.

A PR, or a comment on it, can try to talk the model into leaking something, so the review is fenced in:

- It can read and search only files inside the checkout. Paths outside it are refused, and so are `/proc`, `/sys`, the runner's temp and tool folders, and any symlink in the PR that points out of the checkout.
- Its only commands are `git diff`, `git log` and `git show`, with no shell operators, no `--no-index`, `--output` or `--ext-diff`, and no path outside the checkout.
- It runs with only `PATH`, `HOME` and the Claude token in its environment. The OIDC request token, the action's inputs and `GITHUB_TOKEN` aren't there, and the commands it runs don't get the Claude token either.
- The prompt has the PR's title, body, commits and diff, and only the comments of the repo's owners, members and collaborators. Comments from anyone else are left out.
- Images are stripped from everything the model writes before it's posted, so an image URL can't carry data out.
- Before anything is posted, the action replaces the tokens it holds with `***`, and it masks every token in the job log.

With `mode: review`, the person whose event started the run needs write access, and a PR from a fork is skipped, as it is with `mode: auto`.

## Development

```sh
bun install
bun run lint
bun run typecheck
bun run test
bun run build   # writes dist/index.js, which is committed
```

How the code is laid out and how files are named: [CONVENTIONS.md](CONVENTIONS.md).

## Releasing

Versions are kept with [Changesets](https://github.com/changesets/changesets), and the action ships from git tags.

1. A PR that changes something users would notice adds a changeset: run `bun run changeset`, pick the bump, and describe the change in a line or two.
2. Each push to `main` with changesets pending opens or refreshes the Version Packages PR. It raises the version in `package.json`, adds the changes to `CHANGELOG.md` and rebuilds `dist/index.js`.
3. Merging that PR releases the version, for example `1.2.3`: the release workflow tags the merge commit `v1.2.3`, moves the `v1` tag to the same commit, and creates a GitHub Release with that version's changelog.

Workflows that use `axonpack/shaft-actions@v1` get every 1.x release. To stay on one version, use `@v1.2.3`.

## License

MIT
