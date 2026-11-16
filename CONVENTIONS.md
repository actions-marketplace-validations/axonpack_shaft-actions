# Conventions

## Folders

Code that belongs to one feature lives in `src/features/<feature>/<layer>/`. Today there are two features: `review` (the procedure, the PR context, the agent call, rendering and posting) and `routing` (turning a GitHub event into a mode).

Code that more than one feature uses lives in `src/core/<layer>/`, with the same layer folders. A file moves to `core/` when a second feature imports it, not before. `core/services/tokens.service.ts` and `core/types/octokit.type.ts` are there because both features or the entry point need them.

`src/main.ts` is the action's entry point. It reads the inputs, routes the event and calls the feature. `action.yml` runs the bundle built from it (`dist/index.js`).

## File names

Every file name is kebab-case and ends with the suffix of its layer:

| Layer        | Suffix         | Example                                            |
| ------------ | -------------- | -------------------------------------------------- |
| `services/`  | `*.service.ts` | `features/review/services/agent.service.ts`        |
| `utils/`     | `*.util.ts`    | `features/review/utils/render.util.ts`             |
| `constants/` | `*.const.ts`   | `features/review/constants/procedure.md`           |
| `types/`     | `*.type.ts`    | `core/types/octokit.type.ts`                       |
| `schemas/`   | `*.schema.ts`  | none yet                                           |

A service calls an API or has another side effect. A util is a pure function. A const file holds fixed values, and data such as the review procedure, which stays Markdown so it reads as a document and Bun inlines it as text. A type file holds only types or declarations. Use `*.schema.ts` only for a validation schema. Add a new suffix only when none of these fits.

## Tests

Tests live in a `__tests__/` folder beside the code they test, named after that file: `features/routing/services/__tests__/route.service.test.ts` tests `route.service.ts`. Fixtures go in `__tests__/fixtures/` next to the tests that read them. `bun run test` runs them all with Vitest, and `bun run typecheck` checks them along with the code.

## Lint

`bun run lint` runs oxlint with `oxlint.config.mts`, which extends `oxlint-config-universe/node`. Turn a rule off there, with a one-line comment saying why, only when it fights a style the code already uses.
