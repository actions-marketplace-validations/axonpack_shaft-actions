---
'shaft': minor
---

- **Guardrails**: the action checks the PR's text, comments and commands against fixed rules before the model runs, and asks Haiku once about text that only looks suspicious. Harmful PR text is replaced in the prompt, and a harmful command is refused (`guardrail_blocked`). Text from people reaches the model marked as data. A reply that repeats the system prompt's line isn't posted (`guardrail_leak`). Token shapes, outside links and mentions are made inert before posting, the model can't read `.env` files or keys, and a `/fix` that pipes a download into a shell or sends the environment out isn't pushed. Clear hits are strikes against the person who wrote the text, sent to the API. The summary flags people with strikes, and after 3 the API stops runs for them (`user_blocked`).
- **Main pass for supply chain and workflows**: the `supply-chain` and `workflows` checklists always run in the main session, even when marked light.
