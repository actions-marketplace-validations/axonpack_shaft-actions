---
'shaft': minor
---

- **Links to the docs**: each failure card links to its code's entry at `https://shaft.axonpack.dev/docs/reference/codes#<code>`, in the PR comment, the check run and the job summary. A notice with a code ends with the same link: `fork_pull_request`, `not_a_pull_request` and `no_write_access` from the action, the task codes such as `push_failed`, and whatever code the Axon Shaft API sends with its reason for not running. An older API sends no code, and its notices have no link.
- **Spending cap card**: a run stopped by the monthly spending cap shows the `spending_cap` card in the job summary, as well as the notice.
