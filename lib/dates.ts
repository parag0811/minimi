// Date helpers.
//
// The agent is told today's date in the system prompt so it can resolve
// relative phrases like "last Tuesday" itself (models are reliable at this when
// the date is in context). These functions cover the deterministic bits:
// timestamps, day boundaries, and parsing explicit date strings.

/** Current time in epoch milliseconds (what memory stores in `created_at`). */
export function nowMs(): number {
  return Date.now();
}

/** Start of the given day (local midnight), in epoch ms. */
export function startOfDay(date = new Date()): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** End of the given day (local 23:59:59.999), in epoch ms. */
export function endOfDay(date = new Date()): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Human date for the system prompt, e.g. "Tuesday, 24 November 2026". */
export function todayLabel(date = new Date()): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Parse a date string ("2026-11-03", "2026-11-03T10:00:00Z", etc.) into epoch
 * ms. Returns null when the value is empty or invalid. The recall tool uses
 * this to convert the model's date arguments into DB timestamps.
 */
export function parseDateMs(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}
