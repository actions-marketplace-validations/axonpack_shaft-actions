---
"shaft": minor
---

- **Slash commands**: a comment starts Axon Shaft with `/review`, `/fix`, `/ask`, `/axonshaft <prompt>` or `/help` at the start of a line. `/review` reviews the pull request now, `/help` posts the list of commands, and `/fix`, `/ask` and `/axonshaft` end with a notice until Task and Reply are built. Commands in quotes or code don't count
- **`@axonshaft` removed**: mentioning `@axonshaft` no longer starts anything; use `/review`
- **Workflow trigger**: the workflow's `if:` starts only on a comment with a line that begins with `/`; copy the new one from the README or the dashboard
