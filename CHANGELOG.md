# shaft

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
