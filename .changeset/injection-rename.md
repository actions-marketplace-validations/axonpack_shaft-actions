---
'shaft': minor
---

Guardrails is now called Injection protection. The `guardrail_blocked` and `guardrail_leak` codes are now `injection_blocked` and `injection_leak`, and the summary and log lines say "prompt injection strikes". The action reads the flagged people and rules from the API's `injection` field, or `guardrail` from an older API.
