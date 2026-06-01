/**
 * Thin i18n helper — reads from uk.json.
 * Supports simple {{key}} interpolation for dynamic values.
 *
 * All user-facing strings MUST come from this function.
 * No hard-coded Ukrainian strings in component files.
 */

import strings from './uk.json';

type Strings = typeof strings;
type StringKey = keyof Strings;

/**
 * Looks up a string by key and optionally interpolates {{placeholder}} values.
 * Returns the key itself if not found (visible in UI as a reminder to add the string).
 */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const raw: string = strings[key] ?? key;
  if (!vars) return raw;

  return Object.entries(vars).reduce<string>(
    (acc, [placeholder, value]) => acc.replace(`{{${placeholder}}}`, String(value)),
    raw,
  );
}

export type { StringKey };
