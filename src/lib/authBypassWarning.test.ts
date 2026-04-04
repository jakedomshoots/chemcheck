import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAuthBypassWarningCacheForTests, warnAuthBypassOnce } from './authBypassWarning';

describe('warnAuthBypassOnce', () => {
  beforeEach(() => {
    resetAuthBypassWarningCacheForTests();
    vi.restoreAllMocks();
  });

  it('logs each source+reason combination only once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    warnAuthBypassOnce('Clerk', 'localhost');
    warnAuthBypassOnce('Clerk', 'localhost');
    warnAuthBypassOnce('Convex', 'localhost');
    warnAuthBypassOnce('Convex', 'localhost');
    warnAuthBypassOnce('Clerk', 'ios-simulator');

    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenNthCalledWith(1, '[AuthPolicy] Clerk bypass enabled via localhost');
    expect(warnSpy).toHaveBeenNthCalledWith(2, '[AuthPolicy] Convex bypass enabled via localhost');
    expect(warnSpy).toHaveBeenNthCalledWith(3, '[AuthPolicy] Clerk bypass enabled via ios-simulator');
  });

  it('does not log when reason is none', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    warnAuthBypassOnce('Clerk', 'none');
    warnAuthBypassOnce('Convex', 'none');

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
