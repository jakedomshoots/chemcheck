import { describe, expect, it } from 'vitest';
import {
  buildReadingTrends,
  dayIndex,
  groupLogsByPool,
  slopePerDay,
  trendsToTableRows,
  type TrendLog,
} from './trends';

const NOW = '2026-09-30';

function weeklyLogs(count: number, build: (index: number) => Partial<TrendLog>): TrendLog[] {
  const logs: TrendLog[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = new Date(Date.UTC(2026, 8, 30 - (count - 1 - i) * 7));
    const date = day.toISOString().slice(0, 10);
    logs.push({ id: i + 1, service_date: date, ...build(i) });
  }
  return logs;
}

describe('buildReadingTrends', () => {
  it('builds series for every metric within the selected window', () => {
    const logs: TrendLog[] = [
      { id: 1, service_date: '2026-09-29', ph_value: 7.4, chlorine_value: 3, alkalinity_value: 100, stabilizer_value: 40, hardness_value: 300, salt: 3200 },
      { id: 2, service_date: '2026-09-22', ph_value: 7.8, chlorine_value: 1 },
      // Outside a 30-day window.
      { id: 3, service_date: '2026-08-01', ph_value: 7.0, chlorine_value: 5 },
    ];
    const trends = buildReadingTrends({ serviceLogs: logs, rangeDays: 30, now: NOW, poolType: 'Chlorine', surfaceType: 'Plaster' });

    expect(trends.start).toBe('2026-09-01');
    expect(trends.end).toBe(NOW);
    expect(trends.visitCount).toBe(2);
    expect(trends.series.map((item) => item.key)).toEqual(['ph', 'fc', 'ta', 'cya', 'ch', 'salt', 'lsi']);

    const ph = trends.series.find((item) => item.key === 'ph')!;
    expect(ph.points.map((point) => [point.date, point.value, point.inRange])).toEqual([
      ['2026-09-22', 7.8, false],
      ['2026-09-29', 7.4, true],
    ]);
    expect(ph.latest?.value).toBe(7.4);
    expect(ph.target).toEqual({ min: 7.4, max: 7.6 });
    expect(ph.drift).toBe('unknown');

    const ch = trends.series.find((item) => item.key === 'ch')!;
    expect(ch.target).toEqual({ min: 250, max: 450 });
    expect(ch.points).toHaveLength(1);

    const lsi = trends.series.find((item) => item.key === 'lsi')!;
    expect(lsi.points).toEqual([]);
  });

  it('computes LSI points from fully measured visits', () => {
    const logs: TrendLog[] = [{
      id: 1,
      service_date: '2026-09-15',
      ph_value: 7.6,
      alkalinity_value: 90,
      stabilizer_value: 60,
      hardness_value: 300,
      hardness_source: 'calcium',
      water_temperature: 84,
      water_temperature_source: 'measured',
      tds_value: 1000,
      tds_source: 'measured',
    }];
    const trends = buildReadingTrends({ serviceLogs: logs, rangeDays: 90, now: NOW });
    const lsi = trends.series.find((item) => item.key === 'lsi')!;
    expect(lsi.points).toHaveLength(1);
    expect(lsi.points[0].value).toBeCloseTo(0.02, 2);
    expect(lsi.points[0].inRange).toBe(true);
  });

  it('aligns chemical usage to visit dates and keeps off-visit doses as markers', () => {
    const logs: TrendLog[] = [{ id: 1, service_date: '2026-09-22', ph_value: 7.8 }];
    const usage = [
      { id: 1, created_date: '2026-09-22', chemical_type: 'Muriatic Acid', quantity: '12 fl oz' },
      { id: 2, created_date: '2026-09-22', chemical_type: 'Liquid Chlorine', quantity: '32 fl oz' },
      { id: 3, created_date: '2026-09-25', chemical_type: 'Salt', quantity: '80 lb' },
      { id: 4, created_date: '2026-01-01', chemical_type: 'Old', quantity: '1' },
    ];
    const trends = buildReadingTrends({ serviceLogs: logs, chemicalUsage: usage, rangeDays: 30, now: NOW });
    expect(trends.doses).toEqual([
      { date: '2026-09-22', onVisit: true, entries: [
        { chemical_type: 'Muriatic Acid', quantity: '12 fl oz' },
        { chemical_type: 'Liquid Chlorine', quantity: '32 fl oz' },
      ] },
      { date: '2026-09-25', onVisit: false, entries: [{ chemical_type: 'Salt', quantity: '80 lb' }] },
    ]);

    const rows = trendsToTableRows(trends);
    expect(rows.map((row) => row.date)).toEqual(['2026-09-22', '2026-09-25']);
    expect(rows[0].values.ph).toBe(7.8);
    expect(rows[0].doses).toEqual(['Muriatic Acid 12 fl oz', 'Liquid Chlorine 32 fl oz']);
  });

  it('filters by pool when a pool id is given', () => {
    const logs: TrendLog[] = [
      { id: 1, pool_id: 10, service_date: '2026-09-22', ph_value: 7.2 },
      { id: 2, pool_id: 11, service_date: '2026-09-23', ph_value: 7.9 },
    ];
    const usage = [
      { id: 1, pool_id: 10, created_date: '2026-09-22', chemical_type: 'Soda Ash', quantity: '1 lb' },
      { id: 2, pool_id: 11, created_date: '2026-09-23', chemical_type: 'Muriatic Acid', quantity: '16 fl oz' },
    ];
    const trends = buildReadingTrends({ serviceLogs: logs, chemicalUsage: usage, rangeDays: 30, now: NOW, poolId: 10 });
    expect(trends.visitCount).toBe(1);
    expect(trends.series.find((item) => item.key === 'ph')!.points[0].value).toBe(7.2);
    expect(trends.doses).toHaveLength(1);
    expect(trends.doses[0].entries[0].chemical_type).toBe('Soda Ash');
  });

  it('detects a rising pH drift and blames high alkalinity when TA is high', () => {
    const logs = weeklyLogs(6, (i) => ({ ph_value: 7.3 + i * 0.15, alkalinity_value: 150 }));
    const trends = buildReadingTrends({ serviceLogs: logs, rangeDays: 90, now: NOW, poolType: 'Chlorine' });
    const ph = trends.series.find((item) => item.key === 'ph')!;
    expect(ph.drift).toBe('rising');
    const hint = trends.diagnostics.find((item) => item.id === 'ph-rising');
    expect(hint?.severity).toBe('watch');
    expect(hint?.message).toMatch(/High TA drives pH up/);
  });

  it('points at aeration when pH rises with normal alkalinity', () => {
    const logs = weeklyLogs(4, (i) => ({ ph_value: 7.4 + i * 0.15, alkalinity_value: 90 }));
    const trends = buildReadingTrends({ serviceLogs: logs, rangeDays: 90, now: NOW });
    expect(trends.diagnostics.find((item) => item.id === 'ph-rising')?.message).toMatch(/aeration/);
  });

  it('counts out-of-range streaks and links low chlorine to low stabilizer', () => {
    const logs = weeklyLogs(4, (i) => ({ chlorine_value: i === 0 ? 3 : 0.5, stabilizer_value: 10 }));
    const trends = buildReadingTrends({ serviceLogs: logs, rangeDays: 90, now: NOW, poolType: 'Chlorine' });
    const fc = trends.series.find((item) => item.key === 'fc')!;
    expect(fc.outOfRangeStreak).toBe(3);
    const hint = trends.diagnostics.find((item) => item.id === 'fc-low-cya-low');
    expect(hint?.message).toMatch(/3 visits in a row/);
    expect(hint?.message).toMatch(/stabilizer/i);
  });

  it('stays quiet with too few visits', () => {
    const logs = weeklyLogs(2, (i) => ({ ph_value: 7.2 + i * 0.5, chlorine_value: 0 }));
    const trends = buildReadingTrends({ serviceLogs: logs, rangeDays: 90, now: NOW });
    expect(trends.diagnostics).toEqual([]);
    expect(trends.series.find((item) => item.key === 'ph')!.drift).toBe('unknown');
  });

  it('notes calcium climbing under cal-hypo use', () => {
    const logs = weeklyLogs(5, (i) => ({ hardness_value: 250 + i * 40 }));
    const usage = logs.slice(0, 3).map((log, i) => ({ id: i, created_date: log.service_date, chemical_type: 'Cal-Hypo Shock', quantity: '1 lb' }));
    const trends = buildReadingTrends({ serviceLogs: logs, chemicalUsage: usage, rangeDays: 90, now: NOW });
    expect(trends.diagnostics.some((item) => item.id === 'ch-rising-calhypo')).toBe(true);
  });

  it('flags a repeated aggressive LSI', () => {
    const logs = weeklyLogs(3, () => ({
      ph_value: 7.0, alkalinity_value: 60, stabilizer_value: 40, hardness_value: 150, hardness_source: 'calcium',
      water_temperature: 70, water_temperature_source: 'measured', tds_value: 800, tds_source: 'measured',
    }));
    const trends = buildReadingTrends({ serviceLogs: logs, rangeDays: 30, now: NOW });
    const lsi = trends.series.find((item) => item.key === 'lsi')!;
    expect(lsi.latest!.value).toBeLessThan(-0.3);
    expect(trends.diagnostics.find((item) => item.id === 'lsi-aggressive')?.message).toMatch(/3 visits running/);
  });

  it('ignores logs with malformed dates and tolerates empty input', () => {
    const trends = buildReadingTrends({ serviceLogs: [{ service_date: '' } as TrendLog], rangeDays: 365, now: NOW });
    expect(trends.visitCount).toBe(0);
    expect(trends.series.every((item) => item.points.length === 0)).toBe(true);
    expect(buildReadingTrends({ serviceLogs: [], now: NOW }).rangeDays).toBe(90);
  });
});

describe('helpers', () => {
  it('groups logs by pool with unassigned logs under null', () => {
    const groups = groupLogsByPool([
      { pool_id: 1, service_date: 'a' },
      { service_date: 'b' },
      { pool_id: 1, service_date: 'c' },
    ]);
    expect(groups.map((group) => [group.poolId, group.logs.length])).toEqual([[1, 2], [null, 1]]);
  });

  it('computes a least-squares slope per day', () => {
    expect(slopePerDay([{ date: '2026-09-01', value: 1 }, { date: '2026-09-08', value: 2 }])).toBeNull();
    expect(slopePerDay([
      { date: '2026-09-01', value: 1 },
      { date: '2026-09-08', value: 2 },
      { date: '2026-09-15', value: 3 },
    ])).toBeCloseTo(1 / 7, 6);
    expect(dayIndex('2026-09-08') - dayIndex('2026-09-01')).toBe(7);
  });
});
