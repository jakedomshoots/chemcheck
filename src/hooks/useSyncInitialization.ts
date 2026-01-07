import { useEffect } from 'react';
import { useConvex } from 'convex/react';
import { syncService } from '@/lib/sync/SyncService';

/**
 * Hook to initialize the sync service with Convex client
 * Should be called once when the app starts and user is authenticated
 */
export function useSyncInitialization(isSignedIn: boolean, isOfflineMode: boolean = false) {
  const convex = useConvex();

  useEffect(() => {
    if (isOfflineMode) {
      // In offline mode, don't initialize sync
      console.log('Offline mode detected - sync service disabled');
      return;
    }

    if (isSignedIn && convex) {
      try {
        // Initialize sync service with Convex client
        syncService.initialize(convex);
        syncService.startAutoSync();
        
        console.log('Sync service initialized and auto-sync started');
      } catch (error) {
        console.error('Failed to initialize sync service:', error);
        // In production, you might want to:
        // - Show user notification
        // - Retry with exponential backoff
        // - Fall back to offline-only mode
      }
      
      return () => {
        try {
          syncService.stopAutoSync();
          console.log('Sync service auto-sync stopped');
        } catch (error) {
          console.error('Error stopping sync service:', error);
        }
      };
    } else {
      // Stop sync when not signed in
      try {
        syncService.stopAutoSync();
      } catch (error) {
        console.error('Error stopping sync service:', error);
      }
    }
  }, [isSignedIn, convex, isOfflineMode]);
}