---
'shaft': minor
---

- **Four new script checklists**: `focused-tests` (`.only`, `fdescribe` and `fit` left in tests are blocking, `.skip` is a nit), `large-files` (files over the size limit, added binaries, committed `node_modules/` or `dist/`), `install-hooks` (a new or changed `preinstall`, `install` or `postinstall`) and `debug-output` (`console.log`, `debugger`, `print(` and `dbg!` outside tests, scripts and CLIs, as nits). None of them calls the model. Their size limit and globs come from the API as `data`, and the action keeps defaults for an older API.
- **Up to 50 checks reported**: the run's report to the API carries up to 50 checks, up from 40, to match the longer job lists.
