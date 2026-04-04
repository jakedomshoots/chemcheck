import { useState, useEffect, useCallback } from 'react';
import { syncService, SyncStatus, RecordSyncStatus } from '@/lib/sync/SyncService';

export interface UseSyncStateReturn {
  // Overall sync status
  status: SyncStatus;
  
  // Number of pending records
  pendingCount: number;
  
  // Last sync timestamp
  lastSyncAt: number | null;
  
  // Current error if any
  error: string | null;
  
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
  const [status, setStatus] = useState<SyncStatus>(syncService.getSyncStatus());
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to sync status changes
  useEffect(() => {
    const unsubscribe = syncService.onSyncStatusChange((newStatus) => {
      setStatus(newStatus);
      
      // Clear error when status changes to non-error state
      if (newStatus !== 'error') {
        setError(null);
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

  // Refresh pending count periodically (only when visible to reduce background work)
  useEffect(() => {
    const intervalMs = 15000;

    if (typeof document === 'undefined') {
      return undefined;
    }

    let interval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (interval !== null) {
        return;
      }

      refreshPendingCount();

      interval = window.setInterval(() => {
        if (!document.hidden) {
          refreshPendingCount();
        }
      }, intervalMs);
    };

    const stopPolling = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };

    if (!document.hidden) {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshPendingCount]);

  const syncNow = useCallback(async () => {
    try {
      setError(null);
      const result = await syncService.syncNow();
      
      if (result.success) {
        setLastSyncAt(Date.now());
        await refreshPendingCount();
      } else {
        setError(result.error || 'Sync failed');
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
