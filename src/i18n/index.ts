import { ar, type Dictionary } from "./ar";

export type Locale = "ar";

const dictionaries: Record<Locale, Dictionary> = { ar };

export const DEFAULT_LOCALE: Locale = "ar";

/**
 * Single entry point for UI copy.
 *
 * There is one locale today. Adding English means writing `en.ts` against the
 * `Dictionary` type and threading the active locale through here — no component
 * changes, because components only ever read from `t()`.
 */
export function t(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return dictionaries[locale];
}

export const dir = (locale: Locale = DEFAULT_LOCALE): "rtl" | "ltr" =>
  locale === "ar" ? "rtl" : "ltr";

export type { Dictionary };
