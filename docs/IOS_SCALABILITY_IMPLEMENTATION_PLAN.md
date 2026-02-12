# ChemCheck iOS Release - Scalability Implementation Plan

**Document Version**: 1.0  
**Date**: February 2026  
**Author**: CTO Code Review  
**Status**: Pending Approval

---

## Executive Summary

This document outlines the implementation plan for 12 scalability issues identified during the pre-iOS release code audit. Issues are categorized by priority (P0-P2) with detailed implementation steps, code changes, and testing requirements.

**Estimated Total Effort**: 15-20 developer days  
**Risk Level**: Medium (requires database schema changes and core architecture updates)

---

## P0 - Critical Issues (Must Fix Before Release)

### Issue 1: N+1 Query Problem in Service Logs

**File**: `convex/serviceLogs.ts`  
**Lines**: 82-88, 128-142, 180-188  
**Severity**: Critical  
**Effort**: 2 days

#### Problem Analysis
The current implementation queries service logs per customer individually:
```typescript
const logPromises = Array.from(userCustomerIds).map(customerId =>
    ctx.db.query("serviceLogs")
        .withIndex("by_customer", (q) => q.eq("customer_id", customerId as any))
        .collect()
);
```

With 100 customers, this creates 100 database round-trips. At 1000+ customers, this causes:
- Request timeouts (>30 seconds)
- Convex function execution limits exceeded
- Poor user experience on slow networks

#### Implementation Plan

**Step 1: Add Schema Index** (convex/schema.ts)
```typescript
// Add to serviceLogs table definition:
serviceLogs: defineTable({...})
    .index("by_customer", ["customer_id"])
    .index("by_service_date", ["service_date"])
    .index("by_customer_and_date", ["customer_id", "service_date"])
    .index("by_created_by", ["created_by"])  // NEW: For bulk queries
```

**Step 2: Add created_by to ServiceLogs** (convex/schema.ts)
```typescript
// Add field to serviceLogs:
created_by: v.string(), // Denormalized from customer for efficient queries
```

**Step 3: Create Migration Function** (convex/migrations.ts - new file)
```typescript
// One-time migration to backfill created_by
export const backfillServiceLogCreatedBy = mutation({
    handler: async (ctx) => {
        const logs = await ctx.db.query("serviceLogs").collect();
        for (const log of logs) {
            const customer = await ctx.db.get(log.customer_id);
            if (customer && !log.created_by) {
                await ctx.db.patch(log._id, { created_by: customer.created_by });
            }
        }
    }
});
```

**Step 4: Update Query Functions** (convex/serviceLogs.ts)
```typescript
// Replace N+1 pattern with single query:
export const list = query({
    args: { order: v.optional(v.string()), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Single query using new index
        let query = ctx.db
            .query("serviceLogs")
            .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!));
        
        if (args.order === "-service_date") {
            query = query.order("desc");
        }
        
        return await query.take(args.limit || 100);
    },
});
```

**Step 5: Update Create Mutation** (convex/serviceLogs.ts)
```typescript
// Add created_by when creating logs:
const logData = {
    ...args,
    created_by: customer.created_by, // Denormalize from customer
};
```

#### Testing Checklist
- [ ] Run migration on staging with production data copy
- [ ] Verify query returns same results as before
- [ ] Performance test with 1000+ service logs
- [ ] Verify tenant isolation still works (users only see their logs)

