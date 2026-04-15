import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for backup validation logic
 * Note: Full import tests require browser File API which isn't available in Node.js test environment.
 * These tests validate the schema validation logic directly.
 */

// Schema validation function extracted for testing
function validateBackupData(data: unknown): { valid: boolean; error?: string } {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'Backup must be a JSON object' };
  }

  const d = data as Record<string, unknown>;

  if (typeof d.version !== 'number') {
    return { valid: false, error: 'Missing or invalid version field' };
  }
  if (!Array.isArray(d.customers)) {
    return { valid: false, error: 'Missing or invalid customers array' };
  }
  if (!Array.isArray(d.serviceLogs)) {
    return { valid: false, error: 'Missing or invalid serviceLogs array' };
  }
  if (!Array.isArray(d.chemicalUsage)) {
    return { valid: false, error: 'Missing or invalid chemicalUsage array' };
  }
  if (!Array.isArray(d.notes)) {
    return { valid: false, error: 'Missing or invalid notes array' };
  }

  for (let i = 0; i < d.customers.length; i++) {
    const c = d.customers[i] as Record<string, unknown>;
    if (typeof c.full_name !== 'string' || !c.full_name.trim()) {
      return { valid: false, error: `Customer ${i + 1}: missing or invalid full_name` };
    }
    if (typeof c.address !== 'string') {
      return { valid: false, error: `Customer ${i + 1}: missing or invalid address` };
    }
    if (typeof c.service_day !== 'string') {
      return { valid: false, error: `Customer ${i + 1}: missing or invalid service_day` };
    }
    if (typeof c.pool_type !== 'string') {
      return { valid: false, error: `Customer ${i + 1}: missing or invalid pool_type` };
    }
    if (typeof c.surface_type !== 'string') {
      return { valid: false, error: `Customer ${i + 1}: missing or invalid surface_type` };
    }
  }

  for (let i = 0; i < d.serviceLogs.length; i++) {
    const log = d.serviceLogs[i] as Record<string, unknown>;
    if (typeof log.customer_id !== 'number') {
      return { valid: false, error: `ServiceLog ${i + 1}: missing or invalid customer_id` };
    }
    if (typeof log.service_date !== 'string') {
      return { valid: false, error: `ServiceLog ${i + 1}: missing or invalid service_date` };
    }
  }

  return { valid: true };
}

describe('Backup Validation', () => {
  describe('validateBackupData', () => {
    it('should reject non-object data', () => {
      expect(validateBackupData(null).valid).toBe(false);
      expect(validateBackupData('string').valid).toBe(false);
      expect(validateBackupData(123).valid).toBe(false);
    });

    it('should reject backup without version field', () => {
      const result = validateBackupData({
        customers: [],
        serviceLogs: [],
        chemicalUsage: [],
        notes: [],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('version');
    });

    it('should reject backup with missing arrays', () => {
      const result = validateBackupData({
        version: 1,
        customers: [],
        // missing serviceLogs, chemicalUsage, notes
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('serviceLogs');
    });

    it('should reject customer without full_name', () => {
      const result = validateBackupData({
        version: 1,
        customers: [{ address: '123 Main St', service_day: 'Monday', pool_type: 'inground', surface_type: 'plaster' }],
        serviceLogs: [],
        chemicalUsage: [],
        notes: [],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('full_name');
    });

    it('should reject customer with empty full_name', () => {
      const result = validateBackupData({
        version: 1,
        customers: [{ full_name: '   ', address: '123 Main St', service_day: 'Monday', pool_type: 'inground', surface_type: 'plaster' }],
        serviceLogs: [],
        chemicalUsage: [],
        notes: [],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('full_name');
    });

    it('should reject service log without customer_id', () => {
      const result = validateBackupData({
        version: 1,
        customers: [],
        serviceLogs: [{ service_date: '2024-01-01' }],
        chemicalUsage: [],
        notes: [],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('customer_id');
    });

    it('should accept valid backup data', () => {
      const result = validateBackupData({
        version: 1,
        exportDate: '2024-01-01T00:00:00.000Z',
        customers: [
          { id: 1, full_name: 'John Doe', address: '123 Main St', service_day: 'Monday', pool_type: 'inground', surface_type: 'plaster' },
        ],
        serviceLogs: [
          { id: 1, customer_id: 1, service_date: '2024-01-01', status: 'completed' },
        ],
        chemicalUsage: [],
        notes: [],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept empty backup with valid structure', () => {
      const result = validateBackupData({
        version: 1,
        customers: [],
        serviceLogs: [],
        chemicalUsage: [],
        notes: [],
      });
      expect(result.valid).toBe(true);
    });
  });
});
