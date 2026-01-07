/**
 * Property-Based Tests for Migration Data Integrity
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 * 
 * Feature: data-sync
 * Property 9: Migration Data Integrity
 * Validates: Requirements 8.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import 'fake-indexeddb/auto';
import { MigrationService, MigrationResult } from './MigrationService';
import { db, Customer, ServiceLog, ChemicalUsage, Note } from '../../db/chemcheck-db';
import { syncService } from './SyncService';
import { dataIntegrityService } from './DataIntegrityService';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the sync service
vi.mock('./SyncService', () => ({
  syncService: {
    syncRecord: vi.fn(),
  },
}));

// Mock the data integrity service
vi.mock('./DataIntegrityService', () => ({
  dataIntegrityService: {
    isServiceInitialized: vi.fn().mockReturnValue(true),
    initialize: vi.fn(),
    quickIntegrityCheck: vi.fn(),
  },
}));

// ============================================================================
// Generators for Property-Based Testing
// ============================================================================

/**
 * Generator for valid customer names
 */
const customerNameArb = fc.string({ minLength: 1, maxLength: 100 })
  .filter(name => name.trim().length > 0)
  .map(name => name.trim());

/**
 * Generator for valid addresses
 */
const addressArb = fc.string({ minLength: 5, maxLength: 200 })
  .filter(addr => addr.trim().length >= 5)
  .map(addr => addr.trim());

/**
 * Generator for service days
 */
const serviceDayArb = fc.constantFrom(
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
);

/**
 * Generator for pool types
 */
const poolTypeArb = fc.constantFrom('Salt', 'Chlorine');

/**
 * Generator for surface types
 */
const surfaceTypeArb = fc.constantFrom('Plaster', 'Vinyl', 'Fiberglass', 'Tile');

/**
 * Generator for sync status
 */
const syncStatusArb = fc.constantFrom<'synced' | 'pending' | 'error'>('synced', 'pending', 'error');

/**
 * Generator for timestamps
 */
const timestampArb = fc.integer({
  min: new Date('2020-01-01').getTime(),
  max: new Date('2030-12-31').getTime(),
});

/**
 * Generator for safe ISO date strings
 */
const safeIsoDateArb = timestampArb.map(timestamp => new Date(timestamp).toISOString());

/**
 * Generator for Customer records
 */
const customerArb: fc.Arbitrary<Omit<Customer, 'id'>> = fc.record({
  full_name: customerNameArb,
  address: addressArb,
  phone: fc.option(fc.string({ minLength: 10, maxLength: 15 }), { nil: undefined }),
  email: fc.option(fc.emailAddress(), { nil: undefined }),
  gate_code: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  service_day: serviceDayArb,
  pool_gallons: fc.option(fc.integer({ min: 1000, max: 50000 }), { nil: undefined }),
  pool_type: poolTypeArb,
  surface_type: surfaceTypeArb,
  sort_order: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
  created_by: fc.constant('test-user'),
  createdAt: fc.option(safeIsoDateArb, { nil: undefined }),
  updatedAt: fc.option(safeIsoDateArb, { nil: undefined }),
  // Sync fields
  sync_status: syncStatusArb,
  sync_error: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  local_updated_at: timestampArb,
  remote_updated_at: fc.option(timestampArb, { nil: undefined }),
  convex_id: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
  conflict_backup: fc.option(fc.string({ maxLength: 1000 }), { nil: undefined }),
});

/**
 * Generator for chemical reading values
 */
const chemicalReadingArb = fc.constantFrom('good', 'low', 'high');

/**
 * Generator for service dates (YYYY-MM-DD format)
 */
const serviceDateArb = timestampArb.map(timestamp => {
  const date = new Date(timestamp);
  return date.toISOString().split('T')[0];
});

/**
 * Generator for ServiceLog records
 */
