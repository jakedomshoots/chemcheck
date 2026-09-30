import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAnalytics() {
  vi.resetModules();
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
  vi.stubEnv('DEV', false);
  return import('./analytics');
}

describe('analytics opt-out', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>)['ga-disable-G-TEST123'];
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: undefined });
  });

  it('never loads the GA script when the user opted out and sets the disable flag first', async () => {
    localStorage.setItem('analytics_opt_out', 'true');
    const analytics = await loadAnalytics();

    analytics.initAnalytics();

    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
    expect((window as unknown as Record<string, unknown>)['ga-disable-G-TEST123']).toBe(true);
    expect(analytics.hasOptedOut()).toBe(true);
    expect(analytics.isAnalyticsBlocked()).toBe(true);
  });

  it('honors Do Not Track', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    const analytics = await loadAnalytics();

    analytics.initAnalytics();

    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
    expect(analytics.isDoNotTrackEnabled()).toBe(true);
  });

  it('does not emit events after opting out even if gtag exists', async () => {
    const analytics = await loadAnalytics();
    const gtag = vi.fn();
    window.gtag = gtag;

    analytics.trackEvent('login');
    expect(gtag).toHaveBeenCalledTimes(1);

    analytics.optOutAnalytics();
    analytics.trackEvent('login');
    analytics.trackPageView('/home');
    expect(gtag).toHaveBeenCalledTimes(1);
  });
});
