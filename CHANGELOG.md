# shaft

## 1.7.0

### Minor Changes

- a684178: - **Advisory links**: a Known vulnerabilities finding links each advisory ID to its page, GitHub's advisory page for a `GHSA-` ID or the record on osv.dev for any other. The finding's row in the summary and on its check run links to its most severe advisory, and the check run's details link goes there too. The run report sends the link to the Axon Shaft API with the finding.
- 1a389e8: - **Facts for nine more checklists**: eight new pre-steps hand the model facts, placed after the steps in the prompt. Changelog and changeset gets the changed packages and the changesets that name them. Docs gets the docs files changed and the READMEs above changed code that stayed the same. Tests gets each changed source file with its changed test, an existing one, or none. File and folder structure gets each new file's folder, suffix and name case. Does what it says gets the lines changed by area and kind of file. Personal data and logs, and Logs and metrics, get the log, metric, analytics and error-report calls the diff adds. Feature flags gets the flags read and dropped and where the repo still names them. Type safety gets the type escapes added and the repo's settings for them. The scripts read only the diff and the checkout's files, and never run the repo's code.
- 0f47be7: - **More pre-step facts**: What else it can break, Unused code, Unchecked generated code, Public API, Access control, Translations, Theme and design tokens, and Native and store now get facts from a script, placed after the steps in the prompt. They list the files that name each changed export, new exports no other file names, imports no manifest lists, exports before and after, new routes with the auth checks near them, locale keys the other locales lack, raw colours and sizes, and native changes with the runtime version before and after. The scripts read only the diff and the checkout, and never run the repo's code.
- ce10fa0: - **Labels for the skip filter**: the action sends the pull request's label names to the Axon Shaft API, from the pull request or, for a comment, its issue. With them, the Code review's new "Skip pull requests with these labels" filter can skip a pull request labelled `skip-review`, `no-review`, `skip-ai-review` or `do-not-review`, or whatever list the project sets. Comment `/review` to review a labelled pull request anyway.

### Patch Changes

- 7c1d587: - **What this PR does**: the Claim, Impact, Scope and Not checked lines in the summary's folded section each sit in their own paragraph, with a blank line between them.
  - **Summary card**: the two chip rows are labelled Findings and Checks, and the last line marks the kind of change, the confidence and the reviewed commit with an icon each, with the commit linked to GitHub.

## 1.6.0

### Minor Changes

- 6b27db8: - **Newer release notice**: the action sends its version and the ref the workflow runs it at (`v1`, `v1.5.0`, a branch or a SHA) when it asks the Axon Shaft API for its tokens. When the workflow pins an older v1 release and a newer one is out, the summary comment has a line under the card with the new version, a link to its release, and how to get each v1 release as it comes out: change `uses:` to `axonpack/shaft-actions@v1`. Runs on `@v1`, a branch or a SHA get no line.
- 203e5ae: - **Checklists**: when the Axon Shaft API sends the job's checklists, only the ones whose paths match a changed file (after `skip`) run, and each gets its own check run, `Axon Shaft / <key>`, in the job's order. One that didn't run is skipped and says why. The prompt puts the run's data first and the steps of the checklists that run last, and a finding can only name one of them. When none run, no model is called: the summary comment says so and every check run is skipped, unless the project has merge gates. Script checklists report as skipped until the action has their scripts. The run's page on the dashboard gets the session's model, tokens and checklists. With an API that doesn't send checklists, the review runs as before.
- 316164a: - **Lockfile facts**: Dependencies and Supply chain now get a list of the packages each lockfile adds, removes or changes, with the versions before and after, placed after the steps in the prompt. It covers npm, Bun, Yarn, pnpm, pip `requirements*.txt`, Poetry, uv, Cargo and Go lockfiles, compares the base branch's copy with the pull request's, and never runs a package manager.
- 889e1f3: - **Known vulnerabilities**: now runs as a script, with no model call. Each package version a lockfile adds or changes is checked against osv.dev, and against GitHub's advisory database when osv.dev fails. A finding names the advisory, the package, its version and the fixed versions, and is blocking when the advisory is rated high or critical. Only public packages are sent. Scoped packages, private registry, git and URL packages are never sent, and nothing about the repo is. When neither source answers, the checklist is skipped with the reason and never passes.
- f41aa54: - **One email for the first review**: the summary comment is now created when the result is ready. It no longer opens with a "Reviewing" card that GitHub emailed everyone about. On a later push the comment still switches to "Reviewing", since an edit sends no email. A failed review still creates the comment with its failure card.
  - **Progress without emails**: an `Axon Shaft / review` check run is in progress while the review runs. It then passes with a link to the summary comment, or fails with the failure's message. A dry run logs it and posts nothing.
  - **Reactions on every command**: the comment that started a run gets 👀 when it starts, after the write access check (`/help` gets it from anyone). When the run ends, the 👀 is replaced with 🚀 if it did its job, or 😕 if it failed or did nothing, such as a command that isn't built yet. A refused reaction only warns, and a dry run logs the reactions and adds none.
