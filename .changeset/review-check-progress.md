---
'shaft': minor
---

- **Review progress in the checks box**: the `Axon Shaft / review` check run is updated once at the start of each step. Its title is the current step, such as "Reviewing with Sonnet, effort medium", and its summary lists the steps with ✓ on the ones done, the current one in bold, and how far into the review that step started. If GitHub refuses an update, the job log warns once and the step updates stop, while the review goes on. A dry run logs each step's title.
