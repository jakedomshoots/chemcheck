import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTimeState,
  MAX_ACTIVE_TRACKING_MS,
  saveTimeState,
  STORAGE_KEY_PREFIX,
} from './timeTrackingStorage';

describe('time tracking storage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('drops an abandoned active check-in instead of restoring a multi-day timer', () => {
    const startTime = new Date(Date.now() - MAX_ACTIVE_TRACKING_MS - 1).toISOString();
    saveTimeState('customer-1', { startTime, endTime: null, duration: null, isTracking: true });

    expect(getTimeState('customer-1')).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEY_PREFIX}customer-1`)).toBeNull();
  });

  it('keeps a recent active check-in available for a crash recovery resume', () => {
    const startTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    saveTimeState('customer-1', { startTime, endTime: null, duration: null, isTracking: true });

    expect(getTimeState('customer-1')).toMatchObject({ startTime, endTime: null });
  });
});
