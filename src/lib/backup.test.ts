import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the database - must be before imports that use it
vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: {
      toArray: vi.fn(),
      add: vi.fn(),
      clear: vi.fn(),
      get: vi.fn()
    },
    serviceLogs: {
      toArray: vi.fn(),
      add: vi.fn(),
      clear: vi.fn()
    },
    chemicalUsage: {
      toArray: vi.fn(),
      add: vi.fn(),
      clear: vi.fn()
    },
    notes: {
      toArray: vi.fn(),
      add: vi.fn(),
      clear: vi.fn()
    },
    transaction: vi.fn((_mode: string, _tables: unknown[], callback: () => void) => callback())
  }
}));

import { createBackup, restoreFromBackup, AutoBackup } from './backup';
import { db } from '../db/chemcheck-db';

// Mock data
const mockCustomers = [
  {
    id: 1,
    full_name: 'John Smith',
    address: '123 Main St',
    service_day: 'Monday',
    pool_type: 'Chlorine',
    surface_type: 'Plaster',
    created_by: 'local',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  }
];

const mockServiceLogs = [
  {
    id: 1,
    customer_id: 1,
    service_date: '2024-12-13',
    status: 'completed',
    ph: 'good',
    chlorine: 'good',
    alkalinity: 'good',
    stabilizer: 'good',
    createdAt: '2024-12-13T10:00:00.000Z',
    updatedAt: '2024-12-13T10:00:00.000Z'
  }
];

const mockChemicalUsage = [
  {
    id: 1,
    customer_id: 1,
    chemical_type: 'Chlorine Tablets',
    quantity: '2 lbs',
    created_date: '2024-12-13',
    createdAt: '2024-12-13T10:00:00.000Z',
    updatedAt: '2024-12-13T10:00:00.000Z'
  }
];

const mockNotes = [
  {
    id: 1,
    title: 'Equipment Check',
    content: 'Pool pump needs inspection',
    category: 'Equipment',
    priority: 'high',
    completed: false,
    created_date: '2024-12-13',
    createdAt: '2024-12-13T10:00:00.000Z',
    updatedAt: '2024-12-13T10:00:00.000Z'
  }
];

