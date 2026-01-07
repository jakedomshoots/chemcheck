# Implementation Plan: Dexie-to-Convex Data Sync

## Overview

This implementation plan covers building a bidirectional sync system between Dexie (local IndexedDB) and Convex (cloud backend). The sync enables offline-first functionality while ensuring data is available in the cloud for SMS/Email report sending.

## Tasks

- [x] 1. Update Dexie Schema with Sync Fields
  - Add sync_status, convex_id, local_updated_at, remote_updated_at fields to all tables
  - Create database migration to add new fields to existing records
  - Set default sync_status to 'pending' for existing records
  - _Requirements: 2.1, 2.3, 4.2_

- [x] 2. Create Convex Sync Mutations
  - [x] 2.1 Create syncCustomer mutation with upsert logic
    - Handle create/update based on existing convex_id
    - Return convex_id for local storage
    - _Requirements: 3.1, 3.2_
  
  - [x] 2.2 Create syncServiceLog mutation with upsert logic
    - Require convex_customer_id reference
    - Handle all service log fields including chemical readings
    - _Requirements: 4.1_
  
  - [x] 2.3 Create syncChemicalUsage mutation
    - Sync chemical usage records
    - _Requirements: 3.1_
  
  - [x] 2.4 Create syncNotes mutation
    - Sync notes records
    - _Requirements: 3.1_

- [-] 3. Implement SyncService Core
  - [x] 3.1 Create SyncService class with initialize/start/stop methods
    - Initialize with Convex client reference
    - Manage sync state and queue
    - _Requirements: 1.1_
  
  - [x] 3.2 Implement SyncQueue manager
    - Enqueue/dequeue operations
    - Track pending, synced, and failed items
    - Persist queue to localStorage for crash recovery
    - _Requirements: 2.1, 2.2_
  
  - [x] 3.3 Implement retry logic with exponential backoff
    - Retry up to 3 times with 1s, 2s, 4s delays
    - Mark as error after max retries
    - _Requirements: 1.5_

  - [x] 3.4 Write property test for retry backoff timing
    - **Property 8: Retry with Exponential Backoff**
    - **Validates: Requirements 1.5**

- [x] 4. Implement Automatic Sync Triggers
  - [x] 4.1 Hook into Dexie table hooks for create/update/delete
    - Automatically enqueue changes when online
    - Set sync_status to 'pending' when offline
    - _Requirements: 1.2, 1.3, 2.1_
  
  - [x] 4.2 Implement online/offline detection
    - Use navigator.onLine and online/offline events
    - Pause sync when offline, resume when online
    - _Requirements: 2.2_
  
  - [ ] 4.3 Write property test for sync trigger on record changes
    - **Property 1: Record Changes Trigger Sync**
    - **Validates: Requirements 1.2, 1.3, 3.1, 3.2, 4.1**

- [x] 5. Implement Sync Execution
  - [x] 5.1 Create syncRecord method for individual records
    - Call appropriate Convex mutation based on table
    - Update local record with convex_id on success
    - Handle errors and update sync_status
    - _Requirements: 2.3, 4.2_
  
  - [x] 5.2 Implement dependency ordering (customers before service logs)
    - Ensure customer is synced before their service logs
    - Map local customer_id to convex_customer_id
    - _Requirements: 4.1_
  
  - [x] 5.3 Write property test for convex_id storage after sync
    - **Property 2: Convex ID Stored After Successful Sync**
    - **Validates: Requirements 2.3, 4.2**
  
  - [x] 5.4 Write property test for no duplicate records
    - **Property 3: No Duplicate Records During Sync**
    - **Validates: Requirements 2.4**

- [x] 6. Implement Conflict Resolution
   - [x] 6.1 Create ConflictResolver class
    - Detect conflicts by comparing timestamps
    - Implement last-write-wins strategy
    - _Requirements: 7.1, 7.2_
  
  - [x] 6.2 Implement conflict backup
    - Store original local version in conflict_backup field
    - Log conflicts for debugging
    - _Requirements: 7.3, 7.4_
  
  - [x] 6.3 Write property test for conflict detection and backup
    - **Property 7: Conflicts Detected and Backed Up**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 7. Create useSyncState React Hook
  - [x] 7.1 Implement hook with sync status, pending count, error state
    - Subscribe to SyncService status changes
    - Provide syncNow function
    - _Requirements: 5.3, 6.1, 6.2_
  
  - [x] 7.2 Add isRecordSynced and getRecordSyncStatus helpers
    - Check sync status for specific records
    - _Requirements: 5.1_

- [x] 8. Implement UI Components
  - [x] 8.1 Create SyncStatusIndicator component
    - Show global sync status (syncing, synced, error, offline)
    - Display pending count
    - _Requirements: 5.3_
  
  - [x] 8.2 Add sync status badge to ServiceLogCard
    - Show synced/pending/error status per record
    - Add retry button for error state
    - _Requirements: 5.1, 5.2_
  
  - [x] 8.3 Add "Sync Now" button to header/settings
    - Trigger manual sync
    - Show success/error notification
    - _Requirements: 6.1, 6.2, 6.3_
  
  - [x] 8.4 Write property test for sync status display
    - **Property 5: Sync Status Displayed Correctly**
    - **Validates: Requirements 5.1, 5.2, 5.4**

- [x] 9. Implement Initial Migration
  - [x] 9.1 Create MigrationService for first-time sync
    - Detect existing local data on first sign-in
    - Show migration prompt
    - _Requirements: 8.1_
  
  - [x] 9.2 Implement batch migration with progress
    - Sync records in batches
    - Show progress and estimated time
    - Allow resume on failure
    - _Requirements: 8.2, 8.3_
  
  - [x] 9.3 Implement data integrity verification
    - Compare record counts after migration
    - Report any discrepancies
    - _Requirements: 8.4_
  
  - [x] 9.4 Write property test for migration data integrity
    - **Property 9: Migration Data Integrity**
    - **Validates: Requirements 8.4**

- [-] 10. Update CustomerDetail for Sync Integration
  - [x] 10.1 Show sync status on service logs
    - Display sync indicator on each log card
    - _Requirements: 5.1_
  
  - [-] 10.2 Auto-sync before sending report
    - If log not synced, sync first then send
    - Show appropriate loading/error states
    - _Requirements: 4.3_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Final Integration Testing
  - [x] 12.1 Test full offline/online cycle
    - Create records offline, verify sync on reconnect
  
  - [x] 12.2 Test conflict resolution
    - Modify same record on two devices, verify resolution
  
  - [x] 12.3 Test migration flow
    - Verify existing data migrates correctly

## Notes

- Tasks marked with `*` are optional property-based tests
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
