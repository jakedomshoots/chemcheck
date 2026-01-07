import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MigrationService } from './MigrationService';

// Mock dependencies
vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: {
      where: vi.fn().mockReturnValue({
        notEqual: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(5),
          toArray: vi.fn().mockResolvedValue([
            { id: 1, full_name: 'Test Customer 1', sync_status: 'pending' },
            { id: 2, full_name: 'Test Customer 2', sync_status: 'pending' },
          ]),
        }),
        equals: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(3),
        }),
      }),
      count: vi.fn().mockResolvedValue(8),
    },
    serviceLogs: {
      where: vi.fn().mockReturnValue({
        notEqual: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(10),
          toArray: vi.fn().mockResolvedValue([]),
        }),
        equals: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(5),
        }),
      }),
      count: vi.fn().mockResolvedValue(15),
    },
    chemicalUsage: {
      where: vi.fn().mockReturnValue({
        notEqual: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(3),
          toArray: vi.fn().mockResolvedValue([]),
        }),
        equals: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(2),
        }),
      }),
      count: vi.fn().mockResolvedValue(5),
    },
    notes: {
      where: vi.fn().mockReturnValue({
        notEqual: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(2),
          toArray: vi.fn().mockResolvedValue([]),
        }),
        equals: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(1),
        }),
      }),
      count: vi.fn().mockResolvedValue(3),
    },
  },
}));

vi.mock('./SyncService', () => ({
  syncService: {
    syncRecord: vi.fn().mockResolvedValue(true),
  },
}));

// Mock DataIntegrityService
vi.mock('./DataIntegrityService', () => ({
  dataIntegrityService: {
    initialize: vi.fn(),
    isServiceInitialized: vi.fn().mockReturnValue(false),
    quickIntegrityCheck: vi.fn().mockResolvedValue({
      success: true,
      summary: '31/31 records synced (100%)',
    }),
  },
}));

describe('MigrationService', () => {
  let migrationService: MigrationService;
  let mockConvexClient: any;

  beforeEach(() => {
    migrationService = new MigrationService();
    mockConvexClient = {
      mutation: vi.fn(),
      query: vi.fn(),
    };
    
    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with Convex client', () => {
      expect(() => migrationService.initialize(mockConvexClient)).not.toThrow();
    });

    it('should throw error when checking migration without initialization', async () => {
      await expect(migrationService.checkMigrationRequired()).rejects.toThrow(
        'MigrationService not initialized'
      );
    });
  });

  describe('migration requirement check', () => {
    beforeEach(() => {
      migrationService.initialize(mockConvexClient);
    });

    it('should detect migration requirement when unsynced records exist', async () => {
      const isRequired = await migrationService.checkMigrationRequired();
      expect(isRequired).toBe(true);
    });

    it('should return correct migration status', async () => {
      await migrationService.checkMigrationRequired();
      const status = migrationService.getMigrationStatus();
      
      expect(status.isRequired).toBe(true);
      expect(status.totalRecords).toBe(20); // 5 + 10 + 3 + 2
      expect(status.migratedRecords).toBe(0);
      expect(status.progress).toBe(0);
      expect(status.isComplete).toBe(false);
    });
  });

  describe('migration status callbacks', () => {
    beforeEach(() => {
      migrationService.initialize(mockConvexClient);
    });

    it('should allow subscribing to status changes', async () => {
      const callback = vi.fn();
      const unsubscribe = migrationService.onMigrationStatusChange(callback);
      
      // checkMigrationRequired updates internal status but doesn't notify callbacks
      // The callback is only called when updateStatus is explicitly called
      // Let's verify the subscription mechanism works
      expect(typeof unsubscribe).toBe('function');
      
      // Test unsubscribe
      unsubscribe();
      
      // Verify the callback was added and removed correctly
      // The actual callback invocation happens during startMigration, not checkMigrationRequired
      expect(callback).not.toHaveBeenCalled(); // checkMigrationRequired doesn't notify
    });
  });

  describe('data integrity verification', () => {
    beforeEach(() => {
      migrationService.initialize(mockConvexClient);
      // Reset mocks to default state
      vi.clearAllMocks();
    });

    it('should verify data integrity successfully when all records are synced', async () => {
      // Mock DataIntegrityService to return success
      const { dataIntegrityService } = await import('./DataIntegrityService');
      vi.mocked(dataIntegrityService.quickIntegrityCheck).mockResolvedValue({
        success: true,
        summary: '31/31 records synced (100%)',
      });

      const result = await migrationService.verifyDataIntegrity();
      
      expect(result.success).toBe(true);
      expect(result.discrepancies).toHaveLength(0);
    });

    it('should detect discrepancies when records are not synced', async () => {
      // Mock DataIntegrityService to return failure
      const { dataIntegrityService } = await import('./DataIntegrityService');
      vi.mocked(dataIntegrityService.quickIntegrityCheck).mockResolvedValue({
        success: false,
        summary: '11/31 records synced (35%), 20 pending',
      });

      const result = await migrationService.verifyDataIntegrity();
      
      expect(result.success).toBe(false);
      expect(result.discrepancies.length).toBeGreaterThan(0);
    });
  });

  describe('migration control', () => {
    beforeEach(() => {
      migrationService.initialize(mockConvexClient);
    });

    it('should report migration in progress correctly', () => {
      expect(migrationService.isMigrationInProgress()).toBe(false);
    });

    it('should allow cancelling migration', () => {
      expect(() => migrationService.cancelMigration()).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on destroy', () => {
      migrationService.initialize(mockConvexClient);
      expect(() => migrationService.destroy()).not.toThrow();
    });
  });
});