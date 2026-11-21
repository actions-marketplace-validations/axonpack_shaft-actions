---
'shaft': patch
---

- **Cancelled runs close their checks**: when a workflow is cancelled or times out, the action closes the check runs it left in progress (`Axon Shaft / review` and the rest) as cancelled, swaps the summary comment's "Reviewing" for the new `cancelled` card, and records the run on the dashboard with the `cancelled` code. A new post step does the same at the end of the job if the step was killed first. A failed review fails any check still in progress, and its comment shows the failure card.
