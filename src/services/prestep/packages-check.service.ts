import { callNewApi } from '../api.service';

type Package = { ecosystem: string; name: string; version: string };

/** `npm:lodash@4.17.21`. */
export const packageKey = (p: Package) => `${p.ecosystem}:${p.name}@${p.version}`;

/** The API's limit on one call. */
const BATCH = 1000;

/**
 * One list of `POST /v1/packages/check`'s answer (`vulnerabilities` or `licences`) for each version,
 * by `packageKey`. The API gets only the ecosystem, name and version of each, each once, 1,000 a call.
 * A version it didn't check isn't in the map. Undefined when the API is older than the route; its
 * refusal throws.
 */
export async function checkPackages<T extends Package>(pins: Package[], check: 'vulnerabilities' | 'licences'): Promise<Map<string, T> | undefined> {
  const packages = [...new Map(pins.map((p) => [packageKey(p), { ecosystem: p.ecosystem, name: p.name, version: p.version }])).values()];
  const found = new Map<string, T>();
  for (let i = 0; i < packages.length; i += BATCH) {
    const answer = (await callNewApi('/v1/packages/check', { packages: packages.slice(i, i + BATCH), check: [check] })) as Record<string, T[]> | undefined;
    if (answer === undefined) return undefined;
    if (!Array.isArray(answer?.[check])) throw new Error('The Axon Shaft API sent an incomplete answer');
    for (const v of answer[check]) found.set(packageKey(v), v);
  }
  return found;
}
