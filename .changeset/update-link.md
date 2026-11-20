---
'shaft': patch
---

- **Update links under a newer release**: when a newer v1 release is out, the summary shows it as a `NOTE` after the card, with "Update the workflow" (the workflow file in GitHub's editor, on its branch or the default branch) and "Update from the dashboard" (the run's page).
- **Plain card line**: the card's last line drops its icons and reads `Bug fix · 85% confidence · reviewed a1b2c3d`, with the commit still linked.
- **Footer that opens into a table**: the footer is one short line, such as `Claude Sonnet 5.5, medium effort · 62k tokens, 219 lines` (the cost follows the tokens on an API key). Click it for a table with the run's page, the Actions log, the action version, the model's ID, fallback and subagent models, the effort and why it was picked, the turn limit, the changed lines and files, the checklists, the full token breakdown with the billed figure and the cost, and the reviewed commit. Model IDs read as names, so `claude-sonnet-5-5` is "Claude Sonnet 5.5".