- fc65456: - **`/ask` answers questions**: a comment with `/ask <question>` on a pull request runs the project's Reply job. The model reads the head commit with the review's read-only tools and environment. Its answer cites `file:line` and goes where the question was asked: in the line's thread for a comment on the diff, or as a comment on the pull request. It never edits, commits or pushes. Only people with write access can ask, and `/ask` on an issue ends with a notice. The run goes to the dashboard with the model, the tokens and the answer. If the session fails, its failure card is posted in the same place.
- 6b01f74: - **Review progress in the checks box**: the `Axon Shaft / review` check run is updated once at the start of each step. Its title is the current step, such as "Reviewing with Sonnet, effort medium", and its summary lists the steps with ✓ on the ones done, the current one in bold, and how far into the review that step started. If GitHub refuses an update, the job log warns once and the step updates stop, while the review goes on. A dry run logs each step's title.
- 8ee47dc: - **Script checklists**: Secrets, Pull request basics, Config and env vars, and Schema and migration in step now run as scripts built into the action, with no model call. They read the diff, the pull request's description and files in the checkout, and never run the repo's code. Their findings post inline and in the summary, set their check runs, and raise the verdict. When only script checklists run, no model is called. A Secrets finding names the kind of key and the line, never the value.
- 583fb39: - **`/fix` and `/axonshaft` make changes**: on a pull request, `/fix <what>` and `/axonshaft <prompt>` run the project's Task job, and a bare `/fix` takes the open findings of the last review. With no review yet, or nothing open, a bare `/fix` only replies in one line saying so and ends with a notice. The model edits the head commit's checkout and may run the repo's own install, test, lint, build and format commands. It never gets a GitHub token and can't run `git commit`, `git push`, `gh` or install a package by name. The action then runs the checks again itself, asks the API for a Contents-write token only once they pass, and commits as `axonshaft[bot]` to the pull request's branch through GitHub's API, never forced, revoking the token afterwards. The reply lists the changed files, the commit and each check. If a check fails, nothing is pushed and the reply shows the output.
  - **The commands run in a sandbox**: the model's commands and the action's checks run in bubblewrap, with their own PID namespace and `/proc`, no `sudo`, an empty home folder and the checkout as the only folder they can write. Background commands are off, and every sandbox is killed when the session ends, before the change is read. The action installs bubblewrap on an Ubuntu runner when it's missing. Where the sandbox can't start, the task doesn't run and the run reports `sandbox_unavailable`. A task runs only on a GitHub-hosted runner: on a self-hosted one it doesn't run and the run reports `self_hosted_unsupported`. A checkout that kept its token in `.git/config` (no `persist-credentials: false`) is refused too, with `credentials_in_checkout`.
  - **What a commit may hold**: a change under `.github/` (in any case) is refused, and the model can't edit files there. So is a change of more than 200 files, a file over 1 MB or more than 10 MB in all. A change to a `package.json`, a Makefile or a lock file is listed in the reply under "Read before merging". Values of the project's Environment variables are masked in the log and taken out of the reply.
  - **Push mode is enforced before the session**: Disabled, a fork's pull request or a branch that is the default branch ends with a reply and a notice saying why, and the run reports `push_failed`. Nothing is ever pushed to the default branch or with `--force`.
  - `/fix` and `/axonshaft` on an issue end with a notice.
  - **Read the bot's commit before merging**: its push starts the repo's CI on the pull request like any push. Tasks start from the Conversation tab, since a comment in a review thread runs the pull request's own workflow.

