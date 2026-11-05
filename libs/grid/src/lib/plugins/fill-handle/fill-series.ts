/**
 * Pure fill-series inference used by the FillHandle plugin.
 *
 * Seeds occupy positions `0..n-1`. Downward targets use `n - 1 + k` and upward
 * targets use `-k`, so every series is anchored to the first seed and never
 * accumulates rounding or month-clamp drift.
 *
 * Only strict typed codecs are inferred: finite numbers, `YYYY-MM-DD` civil
 * dates, valid `Date` objects (UTC fields) and strict ISO timestamps with an
 * explicit `Z`/`±HH:MM` offset. Anything else repeats.
 */

/** Series kind chosen for a source column. */
export type FillSeriesKind = 'repeat' | 'number' | 'day' | 'month' | 'month-end' | 'time';

/** Returned by {@link FillSeries.valueAt} when the series leaves the representable range. */
export const NO_FILL_VALUE: unique symbol = Symbol('no-fill-value');

export interface FillSeries {
  readonly kind: FillSeriesKind;
  valueAt(position: number): unknown;
}

const DAY_MS = 86_400_000;
const CIVIL_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)(Z|[+-]\d{2}:\d{2})$/;

const mod = (value: number, size: number) => ((value % size) + size) % size;
const pad = (value: number, width = 2) => String(value).padStart(width, '0');
const cloneValue = (value: unknown) => (value instanceof Date ? new Date(value.getTime()) : value);

function utcMs(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

const daysInMonth = (year: number, month: number) => new Date(utcMs(year, month + 1, 0)).getUTCDate();
const validCivil = (year: number, month: number, day: number) =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);

/** Calendar parts shared by every date-like codec. */
interface DateLike {
  codec: 'civil' | 'date' | 'stamp';
  year: number;
  month: number;
  day: number;
  /** Time-of-day text/key that calendar and day modes preserve verbatim. */
  rest: string;
  /** Milliseconds since the civil-day start (constant-time mode). */
  clockMs: number;
  offset?: string;
  seconds?: boolean;
  fraction?: number;
}

function parseDateLike(value: unknown): DateLike | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) return undefined;
    const clockMs = mod(time, DAY_MS);
    return {
      codec: 'date',
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
      rest: String(clockMs),
      clockMs,
    };
  }
  if (typeof value !== 'string') return undefined;
  const civil = CIVIL_RE.exec(value);
  if (civil) {
    const [year, month, day] = [Number(civil[1]), Number(civil[2]), Number(civil[3])];
    return validCivil(year, month, day) ? { codec: 'civil', year, month, day, rest: '', clockMs: 0 } : undefined;
  }
  const stamp = STAMP_RE.exec(value);
  if (!stamp) return undefined;
  const [year, month, day, hour, minute] = [1, 2, 3, 5, 6].map((index) => Number(stamp[index]));
  const second = stamp[7] === undefined ? 0 : Number(stamp[7]);
  const offset = stamp[9];
  const fraction = stamp[8] ?? '';
  if (!validCivil(year, month, day) || hour > 23 || minute > 59 || second > 59) return undefined;
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return undefined;
  return {
    codec: 'stamp',
    year,
    month,
    day,
    rest: stamp[4] + offset,
    clockMs: hour * 3_600_000 + minute * 60_000 + second * 1000 + Number(fraction.padEnd(3, '0').slice(0, 3)),
    offset,
    seconds: stamp[7] !== undefined,
    fraction: fraction.length,
  };
}

function formatDateLike(template: DateLike, year: number, month: number, day: number): unknown {
  if (year < 0 || year > 9999) return NO_FILL_VALUE;
  const civil = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  if (template.codec === 'civil') return civil;
  if (template.codec === 'stamp') return civil + template.rest;
  return new Date(utcMs(year, month, day) + template.clockMs);
}

function decimalsOf(value: number): number {
  const match = /^-?\d+(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value));
  return match ? Math.max(0, (match[1]?.length ?? 0) - Number(match[2] ?? 0)) : 0;
}

function numberSeries(seeds: readonly number[]): FillSeries | undefined {
  if (seeds.length < 2) return undefined;
  const decimals = Math.max(...seeds.map(decimalsOf));
  const step = seeds[1] - seeds[0];
  const at = (position: number) => {
    const raw = seeds[0] + position * step;
    return decimals > 100 ? raw : Number(raw.toFixed(decimals));
  };
  if (!seeds.every((seed, index) => at(index) === seed)) return undefined;
  return {
    kind: 'number',
    valueAt: (position) => {
      const value = at(position);
      return Number.isFinite(value) ? value : NO_FILL_VALUE;
    },
  };
}

