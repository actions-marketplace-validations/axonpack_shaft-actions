---
'shaft': patch
---

- **What this PR does**: the Claim, Impact, Scope and Not checked lines in the summary's folded section each sit in their own paragraph, with a blank line between them.
- **Summary card**: each check's result is a table row with its finding counts, such as "⚠️ 2 should fix", or why it didn't run. A check that's off has no row. A clean review says "No findings.", and the last line links the reviewed commit. When no checklist runs, the summary shows the same table.
