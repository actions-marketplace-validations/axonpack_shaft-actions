---
'shaft': minor
---

- **Lockfile facts**: Dependencies and Supply chain now get a list of the packages each lockfile adds, removes or changes, with the versions before and after, placed after the steps in the prompt. It covers npm, Bun, Yarn, pnpm, pip `requirements*.txt`, Poetry, uv, Cargo and Go lockfiles, compares the base branch's copy with the pull request's, and never runs a package manager.
