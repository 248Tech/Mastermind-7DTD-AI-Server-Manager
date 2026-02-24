/**
 * Compute next run time from cron expression and optional execution window (HH:mm–HH:mm).
 * For full cron support use cron-parser in production; this MVP supports 5-field expressions.
 */

const CRON_FIELDS = 5;

/**
 * Returns next run date after "from". Supports * and numeric (or comma-separated) fields.
 * Replace with cron-parser in production for full spec.
 */
export function getNextCronRun(cronExpression: string, from: Date): Date {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== CRON_FIELDS) throw new Error(`Invalid cron: expected 5 fields`);
  const [minF, hourF, domF, monthF, dowF] = parts;
  const minutes = parseSet(minF, 0, 59);
  const hours = parseSet(hourF, 0, 23);
  const doms = parseSet(domF, 1, 31);
  const months = parseSet(monthF, 1, 12);
  const dows = parseSet(dowF, 0, 6);

  let t = new Date(from.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);

  const maxIter = 366 * 24 * 60;
  for (let i = 0; i < maxIter; i++) {
    const m = t.getMonth() + 1, d = t.getDate(), h = t.getHours(), min = t.getMinutes(), dow = t.getDay();
    if (months && !months.has(m)) { advanceToNextMinute(t); continue; }
    if (doms && !doms.has(d)) { advanceToNextMinute(t); continue; }
    if (dows && !dows.has(dow)) { advanceToNextMinute(t); continue; }
    if (hours && !hours.has(h)) { advanceToNextMinute(t); continue; }
    if (minutes && !minutes.has(min)) { advanceToNextMinute(t); continue; }
    return new Date(t);
  }
  throw new Error('No next run found');
}

function advanceToNextMinute(d: Date): void {
  d.setTime(d.getTime() + 60 * 1000);
}

function parseSet(str: string, min: number, max: number): Set<number> | null {
  if (str === '*') return null;
  const set = new Set<number>();
  for (const s of str.split(',')) {
    const n = parseInt(s.trim(), 10);
    if (Number.isNaN(n) || n < min || n > max) throw new Error(`Invalid cron field: ${str}`);
    set.add(n);
  }
  return set;
}

/**
 * Clamp `date` to the next occurrence within [windowStart, windowEnd] (time of day, "HH:mm").
 * If date's time is already in range, return date. Else advance to next window start.
 */
export function clampToExecutionWindow(
  date: Date,
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
): Date {
  if (!windowStart || !windowEnd) return date;
  const [sH, sM] = windowStart.split(':').map(Number);
  const [eH, eM] = windowEnd.split(':').map(Number);
  const startMins = sH * 60 + sM;
  const endMins = eH * 60 + eM;
  const nowMins = date.getHours() * 60 + date.getMinutes();
  if (startMins <= endMins) {
    if (nowMins >= startMins && nowMins <= endMins) return date;
    if (nowMins < startMins) {
      const out = new Date(date);
      out.setHours(sH, sM, 0, 0);
      return out;
    }
  }
  const out = new Date(date);
  out.setDate(out.getDate() + 1);
  out.setHours(sH, sM, 0, 0);
  return out;
}
