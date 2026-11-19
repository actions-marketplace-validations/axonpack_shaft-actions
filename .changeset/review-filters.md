---
'shaft': minor
---

- **Review filters**: the action also sends the branch a pull request goes into, its author's association with the repo, and whether a bot opened it. The API uses them for Code review's new filters (outside contributors, bots, Axon Shaft's own pull requests, target branches). When a filter skips a pull request, the run ends with a notice that says why.
