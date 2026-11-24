---
'shaft': minor
---

Guardrails is now called Abuse protection. The `guardrail_blocked` and `guardrail_leak` codes are now `abuse_blocked` and `abuse_leak`, and the summary and log lines say "abuse strikes". The action reads the flagged people and rules from the API's `abuse` field, or `guardrail` from an older API.
