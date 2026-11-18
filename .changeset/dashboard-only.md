---
"shaft": minor
---

- **The dashboard is required**: every run gets its GitHub token, Claude token, settings and whole review prompt from shaft.axonpack.dev, so the workflow needs `permissions: id-token: write` and the repo needs a project there
- **The prompt comes from the dashboard**: the review steps, the safety rules and the deep review's subagents are all set there, and the action only fills in the pull request's data
- **Inputs removed**: `claude_code_oauth_token`, `anthropic_api_key`, `app_id`, `private_key`, `github_token`, `model`, `effort`, `depth`, `mode`, `max_turns`, `timeout_minutes`, `nits`, `task_tools` and `config_path` are gone, and `dry_run` is the only input left. Set the model, effort, depth, nits and limits on the dashboard
- **Standalone mode removed**: the action no longer runs on a Claude token and a GitHub token given as inputs
- **`.github/shaft.yml` is no longer read**: set `rules`, `skip` and `focus` on the dashboard instead
- **Failures say what to do**: a failed run shows a card for its code, a message and a link in the job summary, and a failed review shows the same in the PR's summary comment. The README lists each code
- **Pull requests from forks**: run the workflow on `pull_request_target`, with `persist-credentials: false` on its checkout, and a fork's pull request is reviewed as the dashboard's "Pull requests from forks" setting says. Anyone with write access can also start a review of a pull request by commenting `@axonshaft review`
- **Status cards**: the summary comment opens with a card for its status from the dashboard, Reviewing while the review runs, then Looks good, Needs changes or Blocking.
