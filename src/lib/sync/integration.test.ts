import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConflictResolver } from './ConflictResolver';
import { SyncableRecord } from '@/db/chemcheck-db';

/**
 * Integration Tests for Data Sync Feature
 * 
 * These tests verify the complete sync workflow including:
 * - Task 12.1: Full offline/online cycle
 * - Task 12.2: Conflict resolution
 * - Task 12.3: Migration flow
 */

// Mock the database
vi.mock('@/db/chemcheck-db', () => {
  const createMockTable = () => ({
    get: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    where: vi.fn(() => ({
      equals: vi.fn(() => ({
        count: vi.fn(() => Promise.resolve(0)),
        toArray: vi.fn(() => Promise.resolve([])),
      })),
      notEqual: vi.fn(() => ({
        count: vi.fn(() => Promise.resolve(0)),
        toArray: vi.fn(() => Promise.resolve([])),
      })),
    })),
    count: vi.fn(() => Promise.resolve(0)),
    toArray: vi.fn(() => Promise.resolve([])),
  });

  return {
    db: {
      customers: createMockTable(),
      serviceLogs: createMockTable(),
      chemicalUsage: createMockTable(),
      notes: createMockTable(),
      setSyncService: vi.fn(),
    },
    SyncableRecord: {},
  };
});

// Mock Convex API
vi.mock('../../../convex/_generated/api', () => ({
  api: {
    sync: {
      syncCustomer: 'syncCustomer',
      syncServiceLog: 'syncServiceLog',
      syncChemicalUsage: 'syncChemicalUsage',
      syncNote: 'syncNote',
    },
  },
}));

// Mock SyncQueue
vi.mock('./SyncQueue', () => {
  const MockSyncQueue = vi.fn();
  MockSyncQueue.prototype.enqueue = vi.fn();
  MockSyncQueue.prototype.dequeue = vi.fn();
  MockSyncQueue.prototype.getPending = vi.fn(() => []);
  MockSyncQueue.prototype.getPendingCount = vi.fn(() => 0);
  MockSyncQueue.prototype.markSynced = vi.fn();
  MockSyncQueue.prototype.markFailed = vi.fn();
  MockSyncQueue.prototype.getRetryableItems = vi.fn(() => []);
  MockSyncQueue.prototype.findItem = vi.fn(() => undefined);
  
  return { SyncQueue: MockSyncQueue };
});

