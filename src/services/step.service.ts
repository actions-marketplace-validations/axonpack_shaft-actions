import * as core from '@actions/core';

/** Runs one step of the job in a folded group of the Actions log, which ends with how long it took. */
export function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return core.group(name, async () => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      core.info(`Took ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
  });
}
