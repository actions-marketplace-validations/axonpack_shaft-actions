---
'shaft': minor
---

- **Axon Shaft's MCP server**: before a review, the action gets a read-only MCP token for the run from the API, adds Axon Shaft's MCP server to a Claude Code config folder it makes for the run, and checks it with `tools/list`. The model reaches Axon Shaft's data only through its tools: advisory details by ID, a checklist's full rules and GitHub Code Quality's open findings.
- **`mcp_unavailable`**: a new failure code when the token or the server check fails, so the review doesn't start.