describe('Integration Tests: Data Sync', () => {
  let conflictResolver: ConflictResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    conflictResolver = new ConflictResolver();
    
    // Mock navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });


  /**
   * Task 12.1: Test full offline/online cycle
   * Create records offline, verify sync on reconnect
   */
  describe('12.1 Full Offline/Online Cycle', () => {
    it('should detect offline status correctly', async () => {
      // Import SyncService dynamically to avoid memory issues
      const { SyncService } = await import('./SyncService');
      const syncService = new SyncService();
      const mockConvexClient = { mutation: vi.fn(), query: vi.fn() };
      
      try {
        syncService.initialize(mockConvexClient);
        
        // Simulate going offline
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
        const offlineEvent = new Event('offline');
        window.dispatchEvent(offlineEvent);
        
        // Verify offline status
        expect(syncService.getSyncStatus()).toBe('offline');
        expect(syncService.isOnlineStatus()).toBe(false);
      } finally {
        syncService.destroy();
      }
    });

    it('should throw error when syncing while offline', async () => {
      // Set offline BEFORE creating the service
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
      
      const { SyncService } = await import('./SyncService');
      const syncService = new SyncService();
      const mockConvexClient = { mutation: vi.fn(), query: vi.fn() };
      
      try {
        syncService.initialize(mockConvexClient);
        
        // Attempt sync while offline - should throw error
        await expect(syncService.syncNow()).rejects.toThrow('Cannot sync while offline');
      } finally {
        syncService.destroy();
        // Reset to online for other tests
        Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      }
    });

    it('should transition to idle status when coming back online', async () => {
      const { SyncService } = await import('./SyncService');
      const syncService = new SyncService();
      const mockConvexClient = { mutation: vi.fn(), query: vi.fn() };
      
      try {
        syncService.initialize(mockConvexClient);
        
        // Simulate going offline then online
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
        window.dispatchEvent(new Event('offline'));
        expect(syncService.getSyncStatus()).toBe('offline');
        
        // Come back online
        Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
        window.dispatchEvent(new Event('online'));
        
        // Verify status changed to idle
        expect(syncService.getSyncStatus()).toBe('idle');
        expect(syncService.isOnlineStatus()).toBe(true);
      } finally {
        syncService.destroy();
      }
    });

    it('should maintain pending status for records created offline', async () => {
      const { SyncService } = await import('./SyncService');
      const syncService = new SyncService();
      const mockConvexClient = { mutation: vi.fn(), query: vi.fn() };
      
      try {
        // Start offline
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
        syncService.initialize(mockConvexClient);
        
        // Mock database to return pending record
        const { db } = await import('@/db/chemcheck-db');
        const offlineRecord = {
          id: 2,
          full_name: 'Offline Customer',
          sync_status: 'pending' as const,
          local_updated_at: Date.now(),
        };
        vi.mocked(db.customers.get).mockResolvedValue(offlineRecord);
        
        // Check record sync status
        const status = await syncService.getRecordSyncStatus('customers', 2);
        expect(status.status).toBe('pending');
      } finally {
        syncService.destroy();
      }
    });
  });


  /**
   * Task 12.2: Test conflict resolution
   * Modify same record on two devices, verify resolution
   */
  describe('12.2 Conflict Resolution', () => {
    it('should detect conflict when same record modified locally and remotely', () => {
      const localRecord: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 2000,
        remote_updated_at: 1000,
      };
      
      const remoteRecord: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1500,
        remote_updated_at: 1800,
      };
      
      const hasConflict = conflictResolver.detectConflict(localRecord, remoteRecord);
      expect(hasConflict).toBe(true);
    });

    it('should resolve conflict using last-write-wins strategy - local wins', () => {
      const localRecord: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 3000,
        remote_updated_at: 1000,
      };
      
      const remoteRecord: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 2000,
        remote_updated_at: 2500,
      };
      
      const result = conflictResolver.resolve(localRecord, remoteRecord);
      
      expect(result.hadConflict).toBe(true);
      expect(result.backupCreated).toBe(true);
      expect(result.resolved.local_updated_at).toBe(3000);
    });

    it('should resolve conflict using last-write-wins strategy - remote wins', () => {
      const localRecord: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 1500,
        remote_updated_at: 1000,
      };
      
      const remoteRecord: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 2000,
        remote_updated_at: 3000,
      };
      
      const result = conflictResolver.resolve(localRecord, remoteRecord);
      
      expect(result.hadConflict).toBe(true);
      expect(result.backupCreated).toBe(true);
      expect(result.resolved.local_updated_at).toBe(3000);
    });

    it('should create backup of local version before conflict resolution', () => {
      const localRecord: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 2000,
        remote_updated_at: 1000,
      };
      
      const remoteRecord: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1500,
        remote_updated_at: 1800,
      };
      
      const result = conflictResolver.resolve(localRecord, remoteRecord);
      
      expect(result.backupCreated).toBe(true);
      expect(localRecord.conflict_backup).toBeDefined();
      
      const backup = conflictResolver.parseBackup(localRecord.conflict_backup!);
      expect(backup).toBeDefined();
      expect(backup!.data.sync_status).toBe('pending');
      expect(backup!.data.local_updated_at).toBe(2000);
    });

    it('should provide conflict info for debugging', () => {
      const localRecord: SyncableRecord = {
        sync_status: 'pending',
        local_updated_at: 2000,
        remote_updated_at: 1000,
      };
      
      const remoteRecord: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1500,
        remote_updated_at: 1800,
      };
      
      const conflictInfo = conflictResolver.getConflictInfo(localRecord, remoteRecord);
      
      expect(conflictInfo).toBeDefined();
      expect(conflictInfo!.localTimestamp).toBe(2000);
      expect(conflictInfo!.remoteTimestamp).toBe(1800);
      expect(Array.isArray(conflictInfo!.conflictedFields)).toBe(true);
    });

    it('should not detect conflict when no modifications since last sync', () => {
      const localRecord: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1000,
        remote_updated_at: 1500,
      };
      
      const remoteRecord: SyncableRecord = {
        sync_status: 'synced',
        local_updated_at: 1000,
        remote_updated_at: 2000,
      };
      
      const hasConflict = conflictResolver.detectConflict(localRecord, remoteRecord);
      expect(hasConflict).toBe(false);
    });
  });


  /**
   * Task 12.3: Test migration flow
   * Verify existing data migrates correctly
   */
  describe('12.3 Migration Flow', () => {
    it('should detect migration requirement when unsynced records exist', async () => {
      const { MigrationService } = await import('./MigrationService');
      const migrationService = new MigrationService();
      const mockConvexClient = { mutation: vi.fn(), query: vi.fn() };
      
      try {
        migrationService.initialize(mockConvexClient);
        
        const { db } = await import('@/db/chemcheck-db');
        vi.mocked(db.customers.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(5),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        } as any);
        vi.mocked(db.serviceLogs.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(10),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        } as any);
        vi.mocked(db.chemicalUsage.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(3),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        } as any);
        vi.mocked(db.notes.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(2),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        } as any);
        
        const isRequired = await migrationService.checkMigrationRequired();
        expect(isRequired).toBe(true);
        
        const status = migrationService.getMigrationStatus();
        expect(status.isRequired).toBe(true);
        expect(status.totalRecords).toBe(20);
      } finally {
        migrationService.destroy();
      }
    });

    it('should not require migration when all records are synced', async () => {
      const { MigrationService } = await import('./MigrationService');
      const migrationService = new MigrationService();
      const mockConvexClient = { mutation: vi.fn(), query: vi.fn() };
      
      try {
        migrationService.initialize(mockConvexClient);
        
        const { db } = await import('@/db/chemcheck-db');
        vi.mocked(db.customers.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(5),
          }),
        } as any);
        vi.mocked(db.serviceLogs.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(10),
          }),
        } as any);
        vi.mocked(db.chemicalUsage.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(3),
          }),
        } as any);
        vi.mocked(db.notes.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(2),
          }),
        } as any);
        
        const isRequired = await migrationService.checkMigrationRequired();
        expect(isRequired).toBe(false);
      } finally {
        migrationService.destroy();
      }
    });


    it('should track migration progress', async () => {
      const { MigrationService } = await import('./MigrationService');
      const migrationService = new MigrationService();
      const mockConvexClient = { mutation: vi.fn(), query: vi.fn() };
      
      try {
        migrationService.initialize(mockConvexClient);
        
        const status = migrationService.getMigrationStatus();
        expect(status).toHaveProperty('isRequired');
        expect(status).toHaveProperty('totalRecords');
        expect(status).toHaveProperty('migratedRecords');
        expect(status).toHaveProperty('progress');
        expect(status).toHaveProperty('isComplete');
      } finally {
        migrationService.destroy();
      }
    });

    it('should verify data integrity after migration', async () => {
      const { MigrationService } = await import('./MigrationService');
      const migrationService = new MigrationService();
      const mockConvexClient = { mutation: vi.fn(), query: vi.fn() };
      
      try {
        migrationService.initialize(mockConvexClient);
        
        const { db } = await import('@/db/chemcheck-db');
        vi.mocked(db.customers.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(5),
          }),
        } as any);
        vi.mocked(db.customers.count).mockResolvedValue(5);
        
        vi.mocked(db.serviceLogs.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(10),
          }),
        } as any);
        vi.mocked(db.serviceLogs.count).mockResolvedValue(10);
        
        vi.mocked(db.chemicalUsage.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(3),
          }),
        } as any);
        vi.mocked(db.chemicalUsage.count).mockResolvedValue(3);
        
        vi.mocked(db.notes.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(2),
          }),
        } as any);
        vi.mocked(db.notes.count).mockResolvedValue(2);
        
        const result = await migrationService.verifyDataIntegrity();
        
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('discrepancies');
        expect(Array.isArray(result.discrepancies)).toBe(true);
      } finally {
        migrationService.destroy();
      }
    });

    it('should throw error when starting migration without initialization', async () => {
      const { MigrationService } = await import('./MigrationService');
      const uninitializedService = new MigrationService();
      
      try {
        await expect(uninitializedService.startMigration()).rejects.toThrow(
          'MigrationService not initialized'
        );
      } finally {
        uninitializedService.destroy();
      }
    });

    it('should handle empty database migration gracefully', async () => {
      const { MigrationService } = await import('./MigrationService');
      const migrationService = new MigrationService();
      const mockConvexClient = { mutation: vi.fn(), query: vi.fn() };
      
      try {
        migrationService.initialize(mockConvexClient);
        
        const { db } = await import('@/db/chemcheck-db');
        vi.mocked(db.customers.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        } as any);
        vi.mocked(db.serviceLogs.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        } as any);
        vi.mocked(db.chemicalUsage.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        } as any);
        vi.mocked(db.notes.where).mockReturnValue({
          notEqual: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          equals: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        } as any);
        
        const isRequired = await migrationService.checkMigrationRequired();
        expect(isRequired).toBe(false);
        
        const result = await migrationService.startMigration();
        expect(result.success).toBe(true);
        expect(result.totalRecords).toBe(0);
      } finally {
        migrationService.destroy();
      }
    });
  });
});