describe('Backup System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    
    // Setup default mock returns
    vi.mocked(db.customers.toArray).mockResolvedValue(mockCustomers);
    vi.mocked(db.serviceLogs.toArray).mockResolvedValue(mockServiceLogs);
    vi.mocked(db.chemicalUsage.toArray).mockResolvedValue(mockChemicalUsage);
    vi.mocked(db.notes.toArray).mockResolvedValue(mockNotes);
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('createBackup', () => {
    it('should create a complete backup with all data', async () => {
      const backup = await createBackup();
      
      expect(backup.version).toBe('1.0');
      expect(backup.timestamp).toBeDefined();
      expect(backup.data.customers).toEqual(mockCustomers);
      expect(backup.data.serviceLogs).toEqual(mockServiceLogs);
      expect(backup.data.chemicalUsage).toEqual(mockChemicalUsage);
      expect(backup.data.notes).toEqual(mockNotes);
      expect(backup.metadata.totalRecords).toBe(4);
    });

    it('should create selective backup based on options', async () => {
      const backup = await createBackup({
        includeCustomers: true,
        includeServiceLogs: false,
        includeChemicalUsage: false,
        includeNotes: false
      });
      
      expect(backup.data.customers).toEqual(mockCustomers);
      expect(backup.data.serviceLogs).toEqual([]);
      expect(backup.data.chemicalUsage).toEqual([]);
      expect(backup.data.notes).toEqual([]);
      expect(backup.metadata.totalRecords).toBe(1);
    });

    it('should filter by date range', async () => {
      const backup = await createBackup({
        dateRange: {
          start: '2024-12-13',
          end: '2024-12-13'
        }
      });
      
      expect(backup.data.serviceLogs).toEqual(mockServiceLogs);
      expect(backup.data.chemicalUsage).toEqual(mockChemicalUsage);
      expect(backup.data.notes).toEqual(mockNotes);
    });

    it('should handle empty database', async () => {
      vi.mocked(db.customers.toArray).mockResolvedValue([]);
      vi.mocked(db.serviceLogs.toArray).mockResolvedValue([]);
      vi.mocked(db.chemicalUsage.toArray).mockResolvedValue([]);
      vi.mocked(db.notes.toArray).mockResolvedValue([]);
      
      const backup = await createBackup();
      
      expect(backup.data.customers).toEqual([]);
      expect(backup.metadata.totalRecords).toBe(0);
    });

    it('should handle database errors', async () => {
      vi.mocked(db.customers.toArray).mockRejectedValue(new Error('Database error'));
      
      await expect(createBackup()).rejects.toThrow('Failed to create backup');
    });
  });

  describe('restoreFromBackup', () => {
    const validBackup = {
      version: '1.0',
      timestamp: '2024-12-13T10:00:00.000Z',
      appVersion: '1.0.0',
      data: {
        customers: mockCustomers,
        serviceLogs: mockServiceLogs,
        chemicalUsage: mockChemicalUsage,
        notes: mockNotes
      },
      metadata: {
        totalRecords: 4,
        exportedBy: 'local',
        deviceInfo: 'test'
      }
    };

    beforeEach(() => {
      vi.mocked(db.customers.add).mockResolvedValue(1);
      vi.mocked(db.serviceLogs.add).mockResolvedValue(1);
      vi.mocked(db.chemicalUsage.add).mockResolvedValue(1);
      vi.mocked(db.notes.add).mockResolvedValue(1);
      vi.mocked(db.customers.get).mockResolvedValue(mockCustomers[0]);
    });

    it('should restore backup successfully', async () => {
      const result = await restoreFromBackup(validBackup);
      
      expect(result.success).toBe(true);
      expect(result.imported.customers).toBe(1);
      expect(result.imported.serviceLogs).toBe(1);
      expect(result.imported.chemicalUsage).toBe(1);
      expect(result.imported.notes).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('should clear existing data when requested', async () => {
      await restoreFromBackup(validBackup, { clearExisting: true });
      
      expect(db.customers.clear).toHaveBeenCalled();
      expect(db.serviceLogs.clear).toHaveBeenCalled();
      expect(db.chemicalUsage.clear).toHaveBeenCalled();
      expect(db.notes.clear).toHaveBeenCalled();
    });

    it('should handle invalid backup format', async () => {
      const invalidBackup = { invalid: 'data' } as any;
      
      const result = await restoreFromBackup(invalidBackup);
      
      expect(result.success).toBe(false);
      expect(result.errors.some(err => err.includes('Invalid backup format'))).toBe(true);
    });

    it('should handle missing customer references', async () => {
      vi.mocked(db.customers.get).mockResolvedValue(undefined);
      
      const result = await restoreFromBackup(validBackup);
      
      expect(result.success).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(err => err.includes('customer') && err.includes('not found'))).toBe(true);
    });

    it('should handle database errors during restore', async () => {
      vi.mocked(db.customers.add).mockRejectedValue(new Error('Database error'));
      
      const result = await restoreFromBackup(validBackup);
      
      expect(result.success).toBe(true); // Should continue despite errors
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.imported.customers).toBe(0);
    });

    it('should map customer IDs correctly', async () => {
      vi.mocked(db.customers.add).mockResolvedValue(99); // New ID
      
      await restoreFromBackup(validBackup);
      
      // Service log should be added with new customer ID
      expect(db.serviceLogs.add).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_id: 99
        })
      );
    });
  });

  describe('AutoBackup', () => {
    let autoBackup: AutoBackup;

    beforeEach(() => {
      vi.useFakeTimers();
      autoBackup = new AutoBackup(1); // 1 hour for testing
    });

    afterEach(() => {
      autoBackup.stop();
      vi.useRealTimers();
    });

    it('should start and stop correctly', () => {
      expect(autoBackup.getLastBackupTime()).toBeNull();
      
      autoBackup.start();
      expect(autoBackup.getLastBackupTime()).toBeDefined();
      
      autoBackup.stop();
    });

    it('should perform backup on interval', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      autoBackup.start();
      
      // Fast-forward time by 1 hour + 1 second
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1000);
      
      expect(localStorage.getItem('emergencyBackup')).toBeDefined();
      expect(localStorage.getItem('lastAutoBackup')).toBeDefined();
      
      consoleSpy.mockRestore();
    });

    it('should not backup if recent backup exists', () => {
      const now = new Date().toISOString();
      localStorage.setItem('lastAutoBackup', now);
      
      autoBackup = new AutoBackup(24);
      autoBackup.start();
      
      // Should not create new backup immediately
      expect(autoBackup.getLastBackupTime()).toBe(now);
    });

    it('should handle backup errors gracefully', async () => {
      vi.mocked(db.customers.toArray).mockRejectedValue(new Error('Database error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      autoBackup.start();
      
      // Fast-forward time by 1 hour + 1 second
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1000);
      
      expect(consoleSpy).toHaveBeenCalledWith('Auto-backup failed:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });
  });

  describe('Integration Tests', () => {
    it('should create and restore backup maintaining data integrity', async () => {
      // Create backup
      const backup = await createBackup();
      
      // Clear database
      vi.mocked(db.customers.toArray).mockResolvedValue([]);
      vi.mocked(db.serviceLogs.toArray).mockResolvedValue([]);
      vi.mocked(db.chemicalUsage.toArray).mockResolvedValue([]);
      vi.mocked(db.notes.toArray).mockResolvedValue([]);
      
      // Restore backup
      const result = await restoreFromBackup(backup, { clearExisting: true });
      
      expect(result.success).toBe(true);
      expect(result.imported.customers).toBe(1);
      expect(result.imported.serviceLogs).toBe(1);
      expect(result.imported.chemicalUsage).toBe(1);
      expect(result.imported.notes).toBe(1);
    });

    it('should handle large datasets efficiently', async () => {
      // Mock large dataset
      const largeCustomers = Array.from({ length: 1000 }, (_, i) => ({
        ...mockCustomers[0],
        id: i + 1,
        full_name: `Customer ${i + 1}`
      }));
      
      vi.mocked(db.customers.toArray).mockResolvedValue(largeCustomers);
      
      const startTime = performance.now();
      const backup = await createBackup();
      const duration = performance.now() - startTime;
      
      expect(backup.data.customers).toHaveLength(1000);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});