### Patch Changes

- f2ff893: - **Comments from teammates with team access**: the review now reads the comments of anyone with admin or write access to the repo, as GitHub's permission check reports it, along with its owners, members and collaborators. Before, a teammate whose access came through an org team, or whose org membership is private, had their comments left out, so a reply such as "this is intentional" didn't reach the next review. The action asks once per commenter. When the check fails, that commenter's comments stay out and the job log warns.

## 1.5.0

### Minor Changes

- 9c131dc: - **A check run per review check**: next to `Axon Shaft / gates`, the action posts `Axon Shaft / <check>` on the reviewed commit for each check that's on, such as `Axon Shaft / correctness`, with that check's findings as its summary. A blocking finding fails it, other findings make it neutral, a clean check passes, and a check the review didn't do is skipped. A check turned off on the dashboard gets no run. Each one can be required in branch protection. They need Checks (write) on the run's token, which the Axon Shaft API asks for on every review run once its matching update ships. Without it the review still posts and the log warns once.

## 1.4.0

### Minor Changes

- d876106: - **Merge gates**: when the project has merge gates on the dashboard, the summary comment lists each gate as met, not met or not applicable, with the review's reason, and the action posts an `Axon Shaft / gates` check run on the reviewed commit. The check fails when a gate isn't met or the review didn't report on it, so branch protection can require it. The AxonShaft GitHub App needs the Checks (write) permission for the check; without it the review still posts and the log warns.
- 3ece49d: - **Walkthrough**: the summary comment can have a folded "Walkthrough" with a table of the changed files grouped by area, one line on what changed in each, and a Mermaid flow diagram when the pull request changes a flow. The API asks for it when Code review's "Walkthrough in the summary" option is on, which is the default. A walkthrough over the limits (8 areas, 20 files in an area) is left out, and the review posts without it.

### Patch Changes

- 55ca763: - **Marketplace listing**: `action.yml` has a blue `check-circle` icon and a shorter description, so the action can be listed on GitHub Marketplace.
- 6adad31: - **Footer tokens**: the summary footer shows the cost and the total on an API key, such as `$0.38 · 759k tokens`, and on a subscription the cache-weighted count with the total in brackets, such as `≈220k billed (759k with cache)`. The raw total counted every cached read and looked several times bigger than the bill.
  - **Footer link**: "Axon Shaft" in the summary footer opens the run's page on the dashboard when the API sends it, and the dashboard otherwise.
  - **Turn limit by size**: with no turn limit set on the dashboard, a review of under 100 changed lines gets 12 turns and one under 500 gets 20, and the footer's reason says so, such as `60 lines, up to 12 turns`. Larger diffs and deep reviews keep 30, and a limit set on the dashboard always wins.

## 1.3.0

### Minor Changes

