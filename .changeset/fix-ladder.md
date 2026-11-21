---
'shaft': minor
---

- **Model ladder for `auto`**: a run starts on the smallest model that fits the job, at low effort, and moves up a model only when an attempt fails (an error, the turn limit, a reply that doesn't match the format, a failed check, or no change from a `/fix`). Reviews start at Sonnet, at Haiku for docs and config, and at Opus when they touch a sensitive file. `/ask` and `/fix` with words ask Haiku to rate the request first. A model or effort set on the dashboard runs as set. The footer lists each model tried and why the run moved on.
- **Bare `/fix` reuses the review**: the review's own suggested changes are applied with no model call, the other findings go to the model with the review's whole comment and only the files they name, and a fix that changes any other file isn't pushed.
- **`/fix` with words** gets the last review's open findings too, so "fix those" works.
- **Missing tools skip checks**: a check whose program isn't on the runner is skipped instead of failing, the fix is pushed, and the reply says which checks were skipped.
- **Inline `/fix`**: a `/fix` on a line of the diff sends the comment's ID to the API, which replies on that thread when it refuses the run.
- **No repeat inline comments**: a finding that moved a line or two since the last review isn't posted again.
- **Failed Bash calls in the log**: each one gets a short line with the command and what it printed.
