---
'shaft': patch
---

- **Footer tokens**: the summary footer shows the cost and the total on an API key, such as `$0.38 · 759k tokens`, and on a subscription the cache-weighted count with the total in brackets, such as `≈220k billed (759k with cache)`. The raw total counted every cached read and looked several times bigger than the bill.
- **Footer link**: "Axon Shaft" in the summary footer opens the run's page on the dashboard when the API sends it, and the dashboard otherwise.
- **Turn limit by size**: with no turn limit set on the dashboard, a review of under 100 changed lines gets 12 turns and one under 500 gets 20, and the footer's reason says so, such as `60 lines, up to 12 turns`. Larger diffs and deep reviews keep 30, and a limit set on the dashboard always wins.
