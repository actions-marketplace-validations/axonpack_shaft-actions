---
'shaft': minor
---

- **Environment**: the model's environment holds a short list of the runner's variables (`PATH`, `HOME`, locale, time zone, temp folder and the CI basics) plus the names set in the project's Environment variables setting, never a token. `ACTIONS_*`, `INPUT_*`, `ANTHROPIC_*`, `CLAUDE_*` and `GITHUB_TOKEN` can't be added.
