import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { getFailedText } from './syncStatusUtils';
import { useSyncState } from '@/hooks/useSyncState';

vi.mock('@/hooks/useSyncState', () => ({
  useSyncState: vi.fn(),
}));

function mockState(overrides: Record<string, unknown>) {
  (useSyncState as any).mockReturnValue({
    status: 'idle',
    pendingCount: 0,
    failedCount: 0,
    lastSyncAt: null,
    error: null,
    syncNow: vi.fn(),
    retryFailed: vi.fn(async () => undefined),
    ...overrides,
  });
}

describe('SyncStatusIndicator failed changes affordance', () => {
  afterEach(() => cleanup());

  it('shows how many changes failed and retries them on click', () => {
    const retryFailed = vi.fn(async () => undefined);
    mockState({ status: 'error', failedCount: 3, retryFailed });

    render(<SyncStatusIndicator />);
    const retry = screen.getByRole('button', { name: '3 changes failed to sync — Retry' });
    fireEvent.click(retry);

    expect(retryFailed).toHaveBeenCalledTimes(1);
  });

  it('hides the affordance when nothing failed', () => {
    mockState({ failedCount: 0 });
    render(<SyncStatusIndicator />);
    expect(screen.queryByRole('button', { name: /failed to sync/ })).toBeNull();
  });

  it('disables retry while offline', () => {
    const retryFailed = vi.fn();
    mockState({ status: 'offline', failedCount: 1, retryFailed });
    render(<SyncStatusIndicator />);
    const retry = screen.getByRole('button', { name: '1 change failed to sync — Retry' });
    expect((retry as HTMLButtonElement).disabled).toBe(true);
  });

  it('pluralizes the failed text', () => {
    expect(getFailedText(1)).toBe('1 change failed to sync');
    expect(getFailedText(2)).toBe('2 changes failed to sync');
  });
});
