import { ar } from "@/i18n/ar";

/**
 * Arabic relative time. Written by hand rather than pulled from a date library
 * because Arabic needs dual forms ("قبل ساعتين") that `Intl.RelativeTimeFormat`
 * does not produce, and the whole surface is a dozen strings.
 */
export function relativeTime(date: Date | string, now: Date = new Date()): string {
  const value = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.max(0, Math.round((now.getTime() - value.getTime()) / 1000));

  if (seconds < 90) return ar.time.justNow;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return ar.time.minutesAgo(minutes);

  const hours = Math.round(minutes / 60);
  if (hours < 24) return ar.time.hoursAgo(hours);

  const days = Math.round(hours / 24);
  if (days < 7) return ar.time.daysAgo(days);

  const weeks = Math.round(days / 7);
  if (weeks < 5) return ar.time.weeksAgo(weeks);

  const months = Math.round(days / 30);
  if (months < 12) return ar.time.monthsAgo(months);

  return formatDate(value);
}

/**
 * Arabic month names with Latin digits (`-u-nu-latn`).
 *
 * Without the numbering-system override, `ar-IQ` renders Arabic-Indic digits
 * (٢٠٢٦) while the relative-time strings above — built from plain JS numbers —
 * render Latin ones. Both conventions are current in Mosul; mixing them inside
 * a single card is what looks wrong. Latin digits win because report
 * references, phone numbers and counts are Latin throughout.
 */
const dateFormatter = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(date: Date | string): string {
  return dateFormatter.format(typeof date === "string" ? new Date(date) : date);
}

export function formatDateTime(date: Date | string): string {
  return dateTimeFormatter.format(typeof date === "string" ? new Date(date) : date);
}

export function formatTime(date: Date | string): string {
  return timeFormatter.format(typeof date === "string" ? new Date(date) : date);
}

/**
 * Phrases "when" honestly according to how precisely the user answered.
 * A report filed as "this week" must never render as a timestamp.
 */
export function formatOccurredAt(
  date: Date | string,
  precision: "EXACT" | "DAY" | "WEEK",
): string {
  const value = typeof date === "string" ? new Date(date) : date;

  switch (precision) {
    case "EXACT":
      return `${formatDate(value)} — ${formatTime(value)}`;
    case "DAY":
      return formatDate(value);
    case "WEEK":
      return `${ar.time.around} ${formatDate(value)}`;
  }
}

/** Start of the day in local time — used by the "today"/"yesterday" presets. */
export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function daysAgo(days: number, from: Date = new Date()): Date {
  const copy = new Date(from);
  copy.setDate(copy.getDate() - days);
  return copy;
}

export function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}