function calendarSeries(parts: readonly DateLike[]): FillSeries | undefined {
  const [first] = parts;
  if (!parts.every((part) => part.codec === first.codec && part.rest === first.rest)) return undefined;
  const monthIndex = (part: DateLike) => part.year * 12 + part.month - 1;
  const anchor = monthIndex(first);
  const step = parts.length > 1 ? monthIndex(parts[1]) - anchor : 0;
  if (step !== 0 && parts.every((part, index) => monthIndex(part) === anchor + index * step)) {
    const monthEnds = parts.every((part) => part.day === daysInMonth(part.year, part.month));
    const dayAt = (year: number, month: number) =>
      monthEnds ? daysInMonth(year, month) : Math.min(first.day, daysInMonth(year, month));
    if (parts.every((part) => part.day === dayAt(part.year, part.month))) {
      return {
        kind: monthEnds ? 'month-end' : 'month',
        valueAt: (position) => {
          const index = anchor + position * step;
          const [year, month] = [Math.floor(index / 12), mod(index, 12) + 1];
          return formatDateLike(first, year, month, dayAt(year, month));
        },
      };
    }
  }
  const epochDay = (part: DateLike) => utcMs(part.year, part.month, part.day) / DAY_MS;
  const firstDay = epochDay(first);
  const dayStep = parts.length > 1 ? epochDay(parts[1]) - firstDay : 1;
  if (!parts.every((part, index) => epochDay(part) === firstDay + index * dayStep)) return undefined;
  return {
    kind: 'day',
    valueAt: (position) => {
      const date = new Date((firstDay + position * dayStep) * DAY_MS);
      if (Number.isNaN(date.getTime())) return NO_FILL_VALUE;
      return formatDateLike(first, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    },
  };
}

/** Constant elapsed-time step for Dates, or same-offset timestamps whose clocks differ. */
function timeSeries(parts: readonly DateLike[]): FillSeries | undefined {
  const [first] = parts;
  if (parts.length < 2 || first.codec === 'civil') return undefined;
  if (!parts.every((part) => part.codec === first.codec && part.offset === first.offset)) return undefined;
  if (parts.some((part) => (part.fraction ?? 0) > 3)) return undefined;
  const wall = (part: DateLike) => utcMs(part.year, part.month, part.day) + part.clockMs;
  const start = wall(first);
  const step = wall(parts[1]) - start;
  if (!parts.every((part, index) => wall(part) === start + index * step)) return undefined;
  const fraction = Math.max(...parts.map((part) => part.fraction ?? 0));
  const seconds = fraction > 0 || parts.some((part) => part.seconds) || step % 60_000 !== 0;
  return {
    kind: 'time',
    valueAt: (position) => {
      const date = new Date(start + position * step);
      if (Number.isNaN(date.getTime())) return NO_FILL_VALUE;
      if (first.codec === 'date') return date;
      const year = date.getUTCFullYear();
      if (year < 0 || year > 9999) return NO_FILL_VALUE;
      let text = `${pad(year, 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
      text += `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
      if (seconds) text += `:${pad(date.getUTCSeconds())}`;
      if (fraction) text += `.${pad(date.getUTCMilliseconds(), 3).slice(0, fraction)}`;
      return text + first.offset;
    },
  };
}

function repeatSeries(seeds: readonly unknown[]): FillSeries {
  return { kind: 'repeat', valueAt: (position) => cloneValue(seeds[mod(position, seeds.length)]) };
}

/**
 * Infer the series for one source column.
 *
 * - `copy` mode and irregular/unsupported seeds repeat (negative modulo upward).
 * - A lone number repeats; a lone date-like value advances one calendar day per row.
 * - Calendar month/year steps win over day counts and clamp from the anchor day.
 */
export function inferFillSeries(seeds: readonly unknown[], mode: 'auto' | 'copy' = 'auto'): FillSeries {
  if (!seeds.length) return { kind: 'repeat', valueAt: () => NO_FILL_VALUE };
  if (mode === 'copy') return repeatSeries(seeds);
  if (seeds.every((seed) => typeof seed === 'number' && Number.isFinite(seed))) {
    return numberSeries(seeds as number[]) ?? repeatSeries(seeds);
  }
  const parts = seeds.map(parseDateLike);
  if (!parts.every((part): part is DateLike => part !== undefined)) return repeatSeries(seeds);
  return calendarSeries(parts) ?? timeSeries(parts) ?? repeatSeries(seeds);
}

/** Seed position for the `offset`-th (1-based) target row in a direction. */
export function fillPosition(seedCount: number, direction: 'up' | 'down', offset: number): number {
  return direction === 'down' ? seedCount - 1 + offset : -offset;
}
