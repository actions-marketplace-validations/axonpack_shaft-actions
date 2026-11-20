---
'shaft': minor
---

- **`/ask` answers questions**: a comment with `/ask <question>` on a pull request runs the project's Reply job. The model reads the head commit with the review's read-only tools and environment. Its answer cites `file:line` and goes where the question was asked: in the line's thread for a comment on the diff, or as a comment on the pull request. It never edits, commits or pushes. Only people with write access can ask, and `/ask` on an issue ends with a notice. The run goes to the dashboard with the model, the tokens and the answer. If the session fails, its failure card is posted in the same place.
