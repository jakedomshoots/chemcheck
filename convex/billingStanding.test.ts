import { describe, expect, it } from 'vitest';
import { computeStanding } from './invoices';

const TODAY = '2026-09-23';

describe('computeStanding', () => {
  it('is current when the customer has no open invoices', () => {
    expect(computeStanding([], TODAY)).toEqual({ standing: 'current', openBalance: 0, overdueDays: 0 });
  });

  it('is current when open invoices are not due within a week', () => {
    const result = computeStanding([{ total: 150, due_date: '2026-10-15' }], TODAY);
    expect(result.standing).toBe('current');
    expect(result.openBalance).toBe(150);
  });

  it('is due_soon when an open invoice is due within seven days', () => {
    const result = computeStanding([{ total: 150, due_date: '2026-09-29' }], TODAY);
    expect(result.standing).toBe('due_soon');
  });

  it('is due_soon on the due date itself', () => {
    const result = computeStanding([{ total: 150, due_date: TODAY }], TODAY);
    expect(result.standing).toBe('due_soon');
  });

  it('is overdue with a day count once the due date passes', () => {
    const result = computeStanding([{ total: 150, due_date: '2026-09-10' }], TODAY);
    expect(result.standing).toBe('overdue');
    expect(result.overdueDays).toBe(13);
  });

  it('overdue wins over due_soon and sums the open balance', () => {
    const result = computeStanding(
      [
        { total: 100, due_date: '2026-09-01' },
        { total: 50, due_date: '2026-09-25' },
      ],
      TODAY
    );
    expect(result.standing).toBe('overdue');
    expect(result.openBalance).toBe(150);
    expect(result.overdueDays).toBe(22);
  });

  it('treats open invoices without a due date as current', () => {
    const result = computeStanding([{ total: 200 }], TODAY);
    expect(result.standing).toBe('current');
    expect(result.openBalance).toBe(200);
  });
});
