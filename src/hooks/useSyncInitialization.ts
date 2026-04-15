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
      return;
    }

    if (isSignedIn && convex) {
      try {
        // Initialize sync service with Convex client
        syncService.initialize(convex);
        syncService.startAutoSync();
      } catch (error) {
        console.error('Failed to initialize sync service:', error);
      }
      
      return () => {
        try {
          syncService.stopAutoSync();
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