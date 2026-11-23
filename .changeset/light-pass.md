---
'shaft': minor
---

- **Light pass**: checklists marked `light` run in their own session on Haiku, with only the files their paths match and their scripts' facts, 6 turns, and Read and Grep. The main session keeps the other checklists, the merge gates and the verdict. When the light session fails, times out or comes back partial, the main session runs its checklists and the job log says so. The footer and the run's page show each session's model, turn limit and tokens.
