# shaft

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
