# Axon Shaft

A GitHub Action that reviews pull requests with Claude. It runs the Claude Agent SDK on your own GitHub runners. The model reads the code and returns its findings as JSON; the action posts one summary comment, which it edits on every push, and one review with inline comments.

Task mode (`@axonshaft fix ...` in a comment) is not built yet.

## Setup

Axon Shaft needs its dashboard. The action holds no settings and no prompt of its own: each run gets its tokens, its settings and the whole review prompt from the Axon Shaft API.

1. Install the [AxonShaft app](https://github.com/apps/axonshaft/installations/new) on the repo.
2. Sign in on [shaft.axonpack.dev](https://shaft.axonpack.dev), add the repo as a project, and save a Claude token for the repo or its account. With a Pro or Max plan, that is the output of `claude setup-token`; with Console billing, an API key. An OAuth token belongs to one person's plan, so a repo that several people use is better on an API key.
3. Add `.github/workflows/shaft.yml`:

   ```yaml
   name: Axon Shaft
   on:
     # pull_request_target, so a fork's pull request gets an OIDC token too. The action never runs the PR's code.
     pull_request_target:
       types: [opened, synchronize, reopened, ready_for_review]
     issue_comment:
       types: [created]
     pull_request_review_comment:
       types: [created]
     pull_request_review:
       types: [submitted]
   # A new push cancels the review of the commit before it. Comments each run on their own.
   concurrency:
     group: axon-shaft-${{ github.event_name == 'pull_request_target' && github.event.pull_request.number || github.run_id }}
     cancel-in-progress: true
   permissions:
     contents: read
     # The run's OIDC token is how the action signs in to Axon Shaft, which answers with
     # a GitHub token for this repo, the Claude token, the settings and the review prompt.
     id-token: write
   jobs:
     axon-shaft:
       # Skip comments with no @axonshaft and no line that starts with /, and bots' comments (Axon
       # Shaft's own included), so they don't start a runner. The action picks out the command.
       if: >-
         github.event_name == 'pull_request_target' ||
         (github.event.sender.type != 'Bot' &&
         (contains(format('{0}{1}', github.event.comment.body, github.event.review.body), '@axonshaft') ||
         contains(format('{0}{1}{0}{2}', fromJSON('"\n"'), github.event.comment.body, github.event.review.body), format('{0}/', fromJSON('"\n"')))))
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v7
           with:
             # Leaves no token in .git/config for the model to read.
             persist-credentials: false
         - uses: axonpack/shaft-actions@v1
   ```

4. Open a pull request. To see the output in the job log before anything is posted, add `with: { dry_run: true }`.

The workflow holds no secrets. With `id-token: write`, the action gets an OIDC token for the run and sends it to the Axon Shaft API with the job (`review` for a pull request event, a `/review` or an `@axonshaft review` comment; `task` for `/fix` or any other comment that mentions `@axonshaft`; `reply` for `/ask`; `help` for `/help`), which pull request event it was, and whether the pull request comes from a fork. When the job is on for that event, the API answers with a GitHub token for this repo only, the saved Claude token, the settings and the review prompt. Comments come from `axonshaft[bot]` through that token, so the workflow's own token only needs `contents: read`. After the review the action sends the verdict, model and finding counts to the dashboard's run history. If recording the run fails, the action logs a warning and the run still passes.

When the Code review job is off on the dashboard, or the event isn't one of its "When it runs" choices, the API says so and the run ends with a notice giving its reason. Nothing is posted.

## Pull requests from forks

A fork's pull request is reviewed as the Code review job's "Pull requests from forks" setting on the dashboard says:

| Setting | What happens |
|---|---|
| Review automatically (the default) | The review runs as it does for any other pull request. |
| Ask a maintainer first | `axonshaft[bot]` comments on the pull request that someone with write access can start the review by commenting `@axonshaft review`, and the run ends with a notice. Later pushes don't post it again. |
| Only when a maintainer mentions @axonshaft | Nothing is posted and the run ends with a notice. A review starts only from an `@axonshaft review` comment. |

This needs the workflow on `pull_request_target`, as in the setup above. On `pull_request`, GitHub gives a fork's run no OIDC token, so Axon Shaft skips it with a notice.

On `pull_request_target`, and on a comment, the workflow's checkout holds the base branch. The action fetches the pull request's head commit with the GitHub token from the API and checks it out detached for the model to read. The token goes on that one `git fetch` command and is never saved in `.git/config`, and the PR's code is never run. The fetch is as deep as the checkout: one commit with the default checkout, or the whole history with `fetch-depth: 0`, which lets the model run `git log` and `git diff` against the base branch. Keep `persist-credentials: false` on the checkout, so the workflow's own token isn't left in `.git/config` either.

## Starting a review from a comment

Comment `@axonshaft review` on a pull request, in the conversation, on a line or in a review, and Axon Shaft reviews its latest commit. This works on any pull request, from a fork or not, whatever the "When it runs" and "Pull requests from forks" settings say. The commenter needs write access to the repo, which the action checks with GitHub. Anyone else's comment starts nothing, and the run ends with a notice that only people with write access can start a review. Any other mention of `@axonshaft` is for task mode, which isn't built yet.

### Commands

A comment can also start Axon Shaft with a command at the start of a line. GitHub doesn't suggest an app in `@` autocomplete, so these are quicker to type.

| Command | What it does |
|---|---|
| `/review` | Reviews the pull request now, like `@axonshaft review`. On an issue it ends with a notice. |
| `/fix` | Fixes what the last review found, or what follows the command. Not built yet: the run ends with a notice. |
| `/ask <question>` | Answers a question about the code without changing it. Not built yet: the run ends with a notice. |
| `/help` | `axonshaft[bot]` posts the list of commands on the pull request or issue, once. |

A command in a quote, in inline code or in a code block doesn't count, and neither does a longer word such as `/reviewer`. Another bot that uses the same command will also start.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `dry_run` | `false` | Print the summary and inline comments to the job log instead of posting them. |

Everything else is set on the dashboard: the model, the effort, the depth, how nits are shown, the turn limit, the time limit, the repo's review rules, the `skip` globs (files to leave out of the review) and the `focus` globs (files that get a closer look).

With the model and effort on `auto`, the action picks both from the diff, after `skip`. The first row that matches wins:

| The diff | Model | Effort |
|---|---|---|
| Touches a `focus` path or a sensitive one: auth, crypto, payments, billing, workflows, migrations, or dependencies in `package.json` | `opus` | `high` |
| Any diff on a deep review (the subagents run on `sonnet`) | `opus` | `high` |
| Over 1,000 changed lines or over 30 files | `opus` | `medium` |
| Only docs, comments, lockfiles or config | `haiku` | `low` |
| Anything else | `sonnet` | `medium` |

A model or effort set on the dashboard turns `auto` off for that one only. If the Claude plan can't use the picked model, the review falls back to the next smaller one and the footer says so. The footer always shows the model, the effort and the reason.

## The review prompt

The whole prompt comes from the repo's Code review job on the dashboard: the steps the review walks, the safety rules, the shape of the reply, the repo's review rules, and on a deep review the subagents for the correctness, breakage and security checks. A check can be turned off there, and the repo can add checks of its own. Findings from an added check are labelled `rules`.

The action fills the prompt's slots with the run's data and changes nothing else: the repo and pull request number, the branches and head commit, the title, author, body and commits, the comments of the repo's owners, members and collaborators, the previous review's findings, how many files `skip` left out, and the diff, with each `focus` file marked.

It also fills in the repo's guides as the base branch has them: `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.github/CONTRIBUTING.md`, `CONVENTIONS.md`, `.github/pull_request_template.md` and the root `README.md`, whichever exist. Each is cut at 8,000 characters and all of them at 30,000. They set the standards the review checks against, such as needing a test or a README line for each change, and a PR can't change the copies its own review reads.

## When a run fails

The step fails with a message that says what to do. The job summary shows a card for the failure, the same message and, when there is one, a link to where to fix it. The card is an image of the failure's code from `https://shaft.axonpack.dev/errors/<code>.svg`. When the review itself fails, the PR's summary comment shows the same card, message and link, so the PR says what happened too.

These codes come from the Axon Shaft API, with its message and link:

| Code | What it means |
|---|---|
| `not_installed` | The AxonShaft app isn't installed on the repo. The link opens the install page. |
| `not_a_project` | The app is installed, but the repo isn't a project on the dashboard yet. The link opens the page to add it. |
| `no_claude_token` | Neither the project nor its account has a Claude token saved. |
| `oidc_invalid` | The API refused the run's OIDC token because it was bad, expired or already used. |
| `event_not_allowed` | The API doesn't take runs started by this workflow event. |
| `rate_limited` | The repo is over its rate limit. Wait a little and rerun the job. |
| `api_error` | The API failed, or its answer couldn't be used: a setting the action can't run with, or an error page from something in front of the API. |

These come from the action:

| Code | What it means |
|---|---|
| `missing_id_token` | The workflow has no `permissions: id-token: write`, so the action can't sign in to the API. |
| `api_unreachable` | The action couldn't reach the API, or the API took over 30 seconds to answer. |
| `review_timed_out` | The review ran past the time limit set on the dashboard. The link opens the dashboard. |
| `review_invalid_reply` | The model's reply didn't match the review format twice, so nothing was posted. Both replies are in the job log, and the link opens the run. |
| `review_failed` | The review stopped for another reason, such as an Agent SDK error or the turn limit. The link opens the run. |

A fork's pull request on `pull_request`, a job that's off for the event, a fork's pull request the dashboard holds back, or an `@axonshaft review` from someone without write access ends with a notice, and the step passes. Any other error, such as GitHub's API failing, fails the step with that error's message.

## Outputs

| Output | What it holds |
|---|---|
| `verdict` | `blocking`, `needs-changes` or `looks-good`. |
| `findings` | The number of blocking and should-fix findings. |
| `summary_url` | The link to the summary comment. Empty on a dry run. |

## What the comment looks like

Axon Shaft keeps one summary comment on the PR and edits it on every push. From the top:

- A card in a GitHub alert: red (`CAUTION`) for blocking, amber (`WARNING`) for needs changes, green (`TIP`) for looks good. It opens with the verdict's status card, an SVG from `https://shaft.axonpack.dev/status/<verdict>.svg` (while the review runs, the comment shows `reviewing.svg`), then holds the headline, chips with the number of blocking, should-fix and nit findings and how many earlier findings this push fixed, and a chip per check: ✅ checked with nothing found, ⚠️ only should-fix or nit findings, ❌ a blocking finding, ⬜ not checked (the model says it didn't do that check, and "What this PR does" names it), ➖ turned off on the dashboard. Checks the repo added on the dashboard share one chip, "Your checks", shown only when they found something. The last line gives the kind of change, the model's confidence and the reviewed commit.
- A table of blocking and should-fix findings. Each location links to the lines at the reviewed commit. A finding with an inline comment says "inline"; a finding outside the diff has its text in the table, and its suggested change, if any, in a fold below.
- The nits, folded.
- The earlier findings this push fixed, and how many files `skip` left out, one line each when there are any.
- "What this PR does", folded: what the PR claims, its impact, its scope and what the review couldn't check.
- A footer with the run link, the model the review ran on (and the subagents' model on a deep review), the effort and why `auto` picked them.

Inline comments go on the lines in the diff, one per blocking or should-fix finding, and nits too when the dashboard says to post them inline. A finding that already has an inline comment isn't posted again on the next push, and when a push fixes a finding, its thread is resolved.

A dry run prints the same text to the job log.

## What the review can do

The model reads the repo from the workflow's checkout, so keep the `actions/checkout` step. It uses `Read`, `Grep`, `Glob`, `git diff`, `git log` and `git show`, and a diff longer than 200,000 characters is cut, with the model reading the rest from the checkout. It never edits files, installs anything or runs the PR's code, and it doesn't load the repo's Claude Code settings, hooks or MCP servers.

A PR, or a comment on it, can try to talk the model into leaking something, so the review is fenced in:

- It can read and search only files inside the checkout. Paths outside it are refused, and so are `/proc`, `/sys`, the runner's temp and tool folders, and any symlink in the PR that points out of the checkout.
- Its only commands are `git diff`, `git log` and `git show`, with no shell operators, no `--no-index`, `--output` or `--ext-diff`, and no path outside the checkout.
- It runs with only `PATH`, `HOME` and the Claude token in its environment. The OIDC request token, the action's inputs and `GITHUB_TOKEN` aren't there, and the commands it runs don't get the Claude token either.
- The prompt has the PR's title, body, commits and diff, and only the comments of the repo's owners, members and collaborators. Comments from anyone else are left out.
- Images are stripped from everything the model writes before it's posted, so an image URL can't carry data out.
- The model can't plant a hidden marker in its text. The action reads its earlier summary and inline comments back only from comments `axonshaft[bot]` wrote, so a copy posted by someone else is ignored.
- Before anything is posted, the action replaces the tokens it holds with `***`, and it masks every token in the job log.

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
3. Merging that PR releases the version, for example `2.1.3`: the release workflow tags the merge commit `v2.1.3`, moves the `v2` tag to the same commit, and creates a GitHub Release with that version's changelog.

Workflows that use `axonpack/shaft-actions@v1` get every 1.x release. To stay on one version, use `@v1.1.0`.

## License

MIT
