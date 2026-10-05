import { describe, expect, it } from 'vitest';
import {
  compareWithinDay,
  nextPositionForDay,
  planNormalization,
  planReorder,
  sortDay,
} from './customerOrdering';

const c = (id: number, sort_order?: number, createdAt?: string, service_day = 'Monday') => ({
  _id: id, sort_order, createdAt, service_day,
});

describe('customerOrdering', () => {
  it('sorts by position, then creation time, then numeric id', () => {
    const rows = [c(10, 1), c(2, 1), c(3, 0), c(4), c(5, 1, '2024-01-01T00:00:00Z')];
    expect(sortDay(rows).map((r) => r._id)).toEqual([3, 5, 2, 10, 4]);
  });

  it('treats a missing position as last, not first', () => {
    expect(compareWithinDay(c(1), c(2, 0))).toBeGreaterThan(0);
    expect(compareWithinDay(c(1, 0), c(2))).toBeLessThan(0);
  });

  it('uses the server creation timestamp when the local one is missing', () => {
    const a = { _id: 1, sort_order: 2, created_at: 2000 };
    const b = { _id: 2, sort_order: 2, created_at: 1000 };
    expect(sortDay([a, b]).map((r) => r._id)).toEqual([2, 1]);
  });

  it('assigns the next position past the highest in use, not the row count', () => {
    expect(nextPositionForDay([c(1, 0), c(2, 5), c(3, 5)], 'Monday')).toBe(6);
    expect(nextPositionForDay([c(1, 0), c(2, 1, undefined, 'Tuesday')], 'Monday')).toBe(1);
    expect(nextPositionForDay([], 'Monday')).toBe(0);
    expect(nextPositionForDay([c(1), c(2)], 'Monday')).toBe(0);
  });

  it('normalizes only the rows that are out of place', () => {
    expect(planNormalization([c(1, 0), c(2, 5), c(3)])).toEqual([
      { id: 2, sort_order: 1 },
      { id: 3, sort_order: 2 },
    ]);
    expect(planNormalization([c(1, 0), c(2, 1)])).toEqual([]);
  });

  it('reorders visible customers and keeps hidden ones after them without collisions', () => {
    const day = [c(1, 0), c(2, 1), c(3, 2), c(9, 1)]; // 9 is hidden (no active pool) and duplicates position 1
    const changes = planReorder(day, [c(3, 2), c(1, 0), c(2, 1)]);
    expect(changes).toEqual([
      { id: 3, sort_order: 0 },
      { id: 1, sort_order: 1 },
      { id: 2, sort_order: 2 },
      { id: 9, sort_order: 3 },
    ]);
  });

  it('is a no-op when the visible order already matches', () => {
    expect(planReorder([c(1, 0), c(2, 1)], [c(1, 0), c(2, 1)])).toEqual([]);
  });
});
