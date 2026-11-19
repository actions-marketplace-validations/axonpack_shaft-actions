# Axon Shaft

A GitHub Action that reviews pull requests with Claude, using the Claude Agent SDK on your own GitHub runners.
The model reads the code and returns its findings as JSON. The action posts one summary comment, which it edits on every push, and one review with inline comments.

> [!NOTE]
> Task and Reply (`/fix`, `/ask` and `/axonshaft <prompt>` in a comment) are not built yet.

## Quick start

Axon Shaft needs its dashboard. The action holds no settings and no prompt of its own: each run gets its tokens, its settings and the whole review prompt from the Axon Shaft API.

1. Install the [AxonShaft app](https://github.com/apps/axonshaft/installations/new) on the repo.
2. Sign in on [shaft.axonpack.dev](https://shaft.axonpack.dev), add the repo as a project, and save a Claude token for the repo or its account:
   - With a Pro or Max plan, save the output of `claude setup-token`.
   - With Console billing, save an API key.
   - An OAuth token belongs to one person's plan, so a repo that several people use is better on an API key.
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
       # Skip comments with no line that starts with /, and bots' comments (Axon Shaft's own included),
       # so they don't start a runner. The action picks out the command: /review, /fix, /ask, /axonshaft or /help.
       if: >-
         github.event_name == 'pull_request_target' ||
         (github.event.sender.type != 'Bot' &&
         contains(format('{0}{1}{0}{2}', fromJSON('"\n"'), github.event.comment.body, github.event.review.body), format('{0}/', fromJSON('"\n"'))))
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v7
           with:
             # Leaves no token in .git/config for the model to read.
             persist-credentials: false
         - uses: axonpack/shaft-actions@v1
   ```

4. Open a pull request. To see the output in the job log before anything is posted, add `with: { dry_run: true }`.

## How a run works

The workflow holds no secrets. With `id-token: write`, the action gets an OIDC token for the run and sends it to the Axon Shaft API.

Along with the token, it sends:

- The job: `review` for a pull request event or a `/review` comment, `task` for `/fix` or `/axonshaft <prompt>`, `reply` for `/ask`, and `help` for `/help`.
- Which pull request event it was, and whether the pull request comes from a fork.
- The pull request's number, title, branch and author, for the dashboard's overview.
- The branch it goes into, its author's association with the repo, and whether a bot opened it, for the Code review job's filters.

A comment on the pull request's conversation tab doesn't carry the branch, so a run started from one sends the pull request without it.

When the job is on for that event, the API answers with a GitHub token for this repo only, the saved Claude token, the settings and the review prompt.
Comments come from `axonshaft[bot]` through that token, so the workflow's own token only needs `contents: read`.

After the review, the action sends the run to the dashboard, where it has its own page. It sends:

- the verdict, the model, the finding counts and the tokens used;
- the review card: the headline, each check's result and every finding, as the PR comment has them.

A run that fails after the API opened it sends its error instead. If recording the run fails, the action logs a warning and the run still passes.

### When a run posts nothing

The API tells the action to stop, and the run ends with a notice giving the reason, when:

- the Code review job is off on the dashboard;
- the event isn't one of its "When it runs" choices;
- its "Which pull requests" filters skip this one (outside contributors, bots, Axon Shaft's own, or a branch it isn't set to review);
- an admin paused Axon Shaft on the repo from the project's settings.

## Pull requests from forks

The Code review job's "Pull requests from forks" setting on the dashboard decides what happens:

| Setting | What happens |
|---|---|
| Review automatically (the default) | The review runs as it does for any other pull request. |
| Ask a maintainer first | `axonshaft[bot]` comments that someone with write access can start the review by commenting `/review`, and the run ends with a notice. Later pushes don't post it again. |
| Only when a maintainer comments /review | Nothing is posted and the run ends with a notice. A review starts only from a `/review` comment. |

This needs the workflow on `pull_request_target`, as in the quick start. On `pull_request`, GitHub gives a fork's run no OIDC token, so Axon Shaft skips it with a notice.

### How the pull request's code is checked out

On `pull_request_target`, and on a comment, the workflow's checkout holds the base branch. The action fetches the pull request's head commit with the GitHub token from the API and checks it out detached for the model to read.

- The token goes on that one `git fetch` command and is never saved in `.git/config`.
- The PR's code is never run.
- The fetch is as deep as the checkout: one commit by default, or the whole history with `fetch-depth: 0`. The whole history lets the model run `git log` and `git diff` against the base branch.
- Keep `persist-credentials: false` on the checkout, so the workflow's own token isn't left in `.git/config` either.

## Commands

A comment starts Axon Shaft with a command at the start of a line. It works in the conversation, on a line or in a review. Mentioning `@axonshaft` starts nothing.

| Command | What it does |
|---|---|
| `/review` | Reviews the pull request's latest commit now. Works on any pull request, from a fork or not, whatever the "When it runs" and "Pull requests from forks" settings say. On an issue it ends with a notice. |
| `/fix` | Fixes what the last review found, or what follows the command. Not built yet: the run ends with a notice. |
| `/ask <question>` | Answers a question about the code without changing it. Not built yet: the run ends with a notice. |
| `/axonshaft <prompt>` | A direct prompt: Axon Shaft answers or makes the change. Not built yet: the run ends with a notice. |
| `/help` | `axonshaft[bot]` posts the list of commands on the pull request or issue, once. |

Who can run a command:

- The commenter needs write access to the repo, which the action checks with GitHub. Anyone else's command starts nothing, and the run ends with a notice that only people with write access can start one.
- `/help` works for anyone.

What counts as a command:

- A command in a quote, in inline code or in a code block doesn't count.
- A longer word such as `/reviewer` doesn't count.
- Another bot that uses the same command will also start.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `dry_run` | `false` | Print the summary and inline comments to the job log instead of posting them. |

## Outputs

| Output | What it holds |
|---|---|
| `verdict` | `blocking`, `needs-changes` or `looks-good`. |
| `findings` | The number of blocking and should-fix findings. |
| `summary_url` | The link to the summary comment. Empty on a dry run. |

## Settings on the dashboard

Everything else is set on the dashboard:

| Setting | What it does |
|---|---|
| Model | The model the review runs on, or `auto`. |
| Effort | The effort, or `auto`. |
| Depth | A deep review adds subagents for the correctness, breakage and security checks. |
| Nits | How nits are shown, including whether they get inline comments. |
| Turn limit | The most turns the model may take. Left unset, the action picks it from the diff's size. See [the turn limit by size](#the-turn-limit-by-size). |
| Time limit | How long the review may run. |
| Review rules | The repo's own rules for the review. |
| `skip` globs | Files to leave out of the review. |
| `focus` globs | Files that get a closer look. |
| Environment variables | Extra runner variables the model's environment gets, by name. See [what the review can do](#what-the-review-can-do). |

### Model and effort on auto

With the model and effort on `auto`, the action picks both from the diff, after `skip`. The first row that matches wins:

| The diff | Model | Effort |
|---|---|---|
| Touches a `focus` path or a sensitive one: auth, crypto, payments, billing, workflows, migrations, or dependencies in `package.json` | `opus` | `high` |
| Any diff on a deep review | `opus` | `high` |
| Over 1,000 changed lines or over 30 files | `opus` | `medium` |
| Only docs, comments, lockfiles or config | `haiku` | `low` |
| Anything else | `sonnet` | `medium` |

- A model or effort set on the dashboard turns `auto` off for that one only.
- On a deep review the subagents run on `sonnet` when the model is `auto`, and on the set model when it isn't.
- If the Claude plan can't use the model `auto` picked, the review falls back to the next smaller one and the footer says so.
- The footer always shows the model, the effort, the tokens the run used (see [the summary comment](#the-summary-comment)) and the reason.

### The turn limit by size

With no turn limit set on the dashboard, the action picks one from the diff's changed lines, after `skip`:

| The diff | Turn limit |
|---|---|
| Under 100 lines | 12 |
| Under 500 lines | 20 |
| 500 lines or more, or a deep review | 30 |

- A limit set on the dashboard always wins.
- When the action picked the limit by size, the footer's reason says so, such as `60 lines, up to 12 turns`.

## What gets posted

### The summary comment

Axon Shaft keeps one summary comment on the PR and edits it on every push. From the top, it holds:

1. A card in a GitHub alert, colored by verdict: red (`CAUTION`) for blocking, amber (`WARNING`) for needs changes, green (`TIP`) for looks good. See [the card](#the-card) below.
2. A table of blocking and should-fix findings. Each location links to the lines at the reviewed commit.
   A finding with an inline comment says "inline". A finding outside the diff has its text in the table, and its suggested change, if any, in a fold below.
3. The nits, folded.
4. The earlier findings this push fixed, and how many files `skip` left out, one line each when there are any.
5. "What this PR does", folded: what the PR claims, its impact, its scope and what the review couldn't check.
6. A footer with the run link, the model (and the subagents' model on a deep review), the effort, the tokens and why `auto` picked them.
   On an API key the tokens show as the cost and the total, such as `$0.38 · 759k tokens`.
   On a subscription they show as the cache-weighted count with the total in brackets, such as `≈220k billed (759k with cache)`. A cache write counts 1.25 times, a cache read a tenth, and input and output as they are. Every turn reads the cached prompt again, so the total can be several times what was billed.
   "Axon Shaft" in the footer links to the run's page on the dashboard. With an API that doesn't send the run's page, it links to the dashboard.
   The dashboard's Runs list shows the tokens split into input, output and cache, with the cost for a run on an API key.

#### The card

The card opens with the verdict's status card, an SVG from `https://shaft.axonpack.dev/status/<verdict>.svg`. While the review runs, the comment shows `reviewing.svg`. Under it are the headline and these chips:

- The number of blocking, should-fix and nit findings, and how many earlier findings this push fixed.
- One chip per check:

  | Chip | Meaning |
  |---|---|
  | ✅ | Checked, nothing found. |
  | ⚠️ | Only should-fix or nit findings. |
  | ❌ | A blocking finding. |
  | ⬜ | Not checked: the model says it didn't do that check, and "What this PR does" names it. |
  | ➖ | Turned off on the dashboard. |

- Checks the repo added on the dashboard share one chip, "Your checks", shown only when they found something.

The card's last line gives the kind of change, the model's confidence and the reviewed commit.

### Inline comments

- One inline comment per blocking or should-fix finding, on its lines in the diff. Nits get one too when the dashboard says to post them inline.
- A finding that already has an inline comment isn't posted again on the next push.
- When a push fixes a finding, its thread is resolved.

A dry run prints the same text to the job log.

### The job log

The job log folds each step into its own group, with how long it took:

1. Config from the dashboard
2. Check out the pull request (on `pull_request_target` and comments)
3. Read the pull request
4. Review
5. Post the review

The Review group lists each tool call the model made, such as `Read src/pay.ts` or `Grep retry\(`.
A deep pass's calls carry its name first, such as `[security] Grep exec\(`. The run's page on the dashboard shows this log once the job ends.

## What the review can do

The model reads the repo from the workflow's checkout, so keep the `actions/checkout` step.
It uses `Read`, `Grep`, `Glob`, `git diff`, `git log` and `git show`.
A diff longer than 200,000 characters is cut, and the model reads the rest from the checkout.

It never edits files, installs anything or runs the PR's code. It doesn't load the repo's Claude Code settings, hooks or MCP servers.

A PR, or a comment on it, can try to talk the model into leaking something, so the review is fenced in:

- It can read and search only files inside the checkout. Paths outside it are refused, and so are `/proc`, `/sys`, the runner's temp and tool folders, and any symlink in the PR that points out of the checkout.
- Its only commands are `git diff`, `git log` and `git show`, with no shell operators, no `--no-index`, `--output` or `--ext-diff`, and no path outside the checkout.
- Its environment holds only the Claude token, the runner variables listed below, and the names the project's Environment variables setting adds.
  That setting can't add `GITHUB_TOKEN` or a name that starts with `ACTIONS_`, `INPUT_`, `ANTHROPIC_` or `CLAUDE_`.
  So the OIDC request token, the action's inputs, `GITHUB_TOKEN` and the GitHub token from the API are never there.
  The commands the model runs don't get the Claude token either.
- The prompt has the PR's title, body, commits and diff, and only the comments of the repo's owners, members and collaborators. Comments from anyone else are left out.
- Images are stripped from everything the model writes before it's posted, so an image URL can't carry data out.
- The model can't plant a hidden marker in its text. The action reads its earlier summary and inline comments back only from comments `axonshaft[bot]` wrote, so a copy posted by someone else is ignored.
- Before anything is posted, the action replaces the tokens it holds with `***`. It masks every token in the job log.

<details>
<summary>Runner variables the model's environment always gets</summary>

`PATH`, `HOME`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `CI`, `GITHUB_ACTIONS`, `RUNNER_OS`, `RUNNER_ARCH`, `GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_REF` and `GITHUB_WORKSPACE`, when the runner has them.

</details>

## When a run fails

The step fails with a message that says what to do. The job summary shows a card for the failure, the same message and, when there is one, a link to where to fix it.

The card is an image of the failure's code from `https://shaft.axonpack.dev/errors/<code>.svg`. When the review itself fails, the PR's summary comment shows the same card, message and link.

### Codes from the Axon Shaft API

| Code | What it means |
|---|---|
| `not_installed` | The AxonShaft app isn't installed on the repo. The link opens the install page. |
| `not_a_project` | The app is installed, but the repo isn't a project on the dashboard yet. The link opens the page to add it. |
| `no_claude_token` | Neither the project nor its account has a Claude token saved. |
| `oidc_invalid` | The API refused the run's OIDC token because it was bad, expired or already used. |
| `event_not_allowed` | The API doesn't take runs started by this workflow event. |
| `rate_limited` | The repo is over its rate limit. Wait a little and rerun the job. |
| `api_error` | The API failed, or its answer couldn't be used: a setting the action can't run with, or an error page from something in front of the API. |

### Codes from the action

| Code | What it means |
|---|---|
| `missing_id_token` | The workflow has no `permissions: id-token: write`, so the action can't sign in to the API. |
| `api_unreachable` | The action couldn't reach the API, or the API took over 30 seconds to answer. |
| `review_timed_out` | The review ran past the time limit set on the dashboard. The link opens the dashboard. |
| `review_invalid_reply` | The model's reply didn't match the review format twice, so nothing was posted. Both replies are in the job log, and the link opens the run. |
| `review_failed` | The review stopped for another reason, such as an Agent SDK error or the turn limit. The link opens the run. |

### Runs that end with a notice

These end with a notice, and the step passes:

- a fork's pull request on `pull_request`;
- a job that's off for the event;
- a fork's pull request the dashboard holds back;
- a `/review` from someone without write access.

Any other error, such as GitHub's API failing, fails the step with that error's message.

## How the review prompt is built

The whole prompt comes from the repo's Code review job on the dashboard. It holds the steps the review walks, the safety rules, the shape of the reply and the repo's review rules.
On a deep review it also holds the subagents for the correctness, breakage and security checks.

A check can be turned off there, and the repo can add checks of its own. Findings from an added check are labelled `rules`.

The action fills the prompt's slots with the run's data and changes nothing else:

- the repo and pull request number;
- the branches and head commit;
- the title, author, body and commits;
- the comments of the repo's owners, members and collaborators;
- the previous review's findings;
- how many files `skip` left out;
- the diff, with each `focus` file marked.

It also fills in the repo's guides as the base branch has them, whichever exist:
`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.github/CONTRIBUTING.md`, `CONVENTIONS.md`, `.github/pull_request_template.md` and the root `README.md`. Each is cut at 8,000 characters, and all of them together at 30,000.

The guides set the standards the review checks against, such as needing a test or a README line for each change. Since they come from the base branch, a PR can't change the copies its own review reads.

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

1. A PR that changes something users would notice adds a changeset. Run `bun run changeset`, pick the bump, and describe the change in a line or two.
2. Each push to `main` with changesets pending opens or refreshes the Version Packages PR. It raises the version in `package.json`, adds the changes to `CHANGELOG.md` and rebuilds `dist/index.js`.
3. Merging that PR releases the version, for example `2.1.3`. The release workflow tags the merge commit `v2.1.3`, moves the `v2` tag to the same commit, and creates a GitHub Release with that version's changelog.

Workflows that use `axonpack/shaft-actions@v1` get every 1.x release. To stay on one version, use `@v1.1.0`.

## License

MIT
