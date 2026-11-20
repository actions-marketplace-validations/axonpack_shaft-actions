---
'shaft': minor
---

- **Script checklists**: Secrets, Pull request basics, Config and env vars, and Schema and migration in step now run as scripts built into the action, with no model call. They read the diff, the pull request's description and files in the checkout, and never run the repo's code. Their findings post inline and in the summary, set their check runs, and raise the verdict. When only script checklists run, no model is called. A Secrets finding names the kind of key and the line, never the value.
