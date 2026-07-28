import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOTTOM_NAV_STORAGE_KEY,
  DEFAULT_BOTTOM_NAV_IDS,
  getBottomNavigation,
  normalizeBottomNavigation,
  setBottomNavigation,
} from './bottomNavigation';

describe('bottom navigation preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('falls back to the field-ready default when storage is missing or malformed', () => {
    expect(getBottomNavigation()).toEqual(DEFAULT_BOTTOM_NAV_IDS);

    localStorage.setItem(BOTTOM_NAV_STORAGE_KEY, '{not json');
    expect(getBottomNavigation()).toEqual(DEFAULT_BOTTOM_NAV_IDS);
  });

  it('deduplicates, bounds, and repairs user-provided destinations', () => {
    expect(normalizeBottomNavigation(['workOrders', 'workOrders', 'bogus', 'reports'])).toEqual([
      'workOrders',
      'reports',
    ]);

    expect(normalizeBottomNavigation(['route'])).toEqual(['route', 'home']);
    expect(normalizeBottomNavigation(['home', 'clients', 'notes', 'reports', 'route'])).toEqual([
      'home',
      'clients',
      'notes',
      'reports',
    ]);
  });

  it('persists valid choices and announces same-tab changes', () => {
    const listener = vi.fn();
    window.addEventListener('chemcheck:bottom-navigation-change', listener);

    expect(setBottomNavigation(['workOrders', 'route', 'clients'])).toEqual([
      'workOrders',
      'route',
      'clients',
    ]);
    expect(JSON.parse(localStorage.getItem(BOTTOM_NAV_STORAGE_KEY) || '{}')).toMatchObject({
      version: 1,
      items: ['workOrders', 'route', 'clients'],
    });
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener('chemcheck:bottom-navigation-change', listener);
  });

  it('keeps the current-session choice when persistent storage is unavailable', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });

    try {
      setBottomNavigation(['reports', 'route']);
      expect(getBottomNavigation()).toEqual(['reports', 'route']);
    } finally {
      setItem.mockRestore();
      setBottomNavigation(DEFAULT_BOTTOM_NAV_IDS);
      localStorage.clear();
    }
  });
});
