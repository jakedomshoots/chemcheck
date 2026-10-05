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
    it('acceptRemote does not write raw Convex document fields into the resolved local record', () => {
      const local = {
        id: 5,
        customer_id: 3,
        pool_id: 11,
        convex_id: 'log-1',
        notes: 'local',
        sync_status: 'pending' as const,
        local_updated_at: 100,
        remote_updated_at: 50,
      };
      const remote = {
        _id: 'log-1',
        _creationTime: 1,
        business_id: 'biz-1',
        customer_id: 'cust-1',
        pool_id: 'pool-1',
        notes: 'remote',
        sync_status: 'synced' as const,
        local_updated_at: 200,
        remote_updated_at: 200,
      };

      const result = resolver.acceptRemote(local, remote as any);
      const resolved = result.resolved as any;

      expect(result.hadConflict).toBe(true);
      expect(result.backupCreated).toBe(true);
      expect(resolved).toMatchObject({
        id: 5,
        customer_id: 3,
        pool_id: 11,
        convex_customer_id: 'cust-1',
        convex_pool_id: 'pool-1',
        convex_id: 'log-1',
        notes: 'remote',
        sync_status: 'synced',
        local_updated_at: 200,
        remote_updated_at: 200,
      });
      expect(resolved).not.toHaveProperty('_id');
      expect(resolved).not.toHaveProperty('_creationTime');
      expect(resolved).not.toHaveProperty('business_id');
    });

    it('resolve keeps local data by default and never pulls raw remote fields in', () => {
      const local = {
        id: 5,
        customer_id: 3,
        convex_id: 'log-1',
        notes: 'local',
        sync_status: 'pending' as const,
        local_updated_at: 100,
        remote_updated_at: 50,
      };
      const remote = {
        _id: 'log-1',
        business_id: 'biz-1',
        customer_id: 'cust-1',
        notes: 'remote',
        sync_status: 'synced' as const,
        local_updated_at: 200,
        remote_updated_at: 200,
      };

      const result = resolver.resolve(local, remote as any);
      expect(result.hadConflict).toBe(true);
      expect(result.resolved).toMatchObject({
        id: 5, customer_id: 3, notes: 'local', sync_status: 'pending', local_updated_at: 100, remote_updated_at: 200,
      });
      expect(result.resolved).not.toHaveProperty('_id');
      expect(result.resolved).not.toHaveProperty('business_id');
    });

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

    it('keeps local data and advances the base when local device stamp is newer', () => {
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
      expect(result.resolved.sync_status).toBe('pending');
    });

    it('keeps local data and advances the base even when the remote server stamp is later than the device stamp', () => {
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
      expect(result.resolved.local_updated_at).toBe(1500); // local data untouched
      expect(result.resolved.remote_updated_at).toBe(2000); // base advanced
      expect(result.resolved.sync_status).toBe('pending'); // still needs pushing
    });

    it('reports no conflict when the remote stamp is not past the base this device last saw', () => {
      // local_updated_at older than the server stamp (device clock behind, or
      // network latency on the previous push) is not a conflict.
      const local: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 900,
        remote_updated_at: 1000,
      };
      const remote: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1000,
        remote_updated_at: 1000,
      };

      expect(resolver.detectConflict(local, remote)).toBe(false);
      const result = resolver.resolve(local, remote);
      expect(result.hadConflict).toBe(false);
      expect(result.resolved).toBe(local);
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
     * For any pending record whose remote version moved past the base version the device last saw,
     * the Conflict_Resolver SHALL detect the conflict, create a backup in conflict_backup, keep the
     * local data and advance the base (remote_updated_at) to the remote version.
     * Validates: Requirements 7.1, 7.2, 7.3, 7.4
     */
    it('Property 7: Conflicts Detected and Backed Up', () => {
      fc.assert(
        fc.property(
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
            const local: SyncableRecord = { ...localData };
            const remote: SyncableRecord = { ...remoteData };
            const base = local.remote_updated_at || 0;
            const remoteTime = remote.remote_updated_at || 0;

            // Property: a conflict exists iff the local row carries a pending
            // edit and the server moved past the base this device last saw.
            // Device-clock stamps never decide it.
            const expected = localData.sync_status !== 'synced' && remoteTime > base;
            expect(resolver.detectConflict(local, remote)).toBe(expected);
            if (!expected) {
              const untouched = resolver.resolve(local, remote);
              expect(untouched.hadConflict).toBe(false);
              expect(untouched.resolved).toBe(local);
              return true;
            }

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
            expect(backup!.data.local_updated_at).toBe(localData.local_updated_at);

            // Property: pending local edits win; only the base advances.
            expect(result.resolved.local_updated_at).toBe(localData.local_updated_at);
            expect(result.resolved.sync_status).toBe(localData.sync_status);
            expect(result.resolved.remote_updated_at).toBe(Math.max(remoteTime, base));

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});