---
'shaft': minor
---

- **A check run per review check**: next to `Axon Shaft / gates`, the action posts `Axon Shaft / <check>` on the reviewed commit for each check that's on, such as `Axon Shaft / correctness`, with that check's findings as its summary. A blocking finding fails it, other findings make it neutral, a clean check passes, and a check the review didn't do is skipped. A check turned off on the dashboard gets no run. Each one can be required in branch protection. They need Checks (write) on the run's token, which the Axon Shaft API asks for on every review run once its matching update ships. Without it the review still posts and the log warns once.
