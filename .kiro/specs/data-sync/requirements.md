# Requirements Document

## Introduction

This feature enables bidirectional synchronization between the local Dexie (IndexedDB) database and the Convex cloud backend. This allows users to work offline with full functionality and seamlessly sync their data when online, enabling features like SMS/Email report sending that require cloud-stored data.

## Glossary

- **Dexie**: Local IndexedDB wrapper library used for offline-first data storage
- **Convex**: Cloud backend service for real-time data storage and serverless functions
- **Sync_Service**: The service responsible for coordinating data synchronization between Dexie and Convex
- **Sync_Status**: Indicator showing whether a record is synced, pending sync, or has conflicts
- **Conflict_Resolution**: Strategy for handling cases where the same record was modified both locally and remotely

## Requirements

### Requirement 1: Automatic Background Sync

**User Story:** As a pool service technician, I want my local data to automatically sync to the cloud when I'm online, so that I can send reports and access my data from any device.

#### Acceptance Criteria

1. WHEN the user signs in and has internet connectivity, THE Sync_Service SHALL automatically begin syncing unsynced local records to Convex
2. WHEN a new record is created locally while online, THE Sync_Service SHALL sync it to Convex within 5 seconds
3. WHEN a record is modified locally while online, THE Sync_Service SHALL sync the changes to Convex within 5 seconds
4. WHILE syncing is in progress, THE Sync_Service SHALL display a subtle sync indicator in the UI
5. IF a sync operation fails due to network issues, THEN THE Sync_Service SHALL retry with exponential backoff up to 3 times

### Requirement 2: Offline-First Data Creation

**User Story:** As a pool service technician working in areas with poor connectivity, I want to create service logs offline and have them sync automatically when I regain connectivity.

#### Acceptance Criteria

1. WHEN a user creates a service log while offline, THE System SHALL store it in Dexie with a pending_sync status
2. WHEN connectivity is restored, THE Sync_Service SHALL automatically sync all pending records
3. WHEN a record is successfully synced, THE System SHALL store the Convex ID alongside the Dexie ID
4. THE System SHALL maintain data integrity by ensuring no duplicate records are created during sync

### Requirement 3: Customer Data Sync

**User Story:** As a business owner, I want my customer data synced to the cloud, so that customer information is available for report generation and multi-device access.

#### Acceptance Criteria

1. WHEN a customer is created locally, THE Sync_Service SHALL sync the customer record to Convex
2. WHEN a customer is updated locally, THE Sync_Service SHALL sync the updated fields to Convex
3. WHEN a customer is deleted locally, THE Sync_Service SHALL mark the customer as deleted in Convex
4. THE Sync_Service SHALL sync customer report_settings to enable personalized report generation

### Requirement 4: Service Log Sync for Report Sending

**User Story:** As a pool service technician, I want my service logs synced to the cloud, so that I can send SMS/Email reports to customers.

#### Acceptance Criteria

1. WHEN a service log is created locally, THE Sync_Service SHALL sync it to Convex with all chemical readings and notes
2. WHEN a service log is synced successfully, THE System SHALL store the convex_id in the local Dexie record
3. WHEN attempting to send a report for an unsynced log, THE System SHALL first sync the log then proceed with sending
4. THE Sync_Service SHALL sync service log photos to Convex storage for inclusion in reports

### Requirement 5: Sync Status Visibility

**User Story:** As a user, I want to see which records are synced and which are pending, so that I know when I can send reports.

#### Acceptance Criteria

1. THE System SHALL display a sync status indicator on each service log card (synced, pending, error)
2. WHEN a record has a sync error, THE System SHALL display the error message and a retry button
3. THE System SHALL provide a global sync status indicator showing overall sync progress
4. WHEN all records are synced, THE System SHALL display a "fully synced" confirmation

### Requirement 6: Manual Sync Trigger

**User Story:** As a user, I want to manually trigger a sync when needed, so that I can ensure my data is up-to-date before sending reports.

#### Acceptance Criteria

1. THE System SHALL provide a "Sync Now" button in the settings or header area
2. WHEN the user clicks "Sync Now", THE Sync_Service SHALL immediately attempt to sync all pending records
3. WHEN manual sync completes, THE System SHALL display a success or error notification
4. IF manual sync fails, THEN THE System SHALL display specific error details and suggested actions

### Requirement 7: Conflict Resolution

**User Story:** As a user who may edit data on multiple devices, I want conflicts to be handled gracefully, so that I don't lose important data.

#### Acceptance Criteria

1. WHEN the same record is modified both locally and remotely, THE Sync_Service SHALL detect the conflict
2. THE Sync_Service SHALL use "last-write-wins" strategy by default, preferring the most recent modification
3. IF a conflict occurs, THEN THE System SHALL log the conflict for debugging purposes
4. THE System SHALL preserve the original local version in a conflict_backup field before overwriting

### Requirement 8: Initial Data Migration

**User Story:** As an existing user with local data, I want my existing Dexie data migrated to Convex when I first sign in, so that I can use cloud features immediately.

#### Acceptance Criteria

1. WHEN a user signs in for the first time with existing local data, THE Sync_Service SHALL offer to migrate all local data to Convex
2. THE Migration_Process SHALL show progress and estimated time remaining
3. IF migration fails partway through, THEN THE System SHALL allow resuming from where it left off
4. WHEN migration completes, THE System SHALL verify data integrity by comparing record counts
