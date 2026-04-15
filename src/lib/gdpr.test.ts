import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exportUserData, deleteAllUserData, getDataRetentionSummary } from './gdpr';

// Mock the database
vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: {
      toArray: vi.fn(),
      count: vi.fn(),
      clear: vi.fn(),
    },
    serviceLogs: {
      toArray: vi.fn(),
      count: vi.fn(),
      clear: vi.fn(),
    },
    chemicalUsage: {
      toArray: vi.fn(),
      count: vi.fn(),
      clear: vi.fn(),
    },
    notes: {
      toArray: vi.fn(),
      count: vi.fn(),
      clear: vi.fn(),
    },
    transaction: vi.fn((mode, tables, callback) => callback()),
  },
}));

// Import the mocked db
import { db } from '@/db/chemcheck-db';

describe('GDPR Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exportUserData', () => {
    it('should export all user data in GDPR-compliant format', async () => {
      const mockCustomers = [{ id: 1, full_name: 'Test Customer' }];
      const mockServiceLogs = [{ id: 1, customer_id: 1, service_date: '2024-01-01' }];
      const mockChemicalUsage = [{ id: 1, customer_id: 1, chemical_type: 'chlorine' }];
      const mockNotes = [{ id: 1, title: 'Test Note' }];

      vi.mocked(db.customers.toArray).mockResolvedValue(mockCustomers as never);
      vi.mocked(db.serviceLogs.toArray).mockResolvedValue(mockServiceLogs as never);
      vi.mocked(db.chemicalUsage.toArray).mockResolvedValue(mockChemicalUsage as never);
      vi.mocked(db.notes.toArray).mockResolvedValue(mockNotes as never);

      const result = await exportUserData();

      expect(result.exportType).toBe('gdpr_data_request');
      expect(result.metadata.gdprCompliant).toBe(true);
      expect(result.metadata.totalRecords).toBe(4);
      expect(result.userData.customers).toEqual(mockCustomers);
      expect(result.userData.serviceLogs).toEqual(mockServiceLogs);
      expect(result.userData.chemicalUsage).toEqual(mockChemicalUsage);
      expect(result.userData.notes).toEqual(mockNotes);
      expect(result.exportDate).toBeDefined();
    });

    it('should handle empty data', async () => {
      vi.mocked(db.customers.toArray).mockResolvedValue([]);
      vi.mocked(db.serviceLogs.toArray).mockResolvedValue([]);
      vi.mocked(db.chemicalUsage.toArray).mockResolvedValue([]);
      vi.mocked(db.notes.toArray).mockResolvedValue([]);

      const result = await exportUserData();

      expect(result.metadata.totalRecords).toBe(0);
      expect(result.userData.customers).toEqual([]);
    });
  });

  describe('deleteAllUserData', () => {
    it('should delete all user data and return counts', async () => {
      vi.mocked(db.customers.count).mockResolvedValue(5);
      vi.mocked(db.serviceLogs.count).mockResolvedValue(20);
      vi.mocked(db.chemicalUsage.count).mockResolvedValue(10);
      vi.mocked(db.notes.count).mockResolvedValue(3);

      const result = await deleteAllUserData();

      expect(result.success).toBe(true);
      expect(result.deleted.customers).toBe(5);
      expect(result.deleted.serviceLogs).toBe(20);
      expect(result.deleted.chemicalUsage).toBe(10);
      expect(result.deleted.notes).toBe(3);
      
      // Verify clear was called on all tables
      expect(db.customers.clear).toHaveBeenCalled();
      expect(db.serviceLogs.clear).toHaveBeenCalled();
      expect(db.chemicalUsage.clear).toHaveBeenCalled();
      expect(db.notes.clear).toHaveBeenCalled();
    });
  });

  describe('getDataRetentionSummary', () => {
    it('should return data retention summary with counts', async () => {
      const now = Date.now();
      const mockCustomers = [
        { id: 1, full_name: 'Test', createdAt: now - 86400000 },
        { id: 2, full_name: 'Test 2', createdAt: now },
      ];

      vi.mocked(db.customers.toArray).mockResolvedValue(mockCustomers as never);
      vi.mocked(db.serviceLogs.toArray).mockResolvedValue([]);
      vi.mocked(db.chemicalUsage.toArray).mockResolvedValue([]);
      vi.mocked(db.notes.toArray).mockResolvedValue([]);

      const result = await getDataRetentionSummary();

      expect(result.dataTypes).toHaveLength(4);
      expect(result.dataTypes[0].type).toBe('Customers');
      expect(result.dataTypes[0].count).toBe(2);
      expect(result.dataTypes[0].oldestRecord).toBeDefined();
      expect(result.dataTypes[0].newestRecord).toBeDefined();
    });

    it('should handle empty tables', async () => {
      vi.mocked(db.customers.toArray).mockResolvedValue([]);
      vi.mocked(db.serviceLogs.toArray).mockResolvedValue([]);
      vi.mocked(db.chemicalUsage.toArray).mockResolvedValue([]);
      vi.mocked(db.notes.toArray).mockResolvedValue([]);

      const result = await getDataRetentionSummary();

      expect(result.dataTypes[0].count).toBe(0);
      expect(result.dataTypes[0].oldestRecord).toBeNull();
    });
  });
});
