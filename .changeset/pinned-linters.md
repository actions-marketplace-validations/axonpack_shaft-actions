---
'shaft': minor
---

- **Pinned linters for five checklists**: GitHub workflows gets actionlint's report and a scan for unpinned actions and `permissions: write-all`, Containers hadolint's, Infrastructure as code tflint's, Database migrations squawk's, and HTTP and schema contracts oasdiff's and `buf breaking`'s. Each linter is pinned to one release, downloaded only from that project's GitHub release, checked against the sha256 this release records before it runs, and run in the sandbox with no network. When it can't run, the checklist runs on the model alone and the facts say why.
