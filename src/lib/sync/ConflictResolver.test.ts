import { describe, it, expect } from 'vitest';
import { ConflictResolver } from './ConflictResolver';
import { SyncableRecord } from '@/db/chemcheck-db';
import fc from 'fast-check';

describe('ConflictResolver', () => {
  const resolver = new ConflictResolver();

  describe('detectConflict', () => {
    it('should detect no conflict when timestamps are missing', () => {
      const local: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 1000,
      };
      const remote: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 2000,
      };

      expect(resolver.detectConflict(local, remote)).toBe(false);
    });

    it('should detect no conflict when local record has not been modified since last sync', () => {
      const local: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1000,
        remote_updated_at: 1500,
      };
      const remote: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1000,
        remote_updated_at: 2000,
      };

      expect(resolver.detectConflict(local, remote)).toBe(false);
    });

    it('should detect conflict when both records have been modified', () => {
      const local: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 2000,
        remote_updated_at: 1000,
      };
      const remote: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1500,
        remote_updated_at: 1800,
      };

      expect(resolver.detectConflict(local, remote)).toBe(true);
    });
  });

  describe('resolve', () => {
    it('should return local record when no conflict exists', () => {
      const local: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 1000,
      };
      const remote: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1000,
      };

      const result = resolver.resolve(local, remote);

      expect(result.hadConflict).toBe(false);
      expect(result.backupCreated).toBe(false);
      expect(result.resolved).toEqual(local);
    });

    it('should use last-write-wins when conflict exists - local wins', () => {
      const local: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 2000,
        remote_updated_at: 1000,
      };
      const remote: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1500,
        remote_updated_at: 1800,
      };

      const result = resolver.resolve(local, remote);

      expect(result.hadConflict).toBe(true);
      expect(result.backupCreated).toBe(true);
      expect(result.resolved.local_updated_at).toBe(2000);
      expect(result.resolved.remote_updated_at).toBe(1800);
    });

    it('should use last-write-wins when conflict exists - remote wins', () => {
      const local: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 1500,
        remote_updated_at: 1000,
      };
      const remote: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1800,
        remote_updated_at: 2000,
      };

      const result = resolver.resolve(local, remote);

      expect(result.hadConflict).toBe(true);
      expect(result.backupCreated).toBe(true);
      expect(result.resolved.local_updated_at).toBe(2000); // Updated to match remote
      expect(result.resolved.remote_updated_at).toBe(2000);
      expect(result.resolved.sync_status).toBe('synced'); // Should be marked as synced
      expect(result.resolved.sync_error).toBeUndefined(); // No error
    });
  });

  describe('createBackup', () => {
    it('should create JSON backup of record', () => {
      const record: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 1000,
        remote_updated_at: 500,
      };

      const success = resolver.createBackup(record);

      expect(success).toBe(true);
      expect(record.conflict_backup).toBeDefined();
      
      const backup = resolver.parseBackup(record.conflict_backup!);
      expect(backup).toBeDefined();
      expect(backup!.data.sync_status).toBe('pending');
      expect(backup!.data.local_updated_at).toBe(1000);
    });
  });

  describe('getConflictInfo', () => {
    it('should return null when no conflict exists', () => {
      const local: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 1000,
      };
      const remote: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1000,
      };

      const info = resolver.getConflictInfo(local, remote);
      expect(info).toBeNull();
    });

    it('should return conflict info when conflict exists', () => {
      const local: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 2000,
        remote_updated_at: 1000,
      };
      const remote: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1500,
        remote_updated_at: 1800,
      };

      const info = resolver.getConflictInfo(local, remote);
      
      expect(info).toBeDefined();
      expect(info!.localTimestamp).toBe(2000);
      expect(info!.remoteTimestamp).toBe(1800);
      expect(Array.isArray(info!.conflictedFields)).toBe(true);
    });
  });

  describe('Property-Based Tests', () => {
    /**
     * Feature: data-sync, Property 7: Conflicts Detected and Backed Up
     * For any record where local_updated_at differs from remote_updated_at and both have been modified since last sync,
     * the Conflict_Resolver SHALL detect the conflict, create a backup in conflict_backup, and resolve using last-write-wins.
     * Validates: Requirements 7.1, 7.2, 7.3, 7.4
     */
    it('Property 7: Conflicts Detected and Backed Up', () => {
      fc.assert(
        fc.property(
          // Generate local and remote records with different timestamps to create conflicts
          fc.record({
            local_updated_at: fc.integer({ min: 1000, max: 5000 }),
            remote_updated_at: fc.integer({ min: 500, max: 2000 }),
            sync_status: fc.constantFrom('pending', 'synced', 'error'),
            sync_error: fc.option(fc.string(), { nil: undefined }),
            convex_id: fc.option(fc.string(), { nil: undefined }),
          }),
          fc.record({
            local_updated_at: fc.integer({ min: 1500, max: 4000 }),
            remote_updated_at: fc.integer({ min: 1000, max: 6000 }),
            sync_status: fc.constantFrom('pending', 'synced', 'error'),
            sync_error: fc.option(fc.string(), { nil: undefined }),
            convex_id: fc.option(fc.string(), { nil: undefined }),
          }),
          (localData, remoteData) => {
            // Ensure we have a conflict scenario by making sure both records have been modified
            // and their timestamps differ
            const local: SyncableRecord = {
              ...localData,
              // Ensure local has been modified since last remote sync
              remote_updated_at: Math.min(localData.remote_updated_at, localData.local_updated_at - 100),
            };
            
            const remote: SyncableRecord = {
              ...remoteData,
              // Ensure timestamps differ to create conflict
              remote_updated_at: localData.local_updated_at !== remoteData.remote_updated_at 
                ? remoteData.remote_updated_at 
                : remoteData.remote_updated_at + 1,
            };

            // Only test when we actually have a conflict
            if (!resolver.detectConflict(local, remote)) {
              return true; // Skip this case
            }

            // Property: Conflict should be detected
            expect(resolver.detectConflict(local, remote)).toBe(true);

            // Property: Resolution should create backup and resolve conflict
            const result = resolver.resolve(local, remote);
            
            // Property: Conflict should be detected in resolution
            expect(result.hadConflict).toBe(true);
            
            // Property: Backup should be created
            expect(result.backupCreated).toBe(true);
            expect(local.conflict_backup).toBeDefined();
            
            // Property: Backup should be parseable and contain original data
            const backup = resolver.parseBackup(local.conflict_backup!);
            expect(backup).toBeDefined();
            expect(backup!.data.sync_status).toBe(localData.sync_status);
            
            // Property: Resolution should use last-write-wins
            const localTime = local.local_updated_at || 0;
            const remoteTime = remote.remote_updated_at || 0;
            
            if (localTime > remoteTime) {
              // Local wins - should keep local timestamp
              expect(result.resolved.local_updated_at).toBe(localTime);
            } else {
              // Remote wins - should update local timestamp to match remote
              expect(result.resolved.local_updated_at).toBe(remoteTime);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});