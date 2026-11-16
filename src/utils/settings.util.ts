import { SETTING_DEFAULTS } from '../consts/settings.const';

export type Settings = Record<keyof typeof SETTING_DEFAULTS, string>;

/** Each field from the first that sets it: the input, then the dashboard, then the default. */
export function mergeSettings(input: (name: string) => string, dashboard: Record<string, unknown> = {}): Settings {
  const pick = (name: keyof Settings) => {
    const saved = dashboard[name];
    return input(name) || (typeof saved === 'string' && saved) || SETTING_DEFAULTS[name];
  };
  return { model: pick('model'), effort: pick('effort'), depth: pick('depth'), nits: pick('nits') };
}
