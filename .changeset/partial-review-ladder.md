---
'shaft': patch
---

- **Partial reviews move up the ladder**: on `auto`, a review that leaves more than a third of its checklists not checked, says it only partly reviewed the diff, or rates its confidence under 60% moves up a model, as a failed attempt does. The last model's partial review is posted as it is. The footer's Tried first row says why, such as "partial review: 5 of 7 checklists not checked".
- **Big reviews start higher**: over 2,000 changed lines after `skip`, a review starts at Opus, and over 400 lines it never starts below Sonnet.
