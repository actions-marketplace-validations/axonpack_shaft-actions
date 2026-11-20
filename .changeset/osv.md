---
'shaft': minor
---

- **Known vulnerabilities**: now runs as a script, with no model call. Each package version a lockfile adds or changes is checked against osv.dev, and against GitHub's advisory database when osv.dev fails. A finding names the advisory, the package, its version and the fixed versions, and is blocking when the advisory is rated high or critical. Only public packages are sent. Scoped packages, private registry, git and URL packages are never sent, and nothing about the repo is. When neither source answers, the checklist is skipped with the reason and never passes.
