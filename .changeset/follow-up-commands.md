---
'shaft': minor
---

- **Follow-up commands**: `/tests` writes tests for the changed code, `/simplify` simplifies it, `/docstrings` documents the changed public functions, and `/resolve` merges the base branch and resolves the conflicts. Each runs as a Task with its built-in template from the API and pushes one commit, with the same write access, fork and check rules as `/fix`. `/resolve` with no conflicts runs no model, and stops with a reply when a conflict needs a person (`merge_needs_decision`). The review summary lists the commands the project keeps on, `/resolve` only when the pull request has conflicts.