#### Rollback Plan
- Keep old query functions as `listLegacy` for 1 release cycle
- Migration is additive (doesn't delete data)

---

### Issue 2: Unbounded Photo Storage in IndexedDB

**Files**: `src/lib/proof-of-service/photoUtils.ts`, `src/db/chemcheck-db.ts`  
**Severity**: Critical  
**Effort**: 3 days

#### Problem Analysis
Photos stored as base64 with no limits:
- Average compressed photo: 500KB - 2MB
- 100 photos = 50-200MB
- iOS WebView memory limit: ~200-300MB
- IndexedDB quota varies by device (50MB - 500MB)

#### Implementation Plan

**Step 1: Add Photo Management Table** (src/db/chemcheck-db.ts)
```typescript
export interface PhotoMetadata {
    id?: number;
    storage_id: string;           // Convex storage ID after sync
    service_log_id: number;
    customer_id: number;
    category: 'before' | 'after';
    size_bytes: number;
    created_at: number;
    local_path?: string;          // For future file system storage
    sync_status: 'pending' | 'synced' | 'error';
}

// Add to database schema:
this.version(4).stores({
    // ... existing tables
    photoMetadata: '++id, service_log_id, customer_id, category, created_at, sync_status',
});
```

**Step 2: Implement Storage Limits** (src/lib/proof-of-service/photoStorage.ts - new file)
```typescript
const MAX_PHOTOS_PER_SERVICE_LOG = 10; // 5 before + 5 after
const MAX_PHOTO_AGE_DAYS = 90;
const MAX_TOTAL_STORAGE_MB = 100;

export async function enforceStorageLimits(): Promise<void> {
    const totalSize = await getTotalPhotoSize();
    
    if (totalSize > MAX_TOTAL_STORAGE_MB * 1024 * 1024) {
        // Delete oldest synced photos first
        await deleteOldestSyncedPhotos(
            totalSize - (MAX_TOTAL_STORAGE_MB * 1024 * 1024)
        );
    }
    
    // Delete photos older than retention period
    const cutoff = Date.now() - (MAX_PHOTO_AGE_DAYS * 24 * 60 * 60 * 1000);
    await deletePhotosOlderThan(cutoff);
}
```

**Step 3: Update Photo Capture** (src/components/proof-of-service/PhotoCapture.tsx)
```typescript
// Before saving, check limits:
const existingPhotos = await getPhotosForServiceLog(serviceLogId);
if (existingPhotos.filter(p => p.category === category).length >= 5) {
    throw new Error(`Maximum ${category} photos reached (5)`);
}

// Enforce limits after save:
await enforceStorageLimits();
```

**Step 4: Add Settings UI** (src/pages/Settings.jsx)
```typescript
// Add storage management section:
<StorageSettings>
    <StorageUsage />
    <Button onClick={clearSyncedPhotos}>Clear Synced Photos</Button>
    <Button onClick={clearAllPhotos}>Clear All Photos</Button>
</StorageSettings>
```

#### Testing Checklist
- [ ] Test with 100+ photos, verify cleanup triggers
- [ ] Verify photos are retained for 90 days
- [ ] Test sync status tracking
- [ ] Memory profiling on iOS simulator

#### Rollback Plan
- Database version 4 is additive
- Old photos remain accessible

---

### Issue 3: Memory Leak in LRU Cache

**File**: `src/api/dexieHooks.ts`  
**Lines**: 44, 173-174  
**Severity**: Critical  
**Effort**: 1 day

#### Problem Analysis
```typescript
// Interval created but never cleaned up:
this.cleanupIntervalId = setInterval(() => this.cleanup(), 60 * 1000);

// Singleton never destroyed:
const idAliasCache = new LRUCacheWithTTL<any>(1000, 5 * 60 * 1000);
```

On iOS:
- Interval continues in background
- Memory not released
- Battery drain

#### Implementation Plan

**Step 1: Add Visibility-Based Cleanup** (src/api/dexieHooks.ts)
```typescript
// Add visibility change listener:
let visibilityCleanupRegistered = false;

function registerVisibilityCleanup() {
    if (visibilityCleanupRegistered) return;
    visibilityCleanupRegistered = true;
    
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // Aggressive cleanup when backgrounded
            idAliasCache.cleanup();
            
            // Stop interval to save battery
            stopCacheCleanup();
        } else {
            // Resume when foregrounded
            startCacheCleanup();
        }
    });
}

let cacheCleanupIntervalId: ReturnType<typeof setInterval> | null = null;

function startCacheCleanup(): void {
    if (!cacheCleanupIntervalId) {
        cacheCleanupIntervalId = setInterval(() => {
            idAliasCache.cleanup();
        }, 60 * 1000);
    }
}

function stopCacheCleanup(): void {
    if (cacheCleanupIntervalId) {
        clearInterval(cacheCleanupIntervalId);
        cacheCleanupIntervalId = null;
    }
}
```

**Step 2: Update LRUCacheWithTTL Class**
```typescript
class LRUCacheWithTTL<T> {
    // Remove automatic interval from constructor
    constructor(maxSize: number = 1000, ttlMs: number = 5 * 60 * 1000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        // Don't create interval here - managed externally
    }
    
    // Add destroy method for explicit cleanup
    destroy(): void {
        this.cache.clear();
    }
}
```

**Step 3: Initialize on App Start** (src/main.jsx)
```typescript
import { registerVisibilityCleanup, startCacheCleanup } from '@/api/dexieHooks';

// In initializeApp():
registerVisibilityCleanup();
startCacheCleanup();
```

#### Testing Checklist
- [ ] Verify interval stops when app backgrounded
- [ ] Verify interval resumes when app foregrounded
- [ ] Memory profiling: no growth over time
- [ ] Test on iOS simulator with memory debugger

---

## P1 - High Severity Issues

### Issue 4: Missing Pagination on Customer List

**File**: `convex/customers.ts`  
**Lines**: 13-16  
**Severity**: High  
**Effort**: 0.5 days

#### Implementation Plan

**Step 1: Add Pagination Args**
```typescript
export const list = query({
    args: {
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()), // For infinite scroll
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const limit = args.limit || 50;
        
        let query = ctx.db
            .query("customers")
            .withIndex("by_created_by", (q) => q.eq("created_by", identity.email!));
        
        // Use Convex's built-in pagination
        const result = await query.paginate({
            cursor: args.cursor || null,
            numItems: limit,
        });
        
        return {
            customers: result.page,
            cursor: result.continueCursor,
            hasMore: !result.isDone,
        };
    },
});
```

**Step 2: Update Frontend Hook** (src/api/dexieHooks.ts)
```typescript
export function useCustomersPaginated(initialLimit = 50) {
    const [cursor, setCursor] = useState<string | null>(null);
    const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
    
    const { data, isLoading } = useQuery(api.customers.list, { 
        limit: initialLimit,
        cursor 
    });
    
    const loadMore = useCallback(() => {
        if (data?.hasMore && data?.cursor) {
            setCursor(data.cursor);
        }
    }, [data]);
    
    return { customers: allCustomers, loadMore, isLoading, hasMore: data?.hasMore };
}
```

---

### Issue 5: Race Condition in Sync Hooks

**File**: `src/db/chemcheck-db.ts`  
**Lines**: 214-217, 255-258, etc.  
**Severity**: High  
**Effort**: 2 days

#### Problem Analysis
```typescript
setTimeout(() => {
    this.syncService.enqueueRecord('customers', primKey, 'update', updatedRecord);
}, 0);
```

This creates race conditions:
1. User updates record A
2. User updates record A again
3. Second setTimeout fires first
4. Sync queue has wrong order

#### Implementation Plan

**Step 1: Replace setTimeout with Transaction-Aware Queue**
```typescript
private setupSyncHooks(): void {
    // Use a microtask queue instead of setTimeout
    const syncQueue: Array<() => void> = [];
    let syncScheduled = false;
    
    const flushSyncQueue = () => {
        syncScheduled = false;
        const items = syncQueue.splice(0, syncQueue.length);
        for (const item of items) {
            item();
        }
    };
    
    const scheduleSync = (fn: () => void) => {
        syncQueue.push(fn);
        if (!syncScheduled) {
            syncScheduled = true;
            queueMicrotask(flushSyncQueue);
        }
    };
    
    // Use scheduleSync instead of setTimeout
    this.customers.hook('updating', (modifications, primKey, obj, trans) => {
        if (this.hasNonSyncFieldChanges(modifications)) {
            // ... existing code ...
            
            scheduleSync(() => {
                this.syncService?.enqueueRecord('customers', primKey, 'update', updatedRecord);
            });
        }
    });
}
```

**Step 2: Add Sequence Numbers**
```typescript
// Add to SyncableRecord interface:
sync_sequence?: number;

// In hook:
let syncSequence = 0;
this.customers.hook('updating', (modifications, primKey, obj, trans) => {
    modifications.sync_sequence = ++syncSequence;
    // ...
});
```

---

### Issue 6: iOS Simulator Auth Bypass in Production Code

**File**: `src/components/auth/ClerkAuthProvider.jsx`  
**Lines**: 10-18  
**Severity**: High (Security)  
**Effort**: 0.5 days

#### Implementation Plan

**Step 1: Add Build-Time Check**
```typescript
// Remove runtime bypass, use build-time constant:
const isIosSimulatorBypass = import.meta.env.VITE_IOS_SIM_AUTH_BYPASS === 'true'
    && import.meta.env.DEV; // Only in development builds

// Add warning in production:
if (import.meta.env.VITE_IOS_SIM_AUTH_BYPASS === 'true' && !import.meta.env.DEV) {
    console.error('SECURITY WARNING: iOS Simulator Auth Bypass is enabled in production!');
    // Optionally throw error or disable bypass
}
```

**Step 2: Add CI/CD Check** (.github/workflows/build.yml)
```yaml
- name: Check for auth bypass
  run: |
    if grep -q "VITE_IOS_SIM_AUTH_BYPASS.*true" .env.production; then
      echo "ERROR: Auth bypass enabled in production environment"
      exit 1
    fi
```

---

### Issue 7: Rate Limit Cleanup Not Scheduled

**File**: `convex/rateLimit.ts`  
**Lines**: 341-370  
**Severity**: High  
**Effort**: 0.5 days

#### Implementation Plan

**Step 1: Add Scheduled Function** (convex/cron.ts - new file)
```typescript
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Run cleanup every hour
crons.hourly(
    'cleanup-rate-limits',
    { hourUTC: 0 }, // Run at minute 0 of each hour
    internal.rateLimit.cleanupExpiredRateLimits,
    {}
);

export default crons;
```

**Step 2: Update convex.json**
```json
{
    "functions": "convex/",
    "crons": "convex/cron.ts"
}
```

---

## P2 - Medium Severity Issues

### Issue 8: No Offline Queue Size Limit

**File**: `src/db/chemcheck-db.ts`  
**Effort**: 1 day

#### Implementation Plan
```typescript
const MAX_PENDING_OPERATIONS = 1000;

private enqueueRecord(table: string, id: number, operation: string, record: any): void {
    // Check queue size
    const pendingCount = this.getPendingCount();
    if (pendingCount >= MAX_PENDING_OPERATIONS) {
        // Alert user to sync
        this.emit('sync:queue-full', { count: pendingCount });
        return;
    }
    
    // ... existing enqueue logic
}
```

---

### Issue 9: Monitoring Data Persists to localStorage

**File**: `src/lib/monitoring.ts`  
**Lines**: 256-257  
**Effort**: 0.5 days

#### Implementation Plan
```typescript
// Use sessionStorage instead (cleared on tab close):
private persistData(): void {
    try {
        // Use sessionStorage for non-persistent data
        sessionStorage.setItem('monitoring_metrics', JSON.stringify(this.metrics.slice(-25)));
        sessionStorage.setItem('monitoring_errors', JSON.stringify(this.errors.slice(-25)));
    } catch (error) {
        // Handle quota exceeded
        this.trimStoredData();
    }
}

// Or use IndexedDB with size limits:
private async persistToIndexedDB(): Promise<void> {
    const db = await openDB('monitoring', 1, {
        upgrade(db) {
            db.createObjectStore('metrics');
            db.createObjectStore('errors');
        },
    });
    
    // Implement LRU eviction
}
```

---

### Issue 10: Missing Index for Report Token Lookup

**File**: `convex/schema.ts`  
**Effort**: 0.25 days

The index exists but verify it's being used:
```typescript
// Verify query uses index:
const report = await ctx.db
    .query("serviceReports")
    .withIndex("by_token", (q) => q.eq("report_token", args.token))
    .first(); // This is correct
```

No changes needed - just verify in production logs.

---

## iOS-Specific Issues

### Issue 11: Camera Stream Not Released on Background

**File**: `src/components/proof-of-service/PhotoCapture.tsx`  
**Effort**: 1 day

#### Implementation Plan
```typescript
useEffect(() => {
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden' && streamRef.current) {
            // Release camera when backgrounded
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
            setCameraState('idle');
        }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        // Existing cleanup
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
    };
}, []);
```

---

### Issue 12: Capacitor Configuration

**File**: `capacitor.config.json`  
**Effort**: 0.25 days

#### Implementation Plan
```json
{
    "ios": {
        "contentInset": "automatic",
        "backgroundColor": "#0f172a",
        "limitsNavigationsToAppBoundDomains": true  // Change to true
    }
}
```

Also add App Transport Security domains in Info.plist.

---

## Implementation Timeline

| Week | Issues | Deliverables |
|------|--------|--------------|
| 1 | Issue 1, 3 | N+1 Query Fix, Memory Leak Fix |
| 2 | Issue 2 | Photo Storage Limits |
| 3 | Issues 4, 5, 6 | Pagination, Race Condition, Auth Bypass |
| 4 | Issues 7, 8, 9, 11, 12 | Remaining P1/P2 + iOS fixes |
| 5 | Testing | Integration testing, performance validation |

---

## Testing Requirements

### Performance Benchmarks
- Customer list load time: < 500ms with 1000 customers
- Service log query: < 200ms with 10,000 logs
- Photo capture: < 3s including compression
- Memory usage: < 150MB steady state

### iOS-Specific Testing
- Background/foreground transitions
- Memory warnings handling
- Camera permission flows
- Offline mode resilience

### Security Testing
- Tenant isolation verification
- Auth bypass disabled in production builds
- Rate limiting effectiveness

---

## Approval Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| CTO | | | |
| Lead Developer | | | |
| QA Lead | | | |

---

## Appendix A: Migration Scripts

### Service Log created_by Migration
```bash
# Run on staging first
npx convex run migrations:backfillServiceLogCreatedBy

# Verify counts match
npx convex run debug:countServiceLogsWithCreatedBy
```

### Photo Storage Migration
```bash
# Backup before migration
npx convex run backup:createBackup

# Run migration
npx convex run migrations:migratePhotoMetadata
```

---

## Appendix B: Monitoring Queries

### Check Rate Limit Table Size
```typescript
// Add to convex/debug.ts
export const getRateLimitStats = query({
    handler: async (ctx) => {
        const limits = await ctx.db.query("rateLimits").count();
        const violations = await ctx.db.query("rateLimitViolations").count();
        return { limits, violations };
    }
});
```

### Check Photo Storage Usage
```typescript
export const getPhotoStorageStats = query({
    handler: async (ctx) => {
        const photos = await ctx.db.query("servicePhotos").collect();
        return {
            count: photos.length,
            // Estimate storage (actual files in Convex storage)
        };
    }
});
```
