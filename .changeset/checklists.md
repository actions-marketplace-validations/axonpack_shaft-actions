---
'shaft': minor
---

- **Checklists**: when the Axon Shaft API sends the job's checklists, only the ones whose paths match a changed file (after `skip`) run, and each gets its own check run, `Axon Shaft / <key>`, in the job's order. One that didn't run is skipped and says why. The prompt puts the run's data first and the steps of the checklists that run last, and a finding can only name one of them. When none run, no model is called: the summary comment says so and every check run is skipped, unless the project has merge gates. Script checklists report as skipped until the action has their scripts. The run's page on the dashboard gets the session's model, tokens and checklists. With an API that doesn't send checklists, the review runs as before.
