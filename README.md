# axonbot

A GitHub Action that reviews pull requests with Claude. It runs the Claude Agent SDK on your own GitHub runners with your own Claude token. The model reads the code and returns its findings as JSON; the action posts one summary comment, which it edits on every push, and one review with inline comments.

Task mode (`@axonbot fix ...` in a comment) is not built yet.

## Setup

1. Get a Claude token. With a Pro or Max plan, run `claude setup-token` and save the result as the repo secret `CLAUDE_CODE_OAUTH_TOKEN`. With Console billing, save an API key as `ANTHROPIC_API_KEY`. An OAuth token belongs to one person's plan, so a repo that several people use is better on an API key.
2. Add `.github/workflows/axonbot.yml`:

   ```yaml
   name: axonbot
   on:
     pull_request:
       types: [opened, synchronize, reopened, ready_for_review]
     issue_comment:
       types: [created]
   permissions:
     contents: write
     pull-requests: write
     issues: write
   jobs:
     axonbot:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v6
           with:
             persist-credentials: false
         - uses: axonpack/axonbot@v1
           with:
             claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
             # or: anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
   ```

3. Open a pull request. To see the output in the job log before anything is posted, set `dry_run: true`.

By default the comments come from `github-actions[bot]`. To post as your own GitHub App, give it contents, pull requests and issues (write) and metadata (read), install it on the repo, and pass its `app_id` and `private_key`.

A pull request from a fork gets no secrets, so axonbot skips it and leaves a notice in the log.

## Inputs

Only the Claude token is required.

| Input | Default | What it does |
|---|---|---|
| `claude_code_oauth_token` | | A Pro or Max plan token from `claude setup-token`. Set this or `anthropic_api_key`, not both. |
| `anthropic_api_key` | | A Console API key. |
| `app_id`, `private_key` | | Post as this GitHub App. Set both or neither. |
| `github_token` | `${{ github.token }}` | Used when there are no app inputs. |
| `model` | `auto` | `auto` picks a model from the diff. Or any Claude model ID or alias (`opus`, `sonnet`, `haiku`). |
| `effort` | `auto` | `auto` picks from the diff. Or `low`, `medium`, `high`, `xhigh`, `max`. |
| `depth` | `standard` | `standard` runs one session. `deep` runs correctness, breakage and security as separate subagents, then a verifier, for about 3x the cost. |
| `mode` | `auto` | `auto` picks from the event. `review` or `task` forces one, for example in a `workflow_dispatch` run. |
| `trigger_phrase` | `@axonbot` | What a comment must contain to start a task. |
| `max_turns` | `30` | The Agent SDK turn limit per run. |
| `timeout_minutes` | `15` | The run stops after this long and says so in the summary. |
| `nits` | `summary` | `summary` counts nits in the summary, `inline` posts them as inline comments too, `off` drops them. |
| `task_tools` | | Extra tools for task mode, such as `Bash(bun test:*)`. Review mode never gets them. |
| `config_path` | `.github/axonbot.yml` | The repo's review rules, which the model reads before it reviews. |
| `dry_run` | `false` | Print the summary and inline comments to the job log instead of posting them. |

With `model: auto`, a small change gets `sonnet`, docs and config get `haiku`, and large or sensitive changes (auth, crypto, payments, workflows, migrations, dependency changes) get `opus`. The summary footer shows the model, the effort and the reason.

## Outputs

| Output | What it holds |
|---|---|
| `verdict` | `blocking`, `needs-changes` or `looks-good`. |
| `findings` | The number of blocking and should-fix findings. |
| `summary_url` | The link to the summary comment. Empty on a dry run. |

## What the review can do

The model reads the repo with `Read`, `Grep`, `Glob`, `git diff`, `git log` and `git show`. It never edits files, installs anything or runs the PR's code, and it doesn't load the repo's Claude Code settings, hooks or MCP servers. Before anything is posted, the action replaces the tokens it holds with `***`.

## Development

```sh
bun install
bun run typecheck
bun test
bun run build   # writes dist/index.js, which is committed
```

## License

MIT
