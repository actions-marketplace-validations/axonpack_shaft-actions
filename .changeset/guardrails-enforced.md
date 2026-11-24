---
'shaft': minor
---

The action now applies the project's guardrails. Never-read globs stop the model reading or searching matching files, never-edit globs stop it editing them and stop `/fix` pushing a change to them, and text rules go in the system prompt. Findings on those files aren't posted, and the summary counts them.
