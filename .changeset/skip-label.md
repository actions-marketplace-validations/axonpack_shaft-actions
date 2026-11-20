---
'shaft': minor
---

- **Labels for the skip filter**: the action sends the pull request's label names to the Axon Shaft API, from the pull request or, for a comment, its issue. With them, the Code review's new "Skip pull requests with these labels" filter can skip a pull request labelled `skip-review`, `no-review`, `skip-ai-review` or `do-not-review`, or whatever list the project sets. Comment `/review` to review a labelled pull request anyway.
