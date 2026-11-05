import { describe, expect, it } from 'vitest';
import { fillPosition, inferFillSeries, NO_FILL_VALUE } from './fill-series';

function down(seeds: unknown[], count: number, mode: 'auto' | 'copy' = 'auto') {
  const series = inferFillSeries(seeds, mode);
  return Array.from({ length: count }, (_, k) => series.valueAt(fillPosition(seeds.length, 'down', k + 1)));
}

function up(seeds: unknown[], count: number, mode: 'auto' | 'copy' = 'auto') {
  const series = inferFillSeries(seeds, mode);
  return Array.from({ length: count }, (_, k) => series.valueAt(fillPosition(seeds.length, 'up', k + 1)));
}

describe('fill series inference', () => {
  describe('numbers', () => {
    it('repeats a lone number in both directions', () => {
      expect(inferFillSeries([7]).kind).toBe('repeat');
      expect(down([7], 3)).toEqual([7, 7, 7]);
      expect(up([7], 2)).toEqual([7, 7]);
    });

    it('infers anchored arithmetic steps, including descending and upward', () => {
      expect(down([1, 2], 3)).toEqual([3, 4, 5]);
      expect(down([10, 7, 4], 3)).toEqual([1, -2, -5]);
      expect(up([10, 20], 3)).toEqual([0, -10, -20]);
      expect(up([5, 3], 2)).toEqual([7, 9]);
    });

    it('rounds float noise to the seed precision without drift', () => {
      expect(down([0.1, 0.2], 5)).toEqual([0.3, 0.4, 0.5, 0.6, 0.7]);
      expect(down([1.25, 1.5], 2)).toEqual([1.75, 2]);
      expect(inferFillSeries([0.1, 0.2]).valueAt(fillPosition(2, 'down', 1000))).toBe(100.2);
      expect(down([1e-7, 2e-7], 1)).toEqual([3e-7]);
    });

    it('repeats irregular numbers with negative modulo upward', () => {
      expect(inferFillSeries([1, 2, 4]).kind).toBe('repeat');
      expect(down([1, 2, 4], 4)).toEqual([1, 2, 4, 1]);
      expect(up([1, 2, 4], 4)).toEqual([4, 2, 1, 4]);
    });

    it('does not infer non-finite, numeric-string or mixed seeds', () => {
      expect(down([1, Number.NaN], 2)).toEqual([1, Number.NaN]);
      expect(down(['1', '2'], 2)).toEqual(['1', '2']);
      expect(down([1, '2'], 2)).toEqual([1, '2']);
    });

    it('reports values outside the finite range as unavailable', () => {
      expect(down([0, Number.MAX_VALUE], 1)).toEqual([NO_FILL_VALUE]);
    });
  });

  describe('text and copy mode', () => {
    it('repeats text, booleans and nullish values', () => {
      expect(down(['a', 'b'], 3)).toEqual(['a', 'b', 'a']);
      expect(up(['a', 'b'], 3)).toEqual(['b', 'a', 'b']);
      expect(down([true, null, undefined], 4)).toEqual([true, null, undefined, true]);
    });

    it('copy mode repeats even regular numeric and date seeds', () => {
      expect(down([1, 2], 3, 'copy')).toEqual([1, 2, 1]);
      expect(down(['2024-01-01'], 2, 'copy')).toEqual(['2024-01-01', '2024-01-01']);
    });

    it('an empty source yields no value', () => {
      expect(inferFillSeries([]).valueAt(0)).toBe(NO_FILL_VALUE);
    });
  });

  describe('civil dates (YYYY-MM-DD)', () => {
    it('advances a lone date by one calendar day and reverses upward', () => {
      expect(down(['2024-02-27'], 3)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
      expect(up(['2024-03-01'], 2)).toEqual(['2024-02-29', '2024-02-28']);
      expect(down(['2023-12-31'], 1)).toEqual(['2024-01-01']);
    });

    it('infers day steps when months do not form a calendar series', () => {
      expect(inferFillSeries(['2024-01-31', '2024-02-01']).kind).toBe('day');
      expect(down(['2024-01-31', '2024-02-01'], 2)).toEqual(['2024-02-02', '2024-02-03']);
      expect(down(['2024-01-01', '2024-01-08'], 2)).toEqual(['2024-01-15', '2024-01-22']);
      expect(up(['2024-01-10', '2024-01-08'], 2)).toEqual(['2024-01-12', '2024-01-14']);
    });

    it('preserves month-end series: Jan31 → Feb28 → Mar31', () => {
      const series = inferFillSeries(['2023-01-31', '2023-02-28']);
      expect(series.kind).toBe('month-end');
      expect(down(['2023-01-31', '2023-02-28'], 3)).toEqual(['2023-03-31', '2023-04-30', '2023-05-31']);
      expect(up(['2023-01-31', '2023-02-28'], 2)).toEqual(['2022-12-31', '2022-11-30']);
    });

    it('clamps from the anchor day without drift: Jan30 → Feb28 → Mar30', () => {
      expect(inferFillSeries(['2023-01-30', '2023-02-28']).kind).toBe('month');
      expect(down(['2023-01-30', '2023-02-28'], 3)).toEqual(['2023-03-30', '2023-04-30', '2023-05-30']);
      expect(down(['2024-01-30', '2024-02-29'], 1)).toEqual(['2024-03-30']);
    });

    it('prefers calendar months over day counts', () => {
      expect(inferFillSeries(['2024-01-15', '2024-02-15']).kind).toBe('month');
      expect(down(['2024-01-15', '2024-02-15'], 2)).toEqual(['2024-03-15', '2024-04-15']);
      expect(down(['2024-01-15', '2024-03-15'], 2)).toEqual(['2024-05-15', '2024-07-15']);
      expect(up(['2024-03-15', '2024-02-15'], 2)).toEqual(['2024-04-15', '2024-05-15']);
    });

    it('returns Feb 29 on the next leap year for yearly series', () => {
      expect(down(['2024-02-29', '2025-02-28'], 4)).toEqual(['2026-02-28', '2027-02-28', '2028-02-29', '2029-02-28']);
      expect(down(['2020-02-29', '2024-02-29'], 1)).toEqual(['2028-02-29']);
      expect(up(['2024-02-29', '2025-02-28'], 1)).toEqual(['2023-02-28']);
    });

    it('validates every seed against the anchor', () => {
      expect(inferFillSeries(['2024-01-15', '2024-02-15', '2024-03-16']).kind).toBe('repeat');
      expect(inferFillSeries(['2023-01-31', '2023-02-28', '2023-03-29']).kind).toBe('repeat');
    });

    it('does not parse invalid, locale or mixed text', () => {
      expect(inferFillSeries(['2024-02-30']).kind).toBe('repeat');
      expect(inferFillSeries(['01/02/2024']).kind).toBe('repeat');
      expect(inferFillSeries(['Jan 1, 2024']).kind).toBe('repeat');
      expect(inferFillSeries(['2024-01-01', 'x']).kind).toBe('repeat');
      expect(inferFillSeries(['2024-01-01', new Date(Date.UTC(2024, 0, 2))]).kind).toBe('repeat');
    });

    it('reports years outside 0000–9999 as unavailable', () => {
      expect(down(['9999-12-31'], 1)).toEqual([NO_FILL_VALUE]);
    });
  });

  describe('timestamps', () => {
    it('advances a lone timestamp by one day, keeping clock, precision and offset text', () => {
      expect(down(['2024-03-30T23:30:00.120+02:00'], 2)).toEqual([
        '2024-03-31T23:30:00.120+02:00',
        '2024-04-01T23:30:00.120+02:00',
      ]);
      expect(up(['2024-01-01T08:00Z'], 1)).toEqual(['2023-12-31T08:00Z']);
    });

    it('applies calendar month steps to timestamps', () => {
      expect(down(['2023-01-31T09:00-05:00', '2023-02-28T09:00-05:00'], 1)).toEqual(['2023-03-31T09:00-05:00']);
    });

    it('infers constant clock steps for a shared offset', () => {
      expect(inferFillSeries(['2024-01-01T23:00+01:00', '2024-01-01T23:30+01:00']).kind).toBe('time');
      expect(down(['2024-01-01T23:00+01:00', '2024-01-01T23:30+01:00'], 2)).toEqual([
        '2024-01-02T00:00+01:00',
        '2024-01-02T00:30+01:00',
      ]);
      expect(down(['2024-01-01T00:00:00.5Z', '2024-01-01T00:00:01Z'], 2)).toEqual([
        '2024-01-01T00:00:01.5Z',
        '2024-01-01T00:00:02.0Z',
      ]);
      expect(down(['2024-01-01T00:00Z', '2024-01-01T00:00:30Z'], 1)).toEqual(['2024-01-01T00:01:00Z']);
    });

    it('repeats mixed offsets, sub-millisecond precision and invalid clocks', () => {
      expect(inferFillSeries(['2024-01-01T00:00Z', '2024-01-01T01:00+01:00']).kind).toBe('repeat');
      expect(inferFillSeries(['2024-01-01T00:00:00.0001Z', '2024-01-01T00:00:00.0002Z']).kind).toBe('repeat');
      expect(inferFillSeries(['2024-01-01T24:00Z']).kind).toBe('repeat');
      expect(inferFillSeries(['2024-01-01T10:00']).kind).toBe('repeat');
      expect(inferFillSeries(['2024-01-01T10:00+24:00']).kind).toBe('repeat');
    });
  });

  describe('Date objects', () => {
    it('steps UTC calendar days and keeps the UTC time of day', () => {
      const [next] = down([new Date('2024-03-30T23:30:00.000Z')], 1) as Date[];
      expect(next.toISOString()).toBe('2024-03-31T23:30:00.000Z');
    });

    it('uses UTC months with month-end clamping', () => {
      const values = down([new Date(Date.UTC(2023, 0, 31, 12)), new Date(Date.UTC(2023, 1, 28, 12))], 2) as Date[];
      expect(values.map((value) => value.toISOString())).toEqual([
        '2023-03-31T12:00:00.000Z',
        '2023-04-30T12:00:00.000Z',
      ]);
    });

    it('uses a constant millisecond step when times of day differ', () => {
      const values = down([new Date(Date.UTC(2024, 0, 1, 10)), new Date(Date.UTC(2024, 0, 1, 12))], 1) as Date[];
      expect(values[0].toISOString()).toBe('2024-01-01T14:00:00.000Z');
    });

    it('clones repeated Date seeds and ignores invalid dates', () => {
      const seed = new Date(Date.UTC(2024, 0, 1));
      const [copy] = down([seed], 1, 'copy') as Date[];
      expect(copy).not.toBe(seed);
      expect(copy.getTime()).toBe(seed.getTime());
      expect(inferFillSeries([new Date(Number.NaN)]).kind).toBe('repeat');
    });
  });
});
