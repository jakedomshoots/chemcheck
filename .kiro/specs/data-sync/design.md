# Design Document: Dexie-to-Convex Data Sync

## Overview

This design describes a bidirectional synchronization system between the local Dexie (IndexedDB) database and the Convex cloud backend. The system enables offline-first functionality while ensuring data is available in the cloud for features like SMS/Email report sending.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Application                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   UI Layer   │    │  Sync Hook   │    │ Auth Context │      │
│  │  Components  │◄───│ useSyncState │◄───│  (Clerk)     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                    │               │
│         ▼                   ▼                    ▼               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Sync Service                          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │ Sync Queue  │  │  Conflict   │  │   Retry     │     │   │
│  │  │  Manager    │  │  Resolver   │  │   Handler   │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                                        │               │
│         ▼                                        ▼               │
│  ┌──────────────┐                        ┌──────────────┐      │
│  │    Dexie     │                        │    Convex    │      │
│  │  (IndexedDB) │                        │   (Cloud)    │      │
│  └──────────────┘                        └──────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. SyncService Class

The core service that manages synchronization between Dexie and Convex.

```typescript
interface SyncService {
  // Initialize sync service with Convex client
  initialize(convexClient: ConvexReactClient): void;
  
  // Start automatic background sync
  startAutoSync(): void;
  
  // Stop automatic sync
  stopAutoSync(): void;
  
  // Manually trigger sync for all pending records
  syncNow(): Promise<SyncResult>;
  
  // Sync a specific record
  syncRecord(table: string, localId: number): Promise<SyncResult>;
  
  // Get current sync status
  getSyncStatus(): SyncStatus;
  
  // Subscribe to sync status changes
  onSyncStatusChange(callback: (status: SyncStatus) => void): () => void;
}
```

### 2. SyncQueue Manager

Manages the queue of records pending synchronization.

```typescript
interface SyncQueueManager {
  // Add record to sync queue
  enqueue(item: SyncQueueItem): void;
  
  // Get next item to sync
  dequeue(): SyncQueueItem | null;
  
  // Get all pending items
  getPending(): SyncQueueItem[];
  
  // Mark item as synced
  markSynced(localId: number, convexId: string): void;
  
  // Mark item as failed
  markFailed(localId: number, error: string): void;
}

interface SyncQueueItem {
  table: 'customers' | 'serviceLogs' | 'chemicalUsage' | 'notes';
  localId: number;
  operation: 'create' | 'update' | 'delete';
  data: Record<string, any>;
  retryCount: number;
  lastAttempt?: number;
  error?: string;
}
```

### 3. Conflict Resolver

Handles conflicts when the same record is modified both locally and remotely.

```typescript
interface ConflictResolver {
  // Detect if there's a conflict
  detectConflict(local: SyncableRecord, remote: SyncableRecord): boolean;
  
  // Resolve conflict using last-write-wins strategy
  resolve(local: SyncableRecord, remote: SyncableRecord): SyncableRecord;
  
  // Create backup of local version before overwriting
  createBackup(record: SyncableRecord): void;
}
```

### 4. useSyncState Hook

React hook for components to access sync state.

```typescript
interface UseSyncStateReturn {
  // Overall sync status
  status: 'idle' | 'syncing' | 'error' | 'offline';
  
  // Number of pending records
  pendingCount: number;
  
  // Last sync timestamp
  lastSyncAt: number | null;
  
  // Current error if any
  error: string | null;
  
  // Trigger manual sync
  syncNow: () => Promise<void>;
  
  // Check if specific record is synced
  isRecordSynced: (table: string, localId: number) => boolean;
  
  // Get sync status for specific record
  getRecordSyncStatus: (table: string, localId: number) => RecordSyncStatus;
}
```

## Data Models

### Extended Dexie Schema

Add sync-related fields to existing Dexie tables:

```typescript
interface SyncableRecord {
  _id: number;                    // Local Dexie ID
  convex_id?: string;             // Convex ID after sync
  sync_status: 'synced' | 'pending' | 'error';
  sync_error?: string;            // Error message if sync failed
  local_updated_at: number;       // Local modification timestamp
  remote_updated_at?: number;     // Remote modification timestamp
  conflict_backup?: string;       // JSON backup of pre-conflict version
}

// Updated Customer interface
interface Customer extends SyncableRecord {
  full_name: string;
  address: string;
  phone?: string;
  email?: string;
  service_day: string;
  pool_type?: string;
  pool_gallons?: number;
  surface_type?: string;
  report_settings?: ReportSettings;
  created_by: string;
}

// Updated ServiceLog interface
interface ServiceLog extends SyncableRecord {
  customer_id: number;
  convex_customer_id?: string;    // Reference to synced customer
  service_date: string;
  ph?: string;
  chlorine?: string;
  alkalinity?: string;
  stabilizer?: string;
  salt?: number;
  notes?: string;
  duration_ms?: number;
  start_time?: string;
  end_time?: string;
}
```