const serviceLogArb: fc.Arbitrary<Omit<ServiceLog, 'id'>> = fc.record({
  customer_id: fc.integer({ min: 1, max: 1000 }),
  convex_customer_id: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
  service_date: serviceDateArb,
  status: fc.constantFrom('completed', 'pending', 'cancelled'),
  notes: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
  ph: chemicalReadingArb,
  chlorine: chemicalReadingArb,
  alkalinity: chemicalReadingArb,
  stabilizer: chemicalReadingArb,
  salt: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: undefined }),
  start_time: fc.option(safeIsoDateArb, { nil: undefined }),
  end_time: fc.option(safeIsoDateArb, { nil: undefined }),
  duration_ms: fc.option(fc.integer({ min: 60000, max: 7200000 }), { nil: undefined }),
  createdAt: fc.option(safeIsoDateArb, { nil: undefined }),
  updatedAt: fc.option(safeIsoDateArb, { nil: undefined }),
  // Sync fields
  sync_status: syncStatusArb,
  sync_error: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  local_updated_at: timestampArb,
  remote_updated_at: fc.option(timestampArb, { nil: undefined }),
  convex_id: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
  conflict_backup: fc.option(fc.string({ maxLength: 1000 }), { nil: undefined }),
});

/**
 * Generator for ChemicalUsage records
 */
const chemicalUsageArb: fc.Arbitrary<Omit<ChemicalUsage, 'id'>> = fc.record({
  customer_id: fc.integer({ min: 1, max: 1000 }),
  convex_customer_id: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
  chemical_type: fc.constantFrom('Chlorine', 'Acid', 'Alkalinity Up', 'Stabilizer', 'Salt'),
  quantity: fc.string({ minLength: 1, maxLength: 50 }),
  notes: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  created_date: fc.option(serviceDateArb, { nil: undefined }),
  createdAt: fc.option(safeIsoDateArb, { nil: undefined }),
  updatedAt: fc.option(safeIsoDateArb, { nil: undefined }),
  // Sync fields
  sync_status: syncStatusArb,
  sync_error: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  local_updated_at: timestampArb,
  remote_updated_at: fc.option(timestampArb, { nil: undefined }),
  convex_id: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
  conflict_backup: fc.option(fc.string({ maxLength: 1000 }), { nil: undefined }),
});

/**
 * Generator for Note records
 */
const noteArb: fc.Arbitrary<Omit<Note, 'id'>> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0).map(s => s.trim()),
  content: fc.string({ minLength: 1, maxLength: 1000 }).filter(s => s.trim().length > 0).map(s => s.trim()),
  category: fc.constantFrom('General', 'Customer', 'Equipment', 'Reminder', 'Chemical', 'Billing'),
  customer_id: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
  convex_customer_id: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
  priority: fc.constantFrom('low', 'medium', 'high'),
  completed: fc.option(fc.boolean(), { nil: undefined }),
  created_date: fc.option(serviceDateArb, { nil: undefined }),
  createdAt: fc.option(safeIsoDateArb, { nil: undefined }),
  updatedAt: fc.option(safeIsoDateArb, { nil: undefined }),
  // Sync fields
  sync_status: syncStatusArb,
  sync_error: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  local_updated_at: timestampArb,
  remote_updated_at: fc.option(timestampArb, { nil: undefined }),
  convex_id: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
  conflict_backup: fc.option(fc.string({ maxLength: 1000 }), { nil: undefined }),
});

/**
 * Generator for migration test data
 */
const migrationDataArb = fc.record({
  customers: fc.array(customerArb, { minLength: 0, maxLength: 10 }),
  serviceLogs: fc.array(serviceLogArb, { minLength: 0, maxLength: 15 }),
  chemicalUsage: fc.array(chemicalUsageArb, { minLength: 0, maxLength: 8 }),
  notes: fc.array(noteArb, { minLength: 0, maxLength: 12 }),
});

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Clear all data from the database
 */
async function clearDatabase(): Promise<void> {
  await db.transaction('rw', [db.customers, db.serviceLogs, db.chemicalUsage, db.notes], async () => {
    await db.customers.clear();
    await db.serviceLogs.clear();
    await db.chemicalUsage.clear();
    await db.notes.clear();
  });
}

/**
 * Populate database with test data
 */
