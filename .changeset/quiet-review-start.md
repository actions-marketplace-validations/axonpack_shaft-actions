---
'shaft': minor
---

- **One email for the first review**: the summary comment is now created when the result is ready. It no longer opens with a "Reviewing" card that GitHub emailed everyone about. On a later push the comment still switches to "Reviewing", since an edit sends no email. A failed review still creates the comment with its failure card.
- **Progress without emails**: an `Axon Shaft / review` check run is in progress while the review runs. It then passes with a link to the summary comment, or fails with the failure's message. A dry run logs it and posts nothing.
- **Reactions on every command**: the comment that started a run gets 👀 when it starts, after the write access check (`/help` gets it from anyone). When the run ends, the 👀 is replaced with 🚀 if it did its job, or 😕 if it failed or did nothing, such as a command that isn't built yet. A refused reaction only warns, and a dry run logs the reactions and adds none.
