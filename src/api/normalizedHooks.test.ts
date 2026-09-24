import { describe, expect, it } from 'vitest';
import { getActivePoolCustomerIds } from './normalizedHooks';

describe('getActivePoolCustomerIds', () => {
  it('keeps only customers with active pools', () => {
    const ids = getActivePoolCustomerIds([
      { customer_id: 11, active: true },
      { customer_id: 12, active: false },
      { customer_id: 13, active: true },
      { customer_id: 13, active: true },
    ] as never[]);

    expect([...ids]).toEqual([11, 13]);
  });

  it('ignores invalid customer references', () => {
    const ids = getActivePoolCustomerIds([
      { customer_id: 0, active: true },
      { customer_id: Number.NaN, active: true },
      { customer_id: 21, active: true },
    ] as never[]);

    expect([...ids]).toEqual([21]);
  });
});
