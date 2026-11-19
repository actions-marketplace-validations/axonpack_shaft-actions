---
'shaft': minor
---

- **Merge gates**: when the project has merge gates on the dashboard, the summary comment lists each gate as met, not met or not applicable, with the review's reason, and the action posts an `Axon Shaft / gates` check run on the reviewed commit. The check fails when a gate isn't met or the review didn't report on it, so branch protection can require it. The AxonShaft GitHub App needs the Checks (write) permission for the check; without it the review still posts and the log warns.
