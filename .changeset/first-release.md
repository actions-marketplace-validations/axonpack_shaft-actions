---
"shaft": major
---

- **Pull request reviews with Claude**: the action reviews each pull request on your own GitHub runners, posts one summary comment that it updates on every push, and leaves inline comments on the lines it flags
- **No secrets in the workflow**: install the AxonShaft app, add the repo on shaft.axonpack.dev, and the action gets its GitHub token, your saved Claude token and the review settings from there
- **Review steps from the dashboard**: the repo's Code review job decides which pull request events start a review and which checks it makes, including checks you add yourself
- **Standalone mode**: give a Claude token plus `github_token`, or your own GitHub App's `app_id` and `private_key`, and the action runs without the Axon Shaft API
- **Summary card**: the comment opens with the verdict, the headline, the finding counts and a mark for each check, then a table of findings linked to their lines
- **Settings order**: an input wins over the dashboard, the dashboard over `.github/shaft.yml`, and the file over the defaults
- **Review rules in `.github/shaft.yml`**: `rules`, `skip` and `focus`, read from the base branch, so a pull request can't change its own review
- **Only trusted comments are read**: the review reads comments from the repo's owners, members and collaborators, and leaves out everyone else's
- **The review stays in the checkout**: it can read only the repo's files and run only `git diff`, `git log` and `git show`, and it never sees the runner's other tokens
- **Review memory**: a finding is posted once, and the next review marks fixed ones and resolves their threads
- **Model and effort picked per run**: with `auto`, small changes get Sonnet, docs and config get Haiku, and large or sensitive changes get Opus
- **Dry run**: `dry_run: true` prints the comments to the job log instead of posting them
