---
'shaft': minor
---

- **`/fix` and `/axonshaft` make changes**: on a pull request, `/fix <what>` and `/axonshaft <prompt>` run the project's Task job, and a bare `/fix` takes the open findings of the last review. The model edits the head commit's checkout and may run the repo's own install, test, lint, build and format commands. It never gets a GitHub token and can't run `git commit`, `git push`, `gh` or install a package by name. The action then runs the checks again itself, commits as `axonshaft[bot]` and pushes to the pull request's branch with a Contents-write token used only after the session. The reply lists the changed files, the commit and each check. If a check fails, nothing is pushed and the reply shows the output.
- **Push mode is enforced before the session**: Disabled, a fork's pull request or a branch that is the default branch ends with a reply and a notice saying why, and the run reports `push_failed`. Nothing is ever pushed to the default branch or with `--force`.
- `/fix` and `/axonshaft` on an issue end with a notice.
