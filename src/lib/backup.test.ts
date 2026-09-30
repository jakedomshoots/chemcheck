import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the database - must be before imports that use it
const mockTable = vi.hoisted(() => () => ({
  toArray: vi.fn(),
  add: vi.fn(),
  clear: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
}));

vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: mockTable(),
    serviceLogs: mockTable(),
    chemicalUsage: mockTable(),
    notes: mockTable(),
    pools: mockTable(),
    equipment: mockTable(),
    saltCellLogs: mockTable(),
    transaction: vi.fn((_mode: string, _tables: unknown[], callback: () => void) => callback())
  }
}));

import {
  createBackup,
  restoreFromBackup,
  AutoBackup,
  getEmergencyBackupKey,
  getLastAutoBackupKey,
  isForeignBackup,
  stripSensitiveCustomerFields,
} from './backup';
import { db } from '../db/chemcheck-db';

const noMatch = () => ({ equals: () => ({ first: async () => undefined }) });

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
    vi.mocked(db.pools.toArray).mockResolvedValue([]);
    vi.mocked(db.equipment.toArray).mockResolvedValue([]);
    vi.mocked(db.saltCellLogs.toArray).mockResolvedValue([]);
    for (const table of [db.customers, db.serviceLogs, db.chemicalUsage, db.notes, db.pools, db.equipment, db.saltCellLogs]) {
      vi.mocked(table.where).mockImplementation(noMatch as never);
    }
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
      const result = await restoreFromBackup(validBackup as never);
      
      expect(result.success).toBe(true);
      expect(result.imported.customers).toBe(1);
      expect(result.imported.serviceLogs).toBe(1);
      expect(result.imported.chemicalUsage).toBe(1);
      expect(result.imported.notes).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('should clear existing data when requested', async () => {
      await restoreFromBackup(validBackup as never, { clearExisting: true });
      
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
      
      const result = await restoreFromBackup(validBackup as never);
      
      expect(result.success).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(err => err.includes('customer') && err.includes('not found'))).toBe(true);
    });

    it('should handle database errors during restore', async () => {
      vi.mocked(db.customers.add).mockRejectedValue(new Error('Database error'));
      
      const result = await restoreFromBackup(validBackup as never);
      
      expect(result.success).toBe(true); // Should continue despite errors
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.imported.customers).toBe(0);
    });

    it('should map customer IDs correctly', async () => {
      vi.mocked(db.customers.add).mockResolvedValue(99); // New ID
      
      await restoreFromBackup(validBackup as never);
      
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
      
      expect(localStorage.getItem(getEmergencyBackupKey())).not.toBeNull();
      expect(localStorage.getItem(getLastAutoBackupKey())).not.toBeNull();
      expect(localStorage.getItem('emergencyBackup')).toBeNull();
      
      consoleSpy.mockRestore();
    });

    it('should not backup if recent backup exists', () => {
      const now = new Date().toISOString();
      localStorage.setItem(getLastAutoBackupKey(), now);
      
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

  describe('ownership and privacy', () => {
    const signIn = (email: string) => {
      localStorage.setItem('chemcheck_current_user', JSON.stringify({ email, name: 'Tech' }));
    };

    const backupFrom = (exportedBy: string, customers = mockCustomers) => ({
      version: '1.0',
      timestamp: '2024-12-13T10:00:00.000Z',
      appVersion: '1.0.0',
      data: { customers, serviceLogs: [], chemicalUsage: [], notes: [] },
      metadata: { totalRecords: customers.length, exportedBy, deviceInfo: 'test' },
    });

    beforeEach(() => {
      vi.mocked(db.customers.add).mockResolvedValue(1);
      vi.mocked(db.customers.get).mockResolvedValue(mockCustomers[0]);
    });

    it('records the signed-in user as the backup owner', async () => {
      signIn('Tech@Example.com');
      const backup = await createBackup();
      expect(backup.metadata.exportedBy).toBe('tech@example.com');
      expect(backup.data.pools).toEqual([]);
      expect(backup.data.equipment).toEqual([]);
      expect(backup.data.saltCellLogs).toEqual([]);
    });

    it('scopes the emergency backup key per account and strips gate codes', async () => {
      signIn('tech@example.com');
      vi.mocked(db.customers.toArray).mockResolvedValue([
        { ...mockCustomers[0], gate_code: '1234', phone: '555-0100' },
      ] as never);
      vi.useFakeTimers();
      const autoBackup = new AutoBackup(1);
      autoBackup.start();
      await vi.advanceTimersByTimeAsync(10);
      autoBackup.stop();
      vi.useRealTimers();

      const key = getEmergencyBackupKey();
      expect(key).not.toBe('emergencyBackup');
      expect(key).not.toContain('tech@example.com');
      const stored = JSON.parse(localStorage.getItem(key) || '{}');
      expect(stored.data.customers[0].gate_code).toBeUndefined();
      expect(stored.data.customers[0].phone).toBe('555-0100');
      expect(JSON.stringify(stored)).not.toContain('1234');
      expect(stripSensitiveCustomerFields({ gate_code: 'x', full_name: 'a' })).toEqual({ full_name: 'a' });
    });

    it('refuses to restore a backup exported by a different account', async () => {
      signIn('tech@example.com');
      expect(isForeignBackup(backupFrom('other@example.com') as never)).toBe(true);
      expect(isForeignBackup(backupFrom('local') as never)).toBe(false);
      expect(isForeignBackup(backupFrom('TECH@example.com') as never)).toBe(false);

      const result = await restoreFromBackup(backupFrom('other@example.com') as never);
      expect(result.success).toBe(false);
      expect(result.errors.join(' ')).toMatch(/not the signed-in account/);
      expect(db.customers.add).not.toHaveBeenCalled();
    });

    it('re-owns foreign records and drops cloud ids when allowForeign is set', async () => {
      signIn('tech@example.com');
      const customers = [{ ...mockCustomers[0], created_by: 'other@example.com', convex_id: 'cx_1' }];
      const result = await restoreFromBackup(backupFrom('other@example.com', customers as never) as never, { allowForeign: true });
      expect(result.success).toBe(true);
      expect(db.customers.add).toHaveBeenCalledWith(expect.objectContaining({ created_by: 'tech@example.com' }));
      const added = vi.mocked(db.customers.add).mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(added.convex_id).toBeUndefined();
    });

    it('upserts by convex_id on a same-tenant restore instead of duplicating', async () => {
      signIn('tech@example.com');
      vi.mocked(db.customers.where).mockImplementation((() => ({
        equals: () => ({ first: async () => ({ id: 42, convex_id: 'cx_1' }) }),
      })) as never);
      const customers = [{ ...mockCustomers[0], created_by: 'tech@example.com', convex_id: 'cx_1' }];
      const result = await restoreFromBackup(backupFrom('tech@example.com', customers as never) as never);
      expect(result.success).toBe(true);
      expect(db.customers.update).toHaveBeenCalledWith(42, expect.objectContaining({ convex_id: 'cx_1' }));
      expect(db.customers.add).not.toHaveBeenCalled();
      expect(result.updated).toBe(1);
    });

    it('restores pools and remaps service log pool ids', async () => {
      signIn('tech@example.com');
      vi.mocked(db.customers.add).mockResolvedValue(7);
      vi.mocked(db.pools.add).mockResolvedValue(70);
      vi.mocked(db.serviceLogs.add).mockResolvedValue(1);
      const backup = {
        ...backupFrom('tech@example.com'),
        data: {
          customers: mockCustomers,
          pools: [{ id: 3, customer_id: 1, name: 'Main', service_day: 'Monday', pool_type: 'Chlorine', surface_type: 'Plaster', active: true }],
          serviceLogs: [{ ...mockServiceLogs[0], pool_id: 3 }],
          chemicalUsage: [],
          notes: [],
        },
      };
      const result = await restoreFromBackup(backup as never);
      expect(result.success).toBe(true);
      expect(result.imported.pools).toBe(1);
      expect(db.pools.add).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 7 }));
      expect(db.serviceLogs.add).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 7, pool_id: 70 }));
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