- acb9773: - **Review filters**: the action also sends the branch a pull request goes into, its author's association with the repo, and whether a bot opened it. The API uses them for Code review's new filters (outside contributors, bots, Axon Shaft's own pull requests, target branches). When a filter skips a pull request, the run ends with a notice that says why.
- e861bed: - **Run page**: the run sent to the dashboard has the review card (headline, each check's result and every finding), and a run that fails after it started sends its error, so the dashboard can show both.
  - **Job log**: each step is a folded group with how long it took, and the Review group lists each tool call the model made, with a deep pass's name before its own.
- e7980c8: - **Pull request on the dashboard**: the action sends the pull request's number, title, branch and author when it asks the API for its tokens, so the dashboard's overview can show which PR each run was for. A run started from a comment on the conversation tab sends it without the branch, since that event doesn't include one.
- f9c7345: - **Environment**: the model's environment holds a short list of the runner's variables (`PATH`, `HOME`, locale, time zone, temp folder and the CI basics) plus the names set in the project's Environment variables setting, never a token. `ACTIONS_*`, `INPUT_*`, `ANTHROPIC_*`, `CLAUDE_*` and `GITHUB_TOKEN` can't be added.
- cc6f56d: - **Tokens**: the summary comment's footer shows how many tokens the review used, and the run sent to the dashboard has the input, output and cache counts. For a run on an API key it also has the cost.

## 1.2.0

### Minor Changes

- 56a5e8c: - **Slash commands**: a comment starts Axon Shaft with `/review`, `/fix`, `/ask`, `/axonshaft <prompt>` or `/help` at the start of a line. `/review` reviews the pull request now, `/help` posts the list of commands, and `/fix`, `/ask` and `/axonshaft` end with a notice until Task and Reply are built. Commands in quotes or code don't count
  - **`@axonshaft` removed**: mentioning `@axonshaft` no longer starts anything; use `/review`
  - **Workflow trigger**: the workflow's `if:` starts only on a comment with a line that begins with `/`; copy the new one from the README or the dashboard

## 1.1.0

### Minor Changes

- c57eaf3: - **The dashboard is required**: every run gets its GitHub token, Claude token, settings and whole review prompt from shaft.axonpack.dev, so the workflow needs `permissions: id-token: write` and the repo needs a project there
  - **The prompt comes from the dashboard**: the review steps, the safety rules and the deep review's subagents are all set there, and the action only fills in the pull request's data
  - **Inputs removed**: `claude_code_oauth_token`, `anthropic_api_key`, `app_id`, `private_key`, `github_token`, `model`, `effort`, `depth`, `mode`, `max_turns`, `timeout_minutes`, `nits`, `task_tools` and `config_path` are gone, and `dry_run` is the only input left. Set the model, effort, depth, nits and limits on the dashboard
  - **Standalone mode removed**: the action no longer runs on a Claude token and a GitHub token given as inputs
  - **`.github/shaft.yml` is no longer read**: set `rules`, `skip` and `focus` on the dashboard instead
  - **Failures say what to do**: a failed run shows a card for its code, a message and a link in the job summary, and a failed review shows the same in the PR's summary comment. The README lists each code
  - **Pull requests from forks**: run the workflow on `pull_request_target`, with `persist-credentials: false` on its checkout, and a fork's pull request is reviewed as the dashboard's "Pull requests from forks" setting says. Anyone with write access can also start a review of a pull request by commenting `@axonshaft review`
  - **Status cards**: the summary comment opens with a card for its status from the dashboard, Reviewing while the review runs, then Looks good, Needs changes or Blocking.

## 1.0.0

### Major Changes

- 40df341: - **Pull request reviews with Claude**: the action reviews each pull request on your own GitHub runners, posts one summary comment that it updates on every push, and leaves inline comments on the lines it flags
  - **No secrets in the workflow**: install the AxonShaft app, add the repo on shaft.axonpack.dev, and the action gets its GitHub token, your saved Claude token and the review settings from there
  - **Review steps from the dashboard**: the repo's Code review job decides which pull request events start a review and which checks it makes, including checks you add yourself
  - **Standalone mode**: give a Claude token plus `github_token`, or your own GitHub App's `app_id` and `private_key`, and the action runs without the Axon Shaft API
  - **Summary card**: the comment opens with the verdict, the headline, the finding counts and a mark for each check, then a table of findings linked to their lines
  - **Settings order**: an input wins over the dashboard, the dashboard over `.github/shaft.yml`, and the file over the defaults
  - **Review rules in `.github/shaft.yml`**: `rules`, `skip` and `focus`, read from the base branch, so a pull request can't change its own review
  - **Only trusted comments are read**: the review reads comments from the repo's owners, members and collaborators, and leaves out everyone else's
  - **The review stays in the checkout**: it can read only the repo's files and run only `git diff`, `git log` and `git show`, and it never sees the runner's other tokens
  - **Reviews against your repo's guides**: the review reads `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`, the README and similar files from the base branch, and checks the pull request against them
  - **Review memory**: a finding is posted once, and the next review marks fixed ones and resolves their threads
  - **Model and effort picked per run**: with `auto`, small changes get Sonnet, docs and config get Haiku, and large or sensitive changes get Opus
  - **Dry run**: `dry_run: true` prints the comments to the job log instead of posting them
