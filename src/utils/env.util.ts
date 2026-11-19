import { ENV_ALLOW, ENV_DENIED } from '../consts/env.const';

/** `ENV_ALLOW` and the project's own `names` that the runner has, never one `ENV_DENIED` matches. */
export function runnerEnv(names: string[] = []): Record<string, string> {
  const pass = [...ENV_ALLOW, ...names.filter((n) => !ENV_DENIED.test(n))].filter((n) => process.env[n] !== undefined);
  return Object.fromEntries(pass.map((n) => [n, process.env[n]!]));
}
