---
'shaft': minor
---

- **Pull request on the dashboard**: the action sends the pull request's number, title, branch and author when it asks the API for its tokens, so the dashboard's overview can show which PR each run was for. A run started from a comment on the conversation tab sends it without the branch, since that event doesn't include one.
