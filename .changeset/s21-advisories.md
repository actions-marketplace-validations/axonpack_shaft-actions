---
'shaft': minor
---

- **Missing permissions**: when the AxonShaft app's installation hasn't approved a permission the run wants, the job log warns once for each, and the summary's footer table lists them under "Missing permissions", such as `` `code_quality` (read) ``.
- **Private draft advisories**: with the dashboard's "Private draft advisories" setting on, each blocking security finding (the first 3 a review) goes into a private draft security advisory, opened by the Axon Shaft API. On a public repo the PR thread, the check run and the run's page show "Security issue, reported privately" with the draft's link in place of the details. On a private repo the finding keeps its text and links to the draft. If a draft can't be opened, the finding posts as before, the job log warns and the summary says why. A dry run logs the drafts it would open.
