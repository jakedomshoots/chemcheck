import { useEffect } from 'react';
import { useConvex } from 'convex/react';
import type { ConvexReactClient } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { syncService } from '@/lib/sync/SyncService';
import type { ConvexClient as PhotoConvexClient } from '@/lib/proof-of-service/photoSyncService';

// Background uploads retry once per run; failed photos are retried on later
// sync cycles (see photoSyncService FAILED_PHOTO_RETRY_MS).
const PHOTO_AUTO_SYNC_CONFIG = { maxRetries: 1 };

/** Adapt the Convex React client to the photo sync service's client shape. */
export function createPhotoSyncClient(convex: ConvexReactClient): PhotoConvexClient {
  return {
    mutation: async (name, args = {}) => {
      if (name === 'servicePhotos:generateUploadUrl') {
        return convex.mutation(api.servicePhotos.generateUploadUrl, {});
      }
      if (name === 'servicePhotos:uploadPhoto') {
        return convex.mutation(api.servicePhotos.uploadPhoto, args as any);
      }
      throw new Error(`Unsupported photo sync mutation: ${name}`);
    },
  };
}

/**
 * Hook to initialize the sync service with Convex client
 * Should be called once when the app starts and user is authenticated
 */
export function useSyncInitialization(isSignedIn: boolean, isOfflineMode: boolean = false, userScope?: string) {
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
        syncService.initialize(convex, userScope);
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
  }, [isSignedIn, convex, isOfflineMode, userScope]);

  // Upload proof-of-service photos in the background: after every record
  // sync cycle (their service logs must reach the server first) and when the
  // device comes back online — not only when a report is sent.
  useEffect(() => {
    if (isOfflineMode || !isSignedIn || !convex) return undefined;
    if (typeof window === 'undefined') return undefined;

    let active = true;
    const photoClient = createPhotoSyncClient(convex);
    const runPhotoSync = () => {
      import('@/lib/proof-of-service/photoSyncService')
        .then(({ syncPendingPhotos }) => (active ? syncPendingPhotos(photoClient, PHOTO_AUTO_SYNC_CONFIG) : undefined))
        .catch((error) => console.error('Background photo sync failed:', error));
    };

    const unsubscribe = typeof syncService.onSyncComplete === 'function'
      ? syncService.onSyncComplete(() => runPhotoSync())
      : undefined;
    window.addEventListener('online', runPhotoSync);
    runPhotoSync();

    return () => {
      active = false;
      unsubscribe?.();
      window.removeEventListener('online', runPhotoSync);
    };
  }, [isSignedIn, convex, isOfflineMode]);
}
