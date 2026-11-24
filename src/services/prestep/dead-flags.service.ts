import type { Facts } from '../../types/prestep.type';
import { flags } from './flags.service';

/**
 * The `dead-flags` facts, from the `flags` pre-step: each flag the pull request stops reading that the
 * repo still names (a definition or default left behind). Empty when there's none, and then the model isn't called.
 */
export const deadFlags: Facts = async (input) => {
  const dead = (await flags(input)).split('\n').filter((l) => l.startsWith('- ') && l.includes('(was in ') && l.includes('; still named in '));
  return dead.length ? ['Flags no added line reads any more, still named in the repo:', ...dead].join('\n') : '';
};
