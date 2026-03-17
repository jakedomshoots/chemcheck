import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncState, useRecordSyncStatus } from './useSyncState';
import { syncService } from '@/lib/sync/SyncService';

// Mock the sync service
vi.mock('@/lib/sync/SyncService', () => ({
  syncService: {
    getSyncStatus: vi.fn(),
    getLastSyncResult: vi.fn(),
    getLastSyncAt: vi.fn(),
    onSyncStatusChange: vi.fn(),
    getPendingCount: vi.fn(),
    syncNow: vi.fn(),
    isRecordSynced: vi.fn(),
    getRecordSyncStatus: vi.fn(),
    syncRecord: vi.fn(),
  },
}));

describe('useSyncState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementations
    (syncService.getSyncStatus as any).mockReturnValue('idle');
    (syncService.getLastSyncResult as any).mockReturnValue(null);
    (syncService.getLastSyncAt as any).mockReturnValue(null);
    (syncService.onSyncStatusChange as any).mockReturnValue(() => {});
    (syncService.getPendingCount as any).mockResolvedValue(0);
    (syncService.syncNow as any).mockResolvedValue({
      success: true,
      syncedCount: 0,
      failedCount: 0,
      attemptedCount: 0,
      pendingCountAfter: 0,
      failures: [],
    });
    (syncService.isRecordSynced as any).mockResolvedValue(true);
    (syncService.getRecordSyncStatus as any).mockResolvedValue({ status: 'synced' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return initial sync state', () => {
    const { result } = renderHook(() => useSyncState());

    expect(result.current.status).toBe('idle');
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.lastSyncAt).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.failedCount).toBe(0);
    expect(result.current.lastResult).toBeNull();
    expect(typeof result.current.syncNow).toBe('function');
    expect(typeof result.current.isRecordSynced).toBe('function');
    expect(typeof result.current.getRecordSyncStatus).toBe('function');
    expect(typeof result.current.refreshPendingCount).toBe('function');
  });

  it('should subscribe to sync status changes', () => {
    const mockUnsubscribe = vi.fn();
    (syncService.onSyncStatusChange as any).mockReturnValue(mockUnsubscribe);

    const { unmount } = renderHook(() => useSyncState());

    expect(syncService.onSyncStatusChange).toHaveBeenCalledWith(expect.any(Function));

    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should call syncNow and handle success', async () => {
    (syncService.getLastSyncAt as any).mockReturnValue(123456);
    (syncService.syncNow as any).mockResolvedValue({
      success: true,
      syncedCount: 5,
      failedCount: 0,
      attemptedCount: 5,
      pendingCountAfter: 3,
      failures: [],
    });
    (syncService.getPendingCount as any).mockResolvedValue(3);

    const { result } = renderHook(() => useSyncState());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(syncService.syncNow).toHaveBeenCalled();
    expect(result.current.lastSyncAt).toBe(123456);
    expect(result.current.error).toBeNull();
    expect(result.current.failedCount).toBe(0);
  });

  it('should refresh counts and keep last sync time on partial failure', async () => {
    const errorMessage = 'customers[12] Not authenticated';
    (syncService.getLastSyncAt as any).mockReturnValue(999999);
    (syncService.syncNow as any).mockResolvedValue({
      success: false,
      error: 'Sync failed',
      syncedCount: 0,
      failedCount: 1,
      attemptedCount: 1,
      pendingCountAfter: 2,
      failures: [{ table: 'customers', localId: 12, error: errorMessage }],
    });
    (syncService.getPendingCount as any).mockResolvedValue(2);

    const { result } = renderHook(() => useSyncState());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.lastSyncAt).toBe(999999);
    expect(result.current.pendingCount).toBe(2);
    expect(result.current.failedCount).toBe(1);
  });

  it('should check if record is synced', async () => {
    (syncService.isRecordSynced as any).mockResolvedValue(true);

    const { result } = renderHook(() => useSyncState());

    const isSync = await result.current.isRecordSynced('customers', 123);

    expect(syncService.isRecordSynced).toHaveBeenCalledWith('customers', 123);
    expect(isSync).toBe(true);
  });

  it('should get record sync status', async () => {
    const mockStatus = { status: 'pending', error: 'Network error' };
    (syncService.getRecordSyncStatus as any).mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useSyncState());

    const status = await result.current.getRecordSyncStatus('serviceLogs', 456);

    expect(syncService.getRecordSyncStatus).toHaveBeenCalledWith('serviceLogs', 456);
    expect(status).toEqual(mockStatus);
  });
});

describe('useRecordSyncStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (syncService.getRecordSyncStatus as any).mockResolvedValue({ status: 'synced' });
    (syncService.syncRecord as any).mockResolvedValue({ success: true, syncedCount: 1, failedCount: 0 });
  });

  it('should return loading state initially', () => {
    const { result } = renderHook(() => useRecordSyncStatus('customers', 123));

    expect(result.current.loading).toBe(true);
    expect(result.current.syncStatus).toEqual({ status: 'pending' });
    expect(typeof result.current.retry).toBe('function');
  });

  it('should load sync status for valid record', async () => {
    const mockStatus = { status: 'error', error: 'Network timeout' };
    (syncService.getRecordSyncStatus as any).mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useRecordSyncStatus('serviceLogs', 789));

    // Wait for the effect to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.syncStatus).toEqual(mockStatus);
  });

  it('should handle undefined localId', () => {
    const { result } = renderHook(() => useRecordSyncStatus('customers', undefined));

    expect(result.current.loading).toBe(false);
    expect(syncService.getRecordSyncStatus).not.toHaveBeenCalled();
  });

  it('should retry sync on retry call', async () => {
    const { result } = renderHook(() => useRecordSyncStatus('customers', 123));

    await act(async () => {
      await result.current.retry();
    });

    expect(syncService.syncRecord).toHaveBeenCalledWith('customers', 123);
    expect(syncService.getRecordSyncStatus).toHaveBeenCalledWith('customers', 123);
  });
});
