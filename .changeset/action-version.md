---
'shaft': minor
---

- **Newer release notice**: the action sends its version and the ref the workflow runs it at (`v1`, `v1.5.0`, a branch or a SHA) when it asks the Axon Shaft API for its tokens. When the workflow pins an older v1 release and a newer one is out, the summary comment has a line under the card with the new version, a link to its release, and how to get each v1 release as it comes out: change `uses:` to `axonpack/shaft-actions@v1`. Runs on `@v1`, a branch or a SHA get no line.
