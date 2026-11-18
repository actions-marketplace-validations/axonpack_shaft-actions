# Conventions

## Folders

Code is grouped by layer: `src/services/`, `src/utils/`, `src/consts/` and `src/types/`, one folder per layer, with no feature folders. The review code (the PR context, the prompt, the agent call, rendering and posting) and the routing code (turning a GitHub event into a mode) sit side by side in these folders.

Switch to `src/features/<feature>/<layer>/`, with `src/core/<layer>/` for code more than one feature uses, only once a layer folder gets crowded (around 15 files or more) or the areas grow apart. The switch is a set of `git mv`s and import updates, with no logic changes.

`src/main.ts` is the action's entry point. It reads the inputs, routes the event and calls the review service. `action.yml` runs the bundle built from it (`dist/index.js`).

## File names

Every file name is kebab-case and ends with the suffix of its layer:

| Layer        | Suffix         | Example                                            |
| ------------ | -------------- | -------------------------------------------------- |
| `services/`  | `*.service.ts` | `services/agent.service.ts`                        |
| `utils/`     | `*.util.ts`    | `utils/render.util.ts`                             |
| `consts/`    | `*.const.ts`   | `consts/api.const.ts`                              |
| `types/`     | `*.type.ts`    | `types/octokit.type.ts`                            |
| `schemas/`   | `*.schema.ts`  | none yet                                           |

A service calls an API or has another side effect. A util is a pure function. A const file holds fixed values. A type file holds only types or declarations. Use `*.schema.ts` only for a validation schema. Add a new suffix only when none of these fits.

## Tests

Tests live in a `__tests__/` folder beside the code they test, named after that file: `services/__tests__/route.service.test.ts` tests `route.service.ts`. Fixtures go in `__tests__/fixtures/` next to the tests that read them. `bun run test` runs them all with Vitest, and `bun run typecheck` checks them along with the code.

## Lint

`bun run lint` runs oxlint with `oxlint.config.mts`, which extends `oxlint-config-universe/node`. Turn a rule off there, with a one-line comment saying why, only when it fights a style the code already uses.
