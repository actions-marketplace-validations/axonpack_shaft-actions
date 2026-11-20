# Axon Shaft

A GitHub Action that reviews pull requests with Claude, using the Claude Agent SDK on your own GitHub runners.
The model reads the code and returns its findings as JSON. The action posts one summary comment, which it edits on every push, and one review with inline comments.

> [!NOTE]
> Task (`/fix` and `/axonshaft <prompt>` in a comment) isn't built yet.

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
- The action's own version, from its `package.json`, and the ref the workflow runs it at (`v1`, `v1.5.0`, a branch or a SHA), so the API can tell when a newer release is out.

A comment on the pull request's conversation tab doesn't carry the branch, so a run started from one sends the pull request without it.

When the job is on for that event, the API answers with a GitHub token for this repo only, the saved Claude token, the settings and the review prompt.
Comments come from `axonshaft[bot]` through that token, so the workflow's own token only needs `contents: read`.

After the review, the action sends the run to the dashboard, where it has its own page. It sends:

- the verdict, the model, the finding counts and the tokens used;
- the review card: the headline, each check's result and every finding, as the PR comment has them.

After a reply, it sends the model, the tokens used and the answer.

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
| `/ask <question>` | Answers a question about the code where it was asked, citing `file:line`, and never changes anything. Works on a pull request; on an issue it ends with a notice. See [Answering a question](#answering-a-question). |
| `/axonshaft <prompt>` | A direct prompt: Axon Shaft answers or makes the change. Not built yet: the run ends with a notice. |
| `/help` | `axonshaft[bot]` posts the list of commands on the pull request or issue, once. |

Who can run a command:

- The commenter needs write access to the repo, which the action checks with GitHub. Anyone else's command starts nothing, and the run ends with a notice that only people with write access can start one.
- `/help` works for anyone.

### Reactions on the comment

`axonshaft[bot]` reacts to the comment that started a run, so the commenter can see it was picked up and how it ended:

- 👀 when the run starts. For `/review`, `/fix`, `/ask` and `/axonshaft`, it comes after the write access check, so a comment from someone without write access gets no reaction. `/help` gets it from anyone.
- When the run ends, the 👀 is replaced with 🚀 if the run did its job (for `/ask`, once the answer is posted), or 😕 if it failed or did nothing, such as a command that isn't built yet or a run the API stopped.

GitHub has no reactions on a review's body, so a command in a review gets none, and neither does a pull request event. If GitHub refuses a reaction, the job log warns and the run carries on; if removing the 👀 fails, it stays next to the new one. A dry run logs the reactions and adds none.

What counts as a command:

- A command in a quote, in inline code or in a code block doesn't count.
- A longer word such as `/reviewer` doesn't count.
- Another bot that uses the same command will also start.

## Answering a question

`/ask <question>` runs the project's Reply job from the dashboard, with its prompt.

- A question on a line of the diff is answered in that line's thread. A question in the conversation tab or in a review's body gets a comment on the pull request.
- The model reads the pull request's head commit with the review's read-only tools and environment (see [What the review can do](#what-the-review-can-do)). It can't edit, commit or push.
- The prompt has the question and the line it's on, the PR's title, body, commits and diff after `skip`, and the other comments of people inside the repo (see [What the review can do](#what-the-review-can-do)).
- The answer cites `file:line` for its claims. It ends with the same footer line as the summary comment and is cut at 20,000 characters.
- With the model and effort on `auto`, it runs on `sonnet` at `medium` effort. With no turn limit set, the limit is 30.
- The dashboard gets the run with the model, the tokens and the answer. A reply has no verdict.
- When the model's session fails, the failure's card is posted where the question was asked, and the step fails.

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
| Merge gates | Up to 10 requirements every pull request must meet, in plain words. See [the merge gates check](#the-merge-gates-check). |

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
- The action knows the limit wasn't set when the Axon Shaft API marks it as its default. With an API too old to say so, the review uses the limit the API sent.
- When the action picked the limit by size, the footer's reason says so, such as `60 lines, up to 12 turns`.

## What gets posted

### The summary comment

Axon Shaft keeps one summary comment on the PR and edits it on every push. The first review creates it only once the result is ready, so GitHub emails people on the PR once, about the result. A review that fails also creates it, to show the failure. From the top, it holds:

1. A card in a GitHub alert, colored by verdict: red (`CAUTION`) for blocking, amber (`WARNING`) for needs changes, green (`TIP`) for looks good. See [the card](#the-card) below.
   When the workflow pins an older v1 release (such as `@v1.5.0`) and a newer one is out, a line under the card names the new version and links to its release, with the version the run used. It says to change `uses:` to `axonpack/shaft-actions@v1` to get each v1 release as it comes out. A run on `@v1`, a branch or a SHA never gets it.
2. "Merge gates", when the project has any: each gate with ✓ (met), ✗ (not met) or – (doesn't apply), and the review's reason.
3. A table of blocking and should-fix findings. Each location links to the lines at the reviewed commit.
   A finding with an inline comment says "inline". A finding outside the diff has its text in the table, and its suggested change, if any, in a fold below.
4. The nits, folded.
5. The earlier findings this push fixed, and how many files `skip` left out, one line each when there are any.
6. "Walkthrough", folded, for a pull request that changes three or more files: a table of the changed files grouped by area, with one line on what changed in each, and a Mermaid flow diagram when the pull request changes how its parts call each other.
   It's on by default, and "Walkthrough in the summary" on the dashboard turns it off. A walkthrough over 8 areas or 20 files in an area is left out, and so is a diagram that isn't a `flowchart` or has a `click` link.
7. "What this PR does", folded: what the PR claims, its impact, its scope and what the review couldn't check.
8. A footer with the run link, the model (and the subagents' model on a deep review), the effort, the tokens and why `auto` picked them.
   On an API key the tokens show as the cost and the total, such as `$0.38 · 759k tokens`.
   On a subscription they show as the cache-weighted count with the total in brackets, such as `≈220k billed (759k with cache)`. A cache write counts 1.25 times, a cache read a tenth, and input and output as they are. Every turn reads the cached prompt again, so the total can be several times what was billed.
   "Axon Shaft" in the footer links to the run's page on the dashboard. With an API that doesn't send the run's page, it links to the dashboard.
   The dashboard's Runs list shows the tokens split into input, output and cache, with the cost for a run on an API key.

#### The card

The card opens with the verdict's status card, an SVG from `https://shaft.axonpack.dev/status/<verdict>.svg`. On a later push, the comment switches to `reviewing.svg` while the review runs. GitHub sends no email when a comment is edited. Under it are the headline and these chips:

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
- When the job has [checklists](#checklists), there's one chip per checklist instead, under its name and in the job's order. A checklist that didn't run shows ⬜.

The card's last line gives the kind of change, the model's confidence and the reviewed commit.

### Progress while the review runs

The action shows that a review is running without anything that emails people:

- A check run named `Axon Shaft / review` on the reviewed commit. It's in progress while the review runs. It then passes, with a link to the summary comment, or fails, with the failure's message and a link to the run.

  The check is updated once at the start of each step. Its title is the current step, such as "Reviewing with Sonnet, effort medium" or "Posting the review". Its summary lists the steps, with ✓ on the ones done and the current one in bold, and says how far into the review that step started.
- An 👀 reaction on the `/review` comment, when a comment started the review. Every command gets one; see [Reactions on the comment](#reactions-on-the-comment).

The check run needs Checks (write) on the run's token. Without it the review still posts, the job log warns once, and the action skips the other check runs. If GitHub refuses a step's update, the job log warns once and the check gets no more step updates. The review carries on, and the check still gets its result at the end. A dry run logs the check, each step's title and the reaction, and posts none of them.

### The merge gates check

When the project has merge gates, the action also posts a check run named `Axon Shaft / gates` on the reviewed commit, with the gates' table as its summary.

- It fails when a gate isn't met, or when the review didn't report on one. A gate that doesn't apply passes.
- To block merging until every gate is met, add `Axon Shaft / gates` to the required status checks in the branch's protection rule or ruleset.
- The AxonShaft GitHub App needs the Checks (write) permission, approved on the repo's installation. Until it is, the review still posts, and the job log warns that the check couldn't be posted.
- A dry run logs the conclusion and posts nothing.

### A check run per review check

The action also posts one check run per review check on the reviewed commit, named after the check's key: `Axon Shaft / correctness`, `Axon Shaft / breakage`, `Axon Shaft / standards`, `Axon Shaft / tests`, `Axon Shaft / docs`, `Axon Shaft / security`, and `Axon Shaft / rules` for the checks the repo added. Each one's summary is a table of that check's findings.

| Card chip | Conclusion |
|---|---|
| ❌ A blocking finding | `failure` |
| ⚠️ Only should-fix or nit findings | `neutral` |
| ✅ Checked, nothing found | `success` |
| ⬜ Not checked | `skipped` |
| ➖ Turned off on the dashboard | no check run |

- `Axon Shaft / rules` is posted only when the repo's own checks found something, as the card's chip is.
- Any of them can be a required status check. GitHub treats `neutral` and `skipped` as passing, so a required check blocks merging only on a blocking finding.
- The run's token needs Checks (write), the same as for the gates check. The Axon Shaft API asks for it on every review run once its matching update ships. Until then it asks only when the project has merge gates, so on a project without gates the job log warns once and the review posts as usual.
- A dry run logs each conclusion and posts nothing.

When the job has [checklists](#checklists), each checklist gets its own check run instead, named after its key in the job's order, such as `Axon Shaft / access-control`, or `Axon Shaft / own-1` for the project's own checklists. A checklist that didn't run is `skipped`, and its title says why: "No matching files changed", or, for a script checklist, that this version of the action doesn't have its script yet.

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
- The prompt has the PR's title, body, commits and diff, and only the comments of people inside the repo: its owners, members and collaborators, and anyone GitHub's permission check gives admin or write access, such as a teammate with access through an org team. The action asks that check once per commenter. Comments from anyone else are left out, and so are those of a commenter it couldn't check, with a warning in the job log.
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
| `review_timed_out` | The review or reply ran past the time limit set on the dashboard. The link opens the dashboard. |
| `review_invalid_reply` | The model's reply didn't match the review or reply format twice, so nothing was posted. Both replies are in the job log, and the link opens the run. |
| `review_failed` | The review or reply stopped for another reason, such as an Agent SDK error or the turn limit. The link opens the run. |

### Runs that end with a notice

These end with a notice, and the step passes:

- a fork's pull request on `pull_request`;
- a job that's off for the event;
- a fork's pull request the dashboard holds back;
- a `/review` or `/ask` from someone without write access;
- a `/ask` on an issue;
- a project or account at its monthly spending cap (`spending_cap`), until the 1st (UTC) or until an admin raises the cap.

Any other error, such as GitHub's API failing, fails the step with that error's message.

## How the review prompt is built

The whole prompt comes from the repo's Code review job on the dashboard. It holds the steps the review walks, the safety rules, the shape of the reply and the repo's review rules.
On a deep review it also holds the subagents for the correctness, breakage and security checks.

A check can be turned off there, and the repo can add checks of its own. Findings from an added check are labelled `rules`.

The action fills the prompt's slots with the run's data and changes nothing else:

- the repo and pull request number;
- the branches and head commit;
- the title, author, body and commits;
- the comments of people inside the repo (see [What the review can do](#what-the-review-can-do));
- the previous review's findings;
- how many files `skip` left out;
- the diff, with each `focus` file marked.

It also fills in the repo's guides as the base branch has them, whichever exist:
`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.github/CONTRIBUTING.md`, `CONVENTIONS.md`, `.github/pull_request_template.md` and the root `README.md`. Each is cut at 8,000 characters, and all of them together at 30,000.

The guides set the standards the review checks against, such as needing a test or a README line for each change. Since they come from the base branch, a PR can't change the copies its own review reads.

### Checklists

An Axon Shaft API that sends the job's checklists also sends the prompt with its steps left open. The action then decides which checklists run on this pull request:

- A checklist runs when a changed file, after `skip`, matches one of its `paths`. `**` matches any change, including files under folders such as `.github/`.
- A script checklist runs a script built into the action in place of the model. The script reads the diff, the pull request's description, the guides and files in the checkout. It never runs the repo's code, and only `osv` calls the network. Its findings are posted like the model's, inline and in the summary, and set its check run. A blocking or should-fix finding from a script raises the review's verdict. When only script checklists run, no model is called. The action has these scripts so far:
  - `secrets` (Secrets): keys and tokens in a known format on added lines, such as AWS, GitHub, Anthropic, OpenAI, Stripe, Slack, Google and npm keys, and private keys. A finding names the kind of key and the line, never the value. Blocking.
  - `pr-meta` (Pull request basics): each section of `.github/pull_request_template.md` that the description leaves out or leaves empty, no linked issue when the template asks for one, and a title that isn't a Conventional Commit when a guide asks for them. Nits.
  - `env-vars` (Config and env vars): an env var read in an added line that no `.env.*` example file or Markdown doc in the repo names. Names the platform sets, such as `NODE_ENV`, `CI` and `GITHUB_*`, are left out. Should fix.
  - `schema-pairs` (Schema and migration in step): a database schema file changed with no migration in the pull request, or a migration with no schema change in a repo that has a schema file. Blocking.
  - `osv` (Known vulnerabilities): each package version a lockfile adds or changes (from `deps-diff` below) is checked against the advisories on osv.dev. A finding names the advisory (its `GHSA-` ID when it has one), the package, its version, the versions that fix it and the line in the lockfile. Blocking for an advisory rated high or critical, or a known malicious package; should fix for anything lower or unrated.
    - Sent to osv.dev, in one `POST /v1/querybatch` (one per 1,000 versions): the ecosystem, name and version of each public package the pull request adds or changes. Then one `GET /v1/vulns/<id>` for each advisory found, to get its rating and fixed versions.
    - Never sent: scoped packages (`@scope/name`), packages from a private registry, git or a URL, any npm package when the repo's `.npmrc`, `.yarnrc`, `.yarnrc.yml` or `bunfig.toml` sets a default registry other than npm's, any `requirements*.txt` package when the file names an index other than PyPI, Go modules under the repo's own owner in `go.mod`, versions the pull request removes or leaves as they were, and anything about the repo or who runs it. The `User-Agent` names only the action.
    - When osv.dev fails or takes longer than 10 seconds, the action asks GitHub's advisory database instead (`GET /advisories?affects=<name>@<version>`), with the run's GitHub token, one call per version, for at most 50 versions. When both fail, the checklist is skipped with the reason, and never passes. Every call times out after 10 seconds, and the whole check after 60.
    - To stop sending anything, turn off Known vulnerabilities in the job on the dashboard. There's no separate setting yet.
- A script checklist whose script the action doesn't have yet is skipped. So is one whose script can't do its check, with the reason on its check run.
- A `script+model` checklist runs in the model like any other checklist, and its pre-step adds facts for the model after the steps, under "Facts from the pre-steps". Each pre-step runs once, however many checklists use it, and its facts are cut at about 4,000 tokens. When a pre-step fails, its facts say why and the checklist still runs. The action has this pre-step so far:
  - `deps-diff` (Dependencies, Supply chain): each package a lockfile adds, removes or changes, with its versions before and after and its line in the lockfile. It compares the base branch's copy, read through the GitHub API, with the checkout's, and never runs a package manager. It reads `package-lock.json` and `npm-shrinkwrap.json` (npm 7 and later), `bun.lock`, `yarn.lock` (Yarn 1 and 2+), `pnpm-lock.yaml` (pnpm 8 and later), the pinned `==` lines of `requirements*.txt`, `poetry.lock`, `uv.lock`, `Cargo.lock` and `go.sum`. A version that doesn't come from the public registry is marked as such.
- The run's data comes first in the prompt and the steps come last, numbered from 1: the steps that always run first, the step of each checklist that runs, then the job's own instructions and the steps that always run last. Everything before the steps is the same whichever checklists run.
- A finding's `step` can only name a checklist that runs.
- When no checklist runs, no model is called. The summary comment says so, with a chip for each checklist, and each check run is skipped. A project with merge gates still gets a review, because only the model can judge the gates.
- The run's page on the dashboard gets the model session's model, tokens and the checklists it ran.

With an API that doesn't send checklists, the action runs the prompt it gets, as 1.5 did.

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

Workflows that use `axonpack/shaft-actions@v1` get every 1.x release. To stay on one version, use `@v1.1.0`. A run on a pinned version that's older than the newest v1 release gets a line about it under the summary card, and the project's overview on the dashboard shows the same to admins.

## License

MIT
