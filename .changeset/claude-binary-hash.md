---
'shaft': patch
---

- **Checked Claude Code download**: the action fetches the Claude Code binary from npm with `npm pack` and unpacks it only when the tarball's sha512 matches the one the release recorded from its `bun.lock`. A mismatch, or a runner platform with no recorded hash, fails the step with the new `claude_binary_unverified` code, and the binary never runs. Each run installs into an empty folder, so a binary already in the runner's temp folder is never reused.