### Convex Mutations for Sync

```typescript
// convex/sync.ts
export const syncCustomer = mutation({
  args: {
    local_id: v.number(),
    data: v.object({
      full_name: v.string(),
      address: v.string(),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      service_day: v.string(),
      pool_type: v.optional(v.string()),
      pool_gallons: v.optional(v.number()),
      surface_type: v.optional(v.string()),
      report_settings: v.optional(v.any()),
    }),
    local_updated_at: v.number(),
  },
  handler: async (ctx, args) => {
    // Upsert logic with conflict detection
  },
});

export const syncServiceLog = mutation({
  args: {
    local_id: v.number(),
    convex_customer_id: v.id("customers"),
    data: v.object({
      service_date: v.string(),
      ph: v.optional(v.string()),
      chlorine: v.optional(v.string()),
      alkalinity: v.optional(v.string()),
      stabilizer: v.optional(v.string()),
      salt: v.optional(v.number()),
      notes: v.optional(v.string()),
      duration_ms: v.optional(v.number()),
      start_time: v.optional(v.string()),
      end_time: v.optional(v.string()),
    }),
    local_updated_at: v.number(),
  },
  handler: async (ctx, args) => {
    // Upsert logic with conflict detection
  },
});
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Record Changes Trigger Sync

*For any* record (customer or service log) that is created or modified while online, the Sync_Service SHALL add it to the sync queue within 5 seconds.

**Validates: Requirements 1.2, 1.3, 3.1, 3.2, 4.1**

### Property 2: Convex ID Stored After Successful Sync

*For any* record that is successfully synced to Convex, the local Dexie record SHALL contain the corresponding convex_id, and querying Convex with that ID SHALL return equivalent data.

**Validates: Requirements 2.3, 4.2**

### Property 3: No Duplicate Records During Sync

*For any* record synced multiple times (due to retries or re-sync), the Convex database SHALL contain exactly one record for that local ID, not multiple duplicates.

**Validates: Requirements 2.4**

### Property 4: Offline Records Have Pending Status

*For any* record created while offline, the sync_status field SHALL be 'pending' until connectivity is restored and sync completes successfully.

**Validates: Requirements 2.1, 2.2**

### Property 5: Sync Status Displayed Correctly

*For any* service log displayed in the UI, the sync status indicator SHALL accurately reflect the current sync_status field value (synced, pending, or error).

**Validates: Requirements 5.1, 5.2, 5.4**

### Property 6: Manual Sync Processes All Pending

*For any* invocation of "Sync Now", all records with sync_status='pending' SHALL be attempted for sync, and the result (success or error) SHALL be displayed to the user.

**Validates: Requirements 6.2, 6.3**

### Property 7: Conflicts Detected and Backed Up

*For any* record where local_updated_at differs from remote_updated_at and both have been modified since last sync, the Conflict_Resolver SHALL detect the conflict, create a backup in conflict_backup, and resolve using last-write-wins.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

### Property 8: Retry with Exponential Backoff

*For any* sync operation that fails due to network issues, the Sync_Service SHALL retry up to 3 times with exponentially increasing delays (e.g., 1s, 2s, 4s).

**Validates: Requirements 1.5**

### Property 9: Migration Data Integrity

*For any* initial migration, the count of records in Convex after migration SHALL equal the count of records in Dexie before migration, and each record's data SHALL be equivalent.

**Validates: Requirements 8.4**

## Error Handling

### Network Errors

1. **Transient failures**: Retry with exponential backoff (1s, 2s, 4s)
2. **Persistent failures**: Mark record as error, show retry button
3. **Offline detection**: Pause sync, queue changes, resume on reconnect

### Data Validation Errors

1. **Invalid data**: Log error, mark record as error with message
2. **Missing required fields**: Prevent sync, show validation error
3. **Reference errors**: Sync dependencies first (customer before service log)

### Conflict Errors

1. **Detected conflict**: Create backup, apply last-write-wins
2. **Unresolvable conflict**: Mark as error, require manual resolution

## Testing Strategy

### Unit Tests

- SyncQueue operations (enqueue, dequeue, mark synced/failed)
- Conflict detection logic
- Retry timing calculations
- Data transformation between Dexie and Convex formats

### Property-Based Tests

Using fast-check library with minimum 100 iterations per property:

1. **Sync idempotency**: Syncing same record multiple times produces same result
2. **Round-trip consistency**: Data synced to Convex and back equals original
3. **Queue ordering**: Records synced in correct dependency order
4. **Conflict resolution determinism**: Same conflict always resolves same way

### Integration Tests

- Full sync cycle with mock Convex backend
- Offline/online transition handling
- Migration process with sample data
- Error recovery scenarios
