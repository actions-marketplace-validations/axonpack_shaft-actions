---
'shaft': minor
---

- **Longer reports**: the action reports up to 60 checks to the API, up from 50.
- **TODO notes**: the `todo-refs` script flags a new `TODO` or `FIXME` comment that links no issue, as a nit. No model call.
- **Licence header**: the `licence-header` script flags a new source file without the repo's licence header, as should-fix. The header comes from the API as `data.rules`, and with none set the script finds nothing.
- **Links in docs**: the `doc-links` script checks relative links on added lines of changed Markdown. A link to a missing file is blocking, and a link to a missing heading is should-fix.
- **Commit format**: the `commit-format` script flags a pull request title or commit subject that isn't a Conventional Commit, as a nit. Scripts now get the commit messages too.
- **Migration rollback**: the `migration-down` script flags a new migration with no down or rollback step, as should-fix. The migration globs and down patterns come from the API as `data.paths` and `data.down`.
- **No hit, no model call**: a `script+model` checklist whose pre-step finds nothing passes without calling the model, except `breakage`, `scope` and `access-control`.
- **SQL built from strings**: the `sql-strings` pre-step finds added lines that build SQL from strings and hands the model only those hunks. With none, the model isn't called.
- **Dead feature flags**: the `dead-flags` pre-step builds on `flags` and lists each flag the pull request stops reading that the repo still names. With none, the model isn't called.
- **Secrets by entropy**: `secrets` also flags a long random-looking string on an added line, as should-fix, while known key formats stay blocking. The thresholds come from the API as `data.entropy` and `data.minLength`. Lockfiles are left out.
