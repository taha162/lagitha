/**
 * Controlled vocabularies shared by the report wizard, search filters and the
 * matcher. Colours are a fixed token list rather than free text so that
 * "أسود" and "اسود" and "black" all collapse to one comparable value.
 */

export interface ColorToken {
  value: string;
  nameAr: string;
  /** Swatch colour. Only used as a dot next to the label, never as the label. */
  swatch: string;
}

export const COLORS: readonly ColorToken[] = [
  { value: "black", nameAr: "أسود", swatch: "#1d211f" },
  { value: "white", nameAr: "أبيض", swatch: "#f2f1ec" },
  { value: "gray", nameAr: "رمادي", swatch: "#8b918d" },
  { value: "silver", nameAr: "فضي", swatch: "#c7ccc9" },
  { value: "gold", nameAr: "ذهبي", swatch: "#c9a227" },
  { value: "brown", nameAr: "بني", swatch: "#7b5433" },
  { value: "beige", nameAr: "بيج", swatch: "#d9c9a8" },
  { value: "red", nameAr: "أحمر", swatch: "#a83c38" },
  { value: "pink", nameAr: "وردي", swatch: "#d18a9b" },
  { value: "orange", nameAr: "برتقالي", swatch: "#c97b32" },
  { value: "yellow", nameAr: "أصفر", swatch: "#d8b13c" },
  { value: "green", nameAr: "أخضر", swatch: "#3f7d58" },
  { value: "blue", nameAr: "أزرق", swatch: "#3a6b93" },
  { value: "navy", nameAr: "كحلي", swatch: "#26374f" },
  { value: "purple", nameAr: "بنفسجي", swatch: "#6b5182" },
  { value: "multi", nameAr: "متعدد الألوان", swatch: "#9a9a9a" },
] as const;

const COLOR_BY_VALUE = new Map(COLORS.map((color) => [color.value, color]));

export function colorName(value: string | null | undefined): string | null {
  if (!value) return null;
  return COLOR_BY_VALUE.get(value)?.nameAr ?? null;
}

export function colorSwatch(value: string | null | undefined): string | null {
  if (!value) return null;
  return COLOR_BY_VALUE.get(value)?.swatch ?? null;
}

/**
 * Colours that are commonly confused in a hurried description or under bad
 * lighting. The matcher gives partial credit across a pair instead of
 * demanding an exact string equality that real reports rarely satisfy.
 */
const CONFUSABLE_COLORS: readonly (readonly [string, string])[] = [
  ["black", "navy"],
  ["gray", "silver"],
  ["silver", "white"],
  ["gold", "yellow"],
  ["brown", "beige"],
  ["red", "orange"],
  ["pink", "red"],
  ["blue", "navy"],
  ["purple", "navy"],
];

export function colorAffinity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a === "multi" || b === "multi") return 0.4;
  for (const [x, y] of CONFUSABLE_COLORS) {
    if ((a === x && b === y) || (a === y && b === x)) return 0.6;
  }
  return 0;
}

/** Date presets offered in the wizard's "when" step. */
export type WhenPreset = "today" | "yesterday" | "this-week" | "exact";

export const TIME_PRECISION_BY_PRESET: Record<WhenPreset, "EXACT" | "DAY" | "WEEK"> = {
  today: "DAY",
  yesterday: "DAY",
  "this-week": "WEEK",
  exact: "EXACT",
};
