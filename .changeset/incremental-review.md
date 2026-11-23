---
'shaft': minor
---

- **Incremental review**: the summary's state keeps a hash of each file's diff. A rerun or a rebase with the same diff makes no model call: the summary says nothing changed, and the check runs carry the last result to the new commit. On a push that changes some files, only the checklists whose paths match them run again, and the others keep their findings. New settings, a new action version or a summary from an older action get a full review.
