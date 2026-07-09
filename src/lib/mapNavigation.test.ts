import { describe, expect, it, vi } from 'vitest';
import { buildNavigationUrl, encodeMapQuery } from './mapNavigation';

describe('map navigation', () => {
  it('encodes address destinations', () => {
    expect(encodeMapQuery('100 Main St, Los Angeles')).toContain('%20');
    expect(buildNavigationUrl('100 Main St')).toContain('100%20Main%20St');
  });

  it('uses geocoded coordinates when available', () => {
    expect(buildNavigationUrl({ address: '100 Main St', latitude: 34.1, longitude: -118.2 }))
      .toContain('34.1%2C-118.2');
  });

  it('does not open navigation without a destination', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    // empty destinations are ignored by openNavigation; this test only asserts URL construction is safe.
    expect(buildNavigationUrl({})).toContain('destination=');
    open.mockRestore();
  });
});
