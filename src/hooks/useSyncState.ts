import { useState, useEffect, useCallback } from 'react';
import { syncService, SyncStatus, RecordSyncStatus, SyncResult } from '@/lib/sync/SyncService';

export interface UseSyncStateReturn {
  // Overall sync status
  status: SyncStatus;
  
  // Number of pending records
  pendingCount: number;
  
  // Last sync timestamp
  lastSyncAt: number | null;
  
  // Current error if any
  error: string | null;

  // Number of failed records from the last sync attempt
  failedCount: number;

  // Last sync result details
  lastResult: SyncResult | null;
  
  // Trigger manual sync
  syncNow: () => Promise<void>;
  
  // Check if specific record is synced
  isRecordSynced: (table: string, localId: number) => Promise<boolean>;
  
  // Get sync status for specific record
  getRecordSyncStatus: (table: string, localId: number) => Promise<RecordSyncStatus>;
  
  // Refresh pending count
  refreshPendingCount: () => Promise<void>;
}

/**
 * React hook for accessing sync state and operations
 * Provides real-time sync status, pending counts, and sync controls
 */
export function useSyncState(): UseSyncStateReturn {
  const initialResult = syncService.getLastSyncResult();
  const [status, setStatus] = useState<SyncStatus>(syncService.getSyncStatus());
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(syncService.getLastSyncAt());
  const [error, setError] = useState<string | null>(initialResult?.failures?.[0]?.error || initialResult?.error || null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(initialResult);
  const [failedCount, setFailedCount] = useState<number>(initialResult?.failedCount ?? 0);

  // Subscribe to sync status changes
  useEffect(() => {
    const unsubscribe = syncService.onSyncStatusChange((newStatus) => {
      setStatus(newStatus);

      if (newStatus !== 'syncing') {
        const latestResult = syncService.getLastSyncResult();
        setLastResult(latestResult);
        setFailedCount(latestResult?.failedCount ?? 0);
        setLastSyncAt(syncService.getLastSyncAt());

        const latestError = latestResult?.failures?.[0]?.error || latestResult?.error || null;
        setError(latestError);

        if (!latestError && newStatus !== 'error') {
          setError(null);
        }
      }
    });

    return unsubscribe;
  }, []);

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await syncService.getPendingCount();
      setPendingCount(count);
    } catch (err) {
      console.error('Failed to get pending count:', err);
    }
  }, []);

  // Load initial pending count
  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  // Refresh pending count periodically
  useEffect(() => {
    const interval = setInterval(() => {
      refreshPendingCount();
    }, 10000); // Every 10 seconds

    return () => clearInterval(interval);
  }, [refreshPendingCount]);

  const syncNow = useCallback(async () => {
    try {
      setError(null);
      const result = await syncService.syncNow();

      setLastResult(result);
      setFailedCount(result.failedCount);
      if (result.attemptedCount > 0) {
        setLastSyncAt(syncService.getLastSyncAt());
      }

      await refreshPendingCount();

      if (!result.success) {
        setError(result.failures?.[0]?.error || result.error || 'Sync failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown sync error';
      setError(errorMessage);
      console.error('Sync failed:', err);
    }
  }, [refreshPendingCount]);

  const isRecordSynced = useCallback(async (table: string, localId: number): Promise<boolean> => {
    try {
      return await syncService.isRecordSynced(table, localId);
    } catch (err) {
      console.error(`Failed to check sync status for ${table}[${localId}]:`, err);
      return false;
    }
  }, []);

  const getRecordSyncStatus = useCallback(async (table: string, localId: number): Promise<RecordSyncStatus> => {
    try {
      return await syncService.getRecordSyncStatus(table, localId);
    } catch (err) {
      console.error(`Failed to get sync status for ${table}[${localId}]:`, err);
      return {
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }, []);

  return {
    status,
    pendingCount,
    lastSyncAt,
    error,
    failedCount,
    lastResult,
    syncNow,
    isRecordSynced,
    getRecordSyncStatus,
    refreshPendingCount,
  };
}

/**
 * Hook for getting sync status of a specific record
 * Useful for individual components that need to show sync status
 */
export function useRecordSyncStatus(table: string, localId: number | undefined) {
  const [syncStatus, setSyncStatus] = useState<RecordSyncStatus>({ status: 'pending' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (localId === undefined) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const loadSyncStatus = async () => {
      try {
        const status = await syncService.getRecordSyncStatus(table, localId);
        if (mounted) {
          setSyncStatus(status);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setSyncStatus({
            status: 'error',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
          setLoading(false);
        }
      }
    };

    loadSyncStatus();

    // Refresh sync status periodically
    const interval = setInterval(loadSyncStatus, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [table, localId]);

  const retry = useCallback(async () => {
    if (localId === undefined) return;

    try {
      setLoading(true);
      await syncService.syncRecord(table, localId);
      
      // Refresh status after sync attempt
      const newStatus = await syncService.getRecordSyncStatus(table, localId);
      setSyncStatus(newStatus);
    } catch (err) {
      setSyncStatus({
        status: 'error',
        error: err instanceof Error ? err.message : 'Sync failed',
      });
    } finally {
      setLoading(false);
    }
  }, [table, localId]);

  return {
    syncStatus,
    loading,
    retry,
  };
}
