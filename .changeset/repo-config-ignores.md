---
'shaft': minor
---

- **Repo-wide ignores**: findings that match an `ignore` entry in the repo's `.github/axonshaft.yml`, by checklist, path glob or text in the title, aren't posted and don't count toward the verdict or a check run. The summary says how many were left out. When the API reports that the file has problems, the summary shows them in a warning under the card, and the review runs on the dashboard's settings.
