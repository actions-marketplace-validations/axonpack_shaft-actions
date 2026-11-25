---
'shaft': minor
---

Projects can now run on OpenCode instead of Claude. The action downloads OpenCode 1.19.6 from npm and runs it only after its sha512 matches the hash recorded in the release. Every job runs with the same tool checks and the same sandbox for `/fix` and tasks, plus Axon Shaft's own config. The pull request's OpenCode config, plugins, AGENTS.md and skills are never loaded. Key names that aren't upper-case and ending in `_KEY` or `_TOKEN` stop the run with `opencode_key_refused`. New failure codes: `opencode_binary_unverified`, `opencode_unavailable` and `opencode_guard_missing`.
