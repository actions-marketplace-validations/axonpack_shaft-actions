import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScriptInput } from '../../../../types/prestep.type';
import { changed, input } from './input';

const fixture = (side: 'base' | 'head', name: string) => readFileSync(join(import.meta.dirname, 'lockfiles', side, name), 'utf8');

/** A script input whose diff changes the fixture lockfile `name`, from its `base/` copy to its `head/` one, with more checkout files in `tree`. */
export const lockInput = (name: string, tree: Record<string, string> = {}, extra: Partial<ScriptInput> = {}) =>
  input([changed(name, [])], { [name]: fixture('head', name), ...tree }, { base: async (p) => (p === name ? fixture('base', name) : undefined), ...extra });
