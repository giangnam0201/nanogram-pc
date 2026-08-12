/* Copy comes straight from the Android string catalogue so the desktop app
   reads identically. See src/assets/i18n/en.json (converted from strings.xml). */

import en from '../assets/i18n/en.json';

type Catalogue = Record<string, string>;

const catalogue = en as Catalogue;

/**
 * Look up a string, substituting `{1}`, `{2}` … placeholders in order.
 * Falls back to the key so a missing string is obvious rather than blank.
 */
export function t(key: string, ...args: (string | number)[]): string {
  const raw = catalogue[key];
  if (raw === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing string: ${key}`);
    return key;
  }
  if (args.length === 0) return raw;
  return raw.replace(/\{(\d+)\}/g, (match, index) => {
    const i = Number(index);
    // Android's positional args are 1-based; `{0}` appears for bare `%s`.
    const value = i === 0 ? args[0] : args[i - 1];
    return value === undefined ? match : String(value);
  });
}

export function has(key: string): boolean {
  return key in catalogue;
}

/** Server error codes map onto `api_error_*` strings, exactly as on Android. */
export function apiErrorText(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback;
  const key = `api_error_${code}`;
  return has(key) ? t(key) : fallback;
}
