---
'shaft': minor
---

Projects can now run on OpenCode instead of Claude, with one `provider/model` for every job and keys saved on the dashboard or kept in GitHub Actions secrets. The action downloads OpenCode 1.19.6 from npm and runs it only when its sha512 matches the hash recorded in the release. Every job keeps the same tool checks, and `/fix` and tasks keep the same sandbox. OpenCode never loads the pull request's own config, plugins, AGENTS.md or skills. A model that isn't in OpenCode 1.19.6's model list stops the run before it starts, and a usage limit or other provider error stops it at once instead of at the time limit. New failure codes: `opencode_key_refused`, `opencode_key_missing`, `opencode_binary_unverified`, `opencode_unavailable`, `opencode_model_unknown`, `opencode_provider_error` and `opencode_guard_missing`.
