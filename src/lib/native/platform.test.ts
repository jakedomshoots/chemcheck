import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorMock = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
  isPluginAvailable: vi.fn(() => false),
}));
const registerPluginMock = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/core', () => ({
  Capacitor: capacitorMock,
  registerPlugin: registerPluginMock,
}));

import { buildTodayGlancePayload, publishTodayGlance, TODAY_GLANCE_PLUGIN } from './platform';

describe('buildTodayGlancePayload', () => {
  it('produces a serializable widget payload with clamped counts', () => {
    const now = new Date('2026-06-08T15:00:00.000Z');
    const payload = buildTodayGlancePayload({
      date: '2026-06-08',
      totalStops: 8,
      completedStops: 3,
      skippedStops: 1,
      nextStop: { customerId: 42, name: 'Blue Heron', address: ' 707 Blue Heron Blvd ', mapsUrl: 'https://maps.example/707' },
      estimatedFinishAt: new Date('2026-06-08T19:30:00.000Z'),
      now,
    });

    expect(payload).toEqual({
      version: 1,
      generatedAt: '2026-06-08T15:00:00.000Z',
      date: '2026-06-08',
      totalStops: 8,
      completedStops: 3,
      skippedStops: 1,
      remainingStops: 4,
      progressPercent: 38,
      nextStop: { customerId: '42', name: 'Blue Heron', address: '707 Blue Heron Blvd', mapsUrl: 'https://maps.example/707' },
      estimatedFinishAt: '2026-06-08T19:30:00.000Z',
      deepLink: 'chemcheck://route/today?next=42',
    });
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it('handles an empty day and bad input without throwing', () => {
    const payload = buildTodayGlancePayload({ date: '2026-06-08', totalStops: 0, completedStops: 5, skippedStops: -2, estimatedFinishAt: 'nope' });
    expect(payload).toMatchObject({ totalStops: 0, completedStops: 0, skippedStops: 0, remainingStops: 0, progressPercent: 0, nextStop: null, estimatedFinishAt: null, deepLink: 'chemcheck://route/today' });
  });
});

describe('publishTodayGlance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capacitorMock.isNativePlatform.mockReturnValue(false);
    capacitorMock.isPluginAvailable.mockReturnValue(false);
  });

  const payload = buildTodayGlancePayload({ date: '2026-06-08', totalStops: 1, completedStops: 0, skippedStops: 0 });

  it('is a silent no-op on the web', async () => {
    await expect(publishTodayGlance(payload)).resolves.toBe(false);
    expect(registerPluginMock).not.toHaveBeenCalled();
  });

  it('is a no-op in a native shell without the plugin', async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);
    await expect(publishTodayGlance(payload)).resolves.toBe(false);
  });

  it('hands the payload to the plugin when it is registered', async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);
    capacitorMock.isPluginAvailable.mockReturnValue(true);
    const update = vi.fn(async () => undefined);
    registerPluginMock.mockReturnValue({ update });

    await expect(publishTodayGlance(payload)).resolves.toBe(true);
    expect(registerPluginMock).toHaveBeenCalledWith(TODAY_GLANCE_PLUGIN);
    expect(update).toHaveBeenCalledWith({ payload });
  });

  it('swallows plugin failures', async () => {
    capacitorMock.isNativePlatform.mockReturnValue(true);
    capacitorMock.isPluginAvailable.mockReturnValue(true);
    registerPluginMock.mockReturnValue({ update: vi.fn(async () => { throw new Error('bridge down'); }) });
    await expect(publishTodayGlance(payload)).resolves.toBe(false);
  });
});