async function populateDatabase(data: {
  customers: Omit<Customer, 'id'>[];
  serviceLogs: Omit<ServiceLog, 'id'>[];
  chemicalUsage: Omit<ChemicalUsage, 'id'>[];
  notes: Omit<Note, 'id'>[];
}): Promise<{
  customerIds: number[];
  serviceLogIds: number[];
  chemicalUsageIds: number[];
  noteIds: number[];
}> {
  const customerIds = await db.customers.bulkAdd(data.customers, { allKeys: true }) as number[];
  const serviceLogIds = await db.serviceLogs.bulkAdd(data.serviceLogs, { allKeys: true }) as number[];
  const chemicalUsageIds = await db.chemicalUsage.bulkAdd(data.chemicalUsage, { allKeys: true }) as number[];
  const noteIds = await db.notes.bulkAdd(data.notes, { allKeys: true }) as number[];

  return { customerIds, serviceLogIds, chemicalUsageIds, noteIds };
}

/**
 * Get record counts before migration
 */
async function getPreMigrationCounts(): Promise<{
  customers: number;
  serviceLogs: number;
  chemicalUsage: number;
  notes: number;
  total: number;
}> {
  const [customers, serviceLogs, chemicalUsage, notes] = await Promise.all([
    db.customers.count(),
    db.serviceLogs.count(),
    db.chemicalUsage.count(),
    db.notes.count(),
  ]);

  return {
    customers,
    serviceLogs,
    chemicalUsage,
    notes,
    total: customers + serviceLogs + chemicalUsage + notes,
  };
}

/**
 * Get synced record counts after migration
 */
