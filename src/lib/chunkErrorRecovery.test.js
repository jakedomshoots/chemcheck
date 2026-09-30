import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RETRIES,
  RETRY_COOL_DOWN_MS,
  handleChunkError,
  importWithRetry,
  markChunkLoaded,
  readRetryState,
  resetRetryCount,
} from './chunkErrorRecovery';

describe('chunkErrorRecovery', () => {
  let reload;

  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = '';
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('persists the attempt count across reloads and stops after MAX_RETRIES', () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      expect(handleChunkError(new Error('Loading chunk 1 failed'), 'Home')).toBe('reload');
      expect(readRetryState('Home').attempts).toBe(attempt);
    }
    expect(reload).toHaveBeenCalledTimes(MAX_RETRIES);

    // Simulated fresh module after reload: sessionStorage still holds the count.
    expect(handleChunkError(new Error('Loading chunk 1 failed'), 'Home')).toBe('failed');
    expect(reload).toHaveBeenCalledTimes(MAX_RETRIES);
    expect(readRetryState('Home').attempts).toBe(MAX_RETRIES);
  });

  it('renders a visible "Update failed" message with a retry control instead of reloading', () => {
    sessionStorage.setItem('chemcheck_chunk_retry:Home', JSON.stringify({ attempts: MAX_RETRIES, lastAttemptAt: Date.now() }));
    handleChunkError(new Error('Failed to fetch dynamically imported module'), 'Home');

    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toMatch(/Update failed/i);
    expect(alert.textContent).toMatch(/retry/i);
    expect(reload).not.toHaveBeenCalled();

    alert.querySelector('button').click();
    expect(readRetryState('Home').attempts).toBe(0);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('only resets the count on a successful load after the cool-down', () => {
    const now = Date.now();
    sessionStorage.setItem('chemcheck_chunk_retry:Home', JSON.stringify({ attempts: 2, lastAttemptAt: now }));

    markChunkLoaded('Home', now + 1000);
    expect(readRetryState('Home').attempts).toBe(2);

    resetRetryCount(undefined, now + 1000);
    expect(readRetryState('Home').attempts).toBe(2);

    markChunkLoaded('Home', now + RETRY_COOL_DOWN_MS);
    expect(readRetryState('Home').attempts).toBe(0);
  });

  it('marks the chunk loaded on a successful import and rethrows non-chunk errors untouched', async () => {
    const value = await importWithRetry(async () => ({ default: 'ok' }), 'Home');
    expect(value).toEqual({ default: 'ok' });

    await expect(importWithRetry(async () => { throw new Error('boom'); }, 'Home')).rejects.toThrow('boom');
    expect(reload).not.toHaveBeenCalled();

    await expect(importWithRetry(async () => { throw new Error('Loading chunk 3 failed'); }, 'Home')).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
