---
'shaft': minor
---

- **Package lookups through the Axon Shaft API**: the `osv` script (Known vulnerabilities) sends `POST /v1/packages/check` the ecosystem, name and version of the public packages a pull request adds or changes, and the API asks osv.dev and GitHub's advisory database. It sends nothing else. With an older API, the action asks osv.dev itself, as 1.9 did.
- **Licences checklist**: a new `licences` script checks the licence each new public npm, PyPI or crates.io package declares, through the same API call. A strong copyleft licence (GPL, AGPL, SSPL, OSL) is blocking, and no declared licence is should-fix. It's skipped on an older API.
