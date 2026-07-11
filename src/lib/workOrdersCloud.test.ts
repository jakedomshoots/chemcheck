import { describe, expect, it } from 'vitest';
import { getWorkOrdersCloudState, requireWorkOrdersCloud } from './workOrdersCloud';

describe('getWorkOrdersCloudState', () => {
  it('keeps WorkOrders loading until the business query resolves', () => {
    expect(getWorkOrdersCloudState(undefined)).toBe('loading');
  });

  it('makes WorkOrders read-only when no business is available', () => {
    expect(getWorkOrdersCloudState(null)).toBe('unavailable');
  });

  it('allows WorkOrders actions only for a resolved business', () => {
    expect(getWorkOrdersCloudState({ _id: 'business_1' })).toBe('ready');
    expect(() => requireWorkOrdersCloud('unavailable')).toThrow('Work Orders requires a connected cloud business.');
  });
});
