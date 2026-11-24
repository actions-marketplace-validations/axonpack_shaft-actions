---
'shaft': minor
---

- **Longer reports**: the action reports up to 60 checks to the API, up from 50.
- **TODO notes**: the `todo-refs` script flags a new `TODO` or `FIXME` comment that links no issue, as a nit. No model call.
- **Licence header**: the `licence-header` script flags a new source file without the repo's licence header, as should-fix. The header comes from the API as `data.rules`, and with none set the script finds nothing.