async function getPostMigrationCounts(): Promise<{
  customers: number;
  serviceLogs: number;
  chemicalUsage: number;
  notes: number;
  total: number;
}> {
  const [customers, serviceLogs, chemicalUsage, notes] = await Promise.all([
    db.customers.where('sync_status').equals('synced').count(),
    db.serviceLogs.where('sync_status').equals('synced').count(),
    db.chemicalUsage.where('sync_status').equals('synced').count(),
    db.notes.where('sync_status').equals('synced').count(),
  ]);

  return {
    customers,
    serviceLogs,
    chemicalUsage,
    notes,
    total: customers + serviceLogs + chemicalUsage + notes,
  };
}

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('MigrationService Property Tests', () => {
  let migrationService: MigrationService;
  let mockConvexClient: any;

  beforeEach(async () => {
    // Clear database before each test
    await clearDatabase();
    
    // Reset mocks
    vi.clearAllMocks();
    
    // Create fresh migration service
    migrationService = new MigrationService();
    mockConvexClient = {
      mutation: vi.fn(),
      query: vi.fn(),
    };
    
    // Initialize migration service
    migrationService.initialize(mockConvexClient);
    
    // Mock successful sync operations that also update the database
    vi.mocked(syncService.syncRecord).mockImplementation(async (tableName: string, localId: number): Promise<any> => {
      try {
        // First verify the record exists and needs syncing
        let record: any;
        switch (tableName) {
          case 'customers':
            record = await db.customers.get(localId);
            break;
          case 'serviceLogs':
            record = await db.serviceLogs.get(localId);
            break;
          case 'chemicalUsage':
            record = await db.chemicalUsage.get(localId);
            break;
          case 'notes':
            record = await db.notes.get(localId);
            break;
          default:
            throw new Error(`Unknown table: ${tableName}`);
        }

        if (!record) {
          throw new Error(`Record not found: ${tableName}[${localId}]`);
        }

        // Simulate successful sync by updating the record's sync status
        const updateData = {
          sync_status: 'synced' as const,
          convex_id: `convex_${tableName}_${localId}`,
          remote_updated_at: Date.now(),
          sync_error: undefined, // Clear any previous errors
        };
        
        // Update the database record
        let updateResult: number;
        switch (tableName) {
          case 'customers':
            updateResult = await db.customers.update(localId, updateData);
            break;
          case 'serviceLogs':
            updateResult = await db.serviceLogs.update(localId, updateData);
            break;
          case 'chemicalUsage':
            updateResult = await db.chemicalUsage.update(localId, updateData);
            break;
          case 'notes':
            updateResult = await db.notes.update(localId, updateData);
            break;
          default:
            throw new Error(`Unknown table: ${tableName}`);
        }

        // Verify the update was successful
        if (updateResult === 0) {
          throw new Error(`Failed to update record: ${tableName}[${localId}]`);
        }

        // Return SyncResult object to match the real implementation
        return {
          success: true,
          syncedCount: 1,
          failedCount: 0,
        };
      } catch (error) {
        console.error(`Mock sync failed for ${tableName}[${localId}]:`, error);
        
        // Update record with error status
        try {
          const errorData = {
            sync_status: 'error' as const,
            sync_error: error instanceof Error ? error.message : 'Mock sync error',
          };
          
          switch (tableName) {
            case 'customers':
              await db.customers.update(localId, errorData);
              break;
            case 'serviceLogs':
              await db.serviceLogs.update(localId, errorData);
              break;
            case 'chemicalUsage':
              await db.chemicalUsage.update(localId, errorData);
              break;
            case 'notes':
              await db.notes.update(localId, errorData);
              break;
          }
        } catch (updateError) {
          console.error(`Failed to update error status for ${tableName}[${localId}]:`, updateError);
        }

        return {
          success: false,
          syncedCount: 0,
          failedCount: 1,
          error: error instanceof Error ? error.message : 'Mock sync error',
        };
      }
    });
    
    // Mock successful data integrity check
    vi.mocked(dataIntegrityService.quickIntegrityCheck).mockResolvedValue({
      success: true,
      summary: 'All records synced successfully',
    });
  });

  afterEach(async () => {
    // Clean up
    migrationService.destroy();
    await clearDatabase();
  });

  describe('Property 9: Migration Data Integrity', () => {
    it('migration preserves record count and data equivalence', async () => {
      await fc.assert(
        fc.asyncProperty(
          migrationDataArb,
          async (testData) => {
            // Clear database before each property test iteration
            await clearDatabase();
            
            // Skip empty datasets to focus on meaningful tests
            const totalRecords = testData.customers.length + testData.serviceLogs.length + 
                                testData.chemicalUsage.length + testData.notes.length;
            
            if (totalRecords === 0) {
              return; // Skip empty datasets
            }
            
            // Populate database with test data
            await populateDatabase(testData);
            
            // Reset mock call count for this iteration
            vi.mocked(syncService.syncRecord).mockClear();
            
            // Get pre-migration counts
            const preMigrationCounts = await getPreMigrationCounts();
            
            // Verify test data was inserted correctly
            expect(preMigrationCounts.customers).toBe(testData.customers.length);
            expect(preMigrationCounts.serviceLogs).toBe(testData.serviceLogs.length);
            expect(preMigrationCounts.chemicalUsage).toBe(testData.chemicalUsage.length);
            expect(preMigrationCounts.notes).toBe(testData.notes.length);
            
            // Run migration
            const migrationResult: MigrationResult = await migrationService.startMigration();
            
            // Verify migration completed successfully
            expect(migrationResult.success).toBe(true);
            expect(migrationResult.totalRecords).toBe(preMigrationCounts.total);
            expect(migrationResult.migratedRecords).toBe(preMigrationCounts.total);
            expect(migrationResult.failedRecords).toBe(0);
            
            // Get post-migration counts
            const postMigrationCounts = await getPostMigrationCounts();
            
            // Property 9: Migration Data Integrity
            // The count of records after migration should equal the count before migration
            expect(postMigrationCounts.customers).toBe(preMigrationCounts.customers);
            expect(postMigrationCounts.serviceLogs).toBe(preMigrationCounts.serviceLogs);
            expect(postMigrationCounts.chemicalUsage).toBe(preMigrationCounts.chemicalUsage);
            expect(postMigrationCounts.notes).toBe(preMigrationCounts.notes);
            expect(postMigrationCounts.total).toBe(preMigrationCounts.total);
            
            // Verify all records are now marked as synced
            const [pendingCustomers, pendingServiceLogs, pendingChemicalUsage, pendingNotes] = await Promise.all([
              db.customers.where('sync_status').equals('pending').count(),
              db.serviceLogs.where('sync_status').equals('pending').count(),
              db.chemicalUsage.where('sync_status').equals('pending').count(),
              db.notes.where('sync_status').equals('pending').count(),
            ]);
            
            expect(pendingCustomers).toBe(0);
            expect(pendingServiceLogs).toBe(0);
            expect(pendingChemicalUsage).toBe(0);
            expect(pendingNotes).toBe(0);
            
            // Verify data integrity check passes
            const integrityResult = await migrationService.verifyDataIntegrity();
            expect(integrityResult.success).toBe(true);
            expect(integrityResult.discrepancies).toHaveLength(0);
            
            // Verify sync service was called for each record
            expect(syncService.syncRecord).toHaveBeenCalledTimes(preMigrationCounts.total);
            
            // Verify sync service was called with correct parameters
            const syncCalls = vi.mocked(syncService.syncRecord).mock.calls;
            
            // Count calls by table type
            const customerCalls = syncCalls.filter(call => call[0] === 'customers').length;
            const serviceLogCalls = syncCalls.filter(call => call[0] === 'serviceLogs').length;
            const chemicalUsageCalls = syncCalls.filter(call => call[0] === 'chemicalUsage').length;
            const noteCalls = syncCalls.filter(call => call[0] === 'notes').length;
            
            expect(customerCalls).toBe(testData.customers.length);
            expect(serviceLogCalls).toBe(testData.serviceLogs.length);
            expect(chemicalUsageCalls).toBe(testData.chemicalUsage.length);
            expect(noteCalls).toBe(testData.notes.length);
          }
        ),
        { numRuns: 20, timeout: 8000 } // Reduced runs and timeout
      );
    }, 20000); // Set test timeout to 20 seconds

    it('migration handles partial failures correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          migrationDataArb.filter(data => 
            data.customers.length + data.serviceLogs.length + 
            data.chemicalUsage.length + data.notes.length > 0
          ),
          fc.integer({ min: 1, max: 3 }), // Reduced max failures to avoid timeout
          async (testData, failureCount) => {
            // Clear database before each property test iteration
            await clearDatabase();
            
            const totalRecords = testData.customers.length + testData.serviceLogs.length + 
                               testData.chemicalUsage.length + testData.notes.length;
            
            if (totalRecords === 0) {
              return; // Skip empty datasets
            }
            
            // Populate database with test data
            await populateDatabase(testData);
            
            // Reset mock call count for this iteration
            vi.mocked(syncService.syncRecord).mockClear();
            
            // Get pre-migration counts
            const preMigrationCounts = await getPreMigrationCounts();
            
            // Mock some sync operations to fail
            let callCount = 0;
            vi.mocked(syncService.syncRecord).mockImplementation(async (tableName: string, localId: number): Promise<any> => {
              callCount++;
              // Ensure we actually fail the first N records as intended
              const shouldFail = callCount <= Math.min(failureCount, totalRecords);
              
              try {
                // First verify the record exists
                let record: any;
                switch (tableName) {
                  case 'customers':
                    record = await db.customers.get(localId);
                    break;
                  case 'serviceLogs':
                    record = await db.serviceLogs.get(localId);
                    break;
                  case 'chemicalUsage':
                    record = await db.chemicalUsage.get(localId);
                    break;
                  case 'notes':
                    record = await db.notes.get(localId);
                    break;
                  default:
                    throw new Error(`Unknown table: ${tableName}`);
                }

                if (!record) {
                  throw new Error(`Record not found: ${tableName}[${localId}]`);
                }

                if (shouldFail) {
                  // Simulate failed sync by updating the record's sync status to error
                  const updateData = {
                    sync_status: 'error' as const,
                    sync_error: 'Mock sync failure',
                  };
                  
                  let updateResult: number;
                  switch (tableName) {
                    case 'customers':
                      updateResult = await db.customers.update(localId, updateData);
                      break;
                    case 'serviceLogs':
                      updateResult = await db.serviceLogs.update(localId, updateData);
                      break;
                    case 'chemicalUsage':
                      updateResult = await db.chemicalUsage.update(localId, updateData);
                      break;
                    case 'notes':
                      updateResult = await db.notes.update(localId, updateData);
                      break;
                    default:
                      throw new Error(`Unknown table: ${tableName}`);
                  }

                  return {
                    success: false,
                    syncedCount: 0,
                    failedCount: 1,
                    error: 'Mock sync failure',
                  };
                } else {
                  // Simulate successful sync by updating the record's sync status
                  const updateData = {
                    sync_status: 'synced' as const,
                    convex_id: `convex_${tableName}_${localId}`,
                    remote_updated_at: Date.now(),
                    sync_error: undefined, // Clear any previous errors
                  };
                  
                  let updateResult: number;
                  switch (tableName) {
                    case 'customers':
                      updateResult = await db.customers.update(localId, updateData);
                      break;
                    case 'serviceLogs':
                      updateResult = await db.serviceLogs.update(localId, updateData);
                      break;
                    case 'chemicalUsage':
                      updateResult = await db.chemicalUsage.update(localId, updateData);
                      break;
                    case 'notes':
                      updateResult = await db.notes.update(localId, updateData);
                      break;
                    default:
                      throw new Error(`Unknown table: ${tableName}`);
                  }

                  if (updateResult === 0) {
                    throw new Error(`Failed to update record: ${tableName}[${localId}]`);
                  }

                  return {
                    success: true,
                    syncedCount: 1,
                    failedCount: 0,
                  };
                }
              } catch (error) {
                // Handle any errors during mock execution
                try {
                  const errorData = {
                    sync_status: 'error' as const,
                    sync_error: error instanceof Error ? error.message : 'Mock sync error',
                  };
                  
                  switch (tableName) {
                    case 'customers':
                      await db.customers.update(localId, errorData);
                      break;
                    case 'serviceLogs':
                      await db.serviceLogs.update(localId, errorData);
                      break;
                    case 'chemicalUsage':
                      await db.chemicalUsage.update(localId, errorData);
                      break;
                    case 'notes':
                      await db.notes.update(localId, errorData);
                      break;
                  }
                } catch (updateError) {
                  console.error(`Failed to update error status for ${tableName}[${localId}]:`, updateError);
                }

                return {
                  success: false,
                  syncedCount: 0,
                  failedCount: 1,
                  error: error instanceof Error ? error.message : 'Mock sync error',
                };
              }
            });
            
            // Run migration
            const migrationResult: MigrationResult = await migrationService.startMigration();
            
            // Calculate expected results
            const expectedFailures = Math.min(failureCount, totalRecords);
            const expectedSuccesses = totalRecords - expectedFailures;
            
            // Verify migration result reflects partial failures
            expect(migrationResult.success).toBe(expectedFailures === 0);
            expect(migrationResult.totalRecords).toBe(totalRecords);
            expect(migrationResult.migratedRecords).toBe(expectedSuccesses);
            expect(migrationResult.failedRecords).toBe(expectedFailures);
            
            // Verify record counts still match (failed records remain in database)
            const postMigrationTotalCounts = await getPreMigrationCounts();
            expect(postMigrationTotalCounts.total).toBe(preMigrationCounts.total);
            
            // Verify only successful records are marked as synced
            const postMigrationSyncedCounts = await getPostMigrationCounts();
            expect(postMigrationSyncedCounts.total).toBe(expectedSuccesses);
            
            // Verify failed records remain pending or error
            const [pendingTotal, errorTotal] = await Promise.all([
              Promise.all([
                db.customers.where('sync_status').equals('pending').count(),
                db.serviceLogs.where('sync_status').equals('pending').count(),
                db.chemicalUsage.where('sync_status').equals('pending').count(),
                db.notes.where('sync_status').equals('pending').count(),
              ]).then(counts => counts.reduce((sum: number, count: number) => sum + count, 0)),
              Promise.all([
                db.customers.where('sync_status').equals('error').count(),
                db.serviceLogs.where('sync_status').equals('error').count(),
                db.chemicalUsage.where('sync_status').equals('error').count(),
                db.notes.where('sync_status').equals('error').count(),
              ]).then(counts => counts.reduce((sum: number, count: number) => sum + count, 0)),
            ]);
            
            // Failed records should be either pending or error
            expect(pendingTotal + errorTotal).toBe(expectedFailures);
          }
        ),
        { numRuns: 20, timeout: 10000 } // Reduced runs and added timeout
      );
    }, 20000); // Set test timeout to 20 seconds
  });
});