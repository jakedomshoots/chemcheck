/**
 * ConflictResolver handles conflicts when the same record is modified both locally and remotely
 * Pending local edits win over a remote change made since the base version this
 * device last saw; the local row is backed up and its base is advanced.
 */

import { SyncableRecord } from '@/db/chemcheck-db';

export interface ConflictResolutionResult {
  resolved: SyncableRecord;
  hadConflict: boolean;
  backupCreated: boolean;
}

export interface ConflictInfo {
  localTimestamp: number;
  remoteTimestamp: number;
  conflictedFields: string[];
}

/**
 * ConflictResolver detects and resolves conflicts between local and remote records
 * Default strategy: local pending edits win, base (remote_updated_at) advanced
 */
export class ConflictResolver {
  
  /**
   * Detect whether the remote version diverged from the version this device
   * last saw. Both sides of the comparison are server timestamps: the remote
   * row's `updated_at` (carried as `remote.remote_updated_at`) against the
   * base the local row stored in `local.remote_updated_at`. Device clocks
   * never enter the decision.
   *
   * Legacy rows without a stored base fall back to the old heuristic: a
   * conflict exists when the local row changed and the stamps differ.
   */
  detectConflict(local: SyncableRecord, remote: SyncableRecord | undefined): boolean {
    // No conflict if remote doesn't exist
    if (!remote) {
      return false;
    }

    // No conflict if either record doesn't have timestamps
    if (!local.local_updated_at || !remote.remote_updated_at) {
      return false;
    }

    // No conflict if the local row carries no pending edit.
    if (local.sync_status === 'synced' || local.sync_status === 'local_only') {
      return false;
    }

    const base = local.remote_updated_at;
    if (typeof base === 'number' && Number.isFinite(base) && base > 0) {
      // Only a server-side change since our base counts as a conflict.
      return remote.remote_updated_at > base;
    }

    // Legacy: no base recorded. Conflict exists if the stamps differ.
    return local.local_updated_at !== remote.remote_updated_at;
  }

  /**
   * Resolve a conflict. Default strategy: pending local edits win. The local
   * data is kept as-is, a backup of the local row is written to
   * `conflict_backup`, and `remote_updated_at` is advanced to the remote
   * version so the next push is made against the new base.
   *
   * Callers that explicitly accept the remote version use `acceptRemote`.
   */
  resolve(local: SyncableRecord, remote: SyncableRecord | undefined): ConflictResolutionResult {
    const hadConflict = this.detectConflict(local, remote);

    if (!hadConflict || !remote) {
      // No conflict - return local record as-is
      return {
        resolved: local,
        hadConflict: false,
        backupCreated: false,
      };
    }

    // Create backup before resolving conflict
    const backupCreated = this.createBackup(local);

    const remoteTime = remote.remote_updated_at || 0;
    const resolved: SyncableRecord = {
      ...local,
      remote_updated_at: Math.max(remoteTime, local.remote_updated_at || 0),
    };

    return {
      resolved,
      hadConflict: true,
      backupCreated,
    };
  }

  /**
   * Explicitly accept the remote version over the local row. The local row is
   * backed up first. `local_updated_at` is set to the remote stamp so the row
   * does not look locally changed afterwards.
   */
  acceptRemote(local: SyncableRecord, remote: SyncableRecord): ConflictResolutionResult {
    const backupCreated = this.createBackup(local);
    const remoteTime = remote.remote_updated_at || 0;
    const resolved: SyncableRecord = {
      ...this.normalizeRemoteForLocal(local, remote),
      // Preserve local-only fields that aren't part of SyncableRecord
      ...((local as any).id ? { id: (local as any).id } : {}),
      sync_status: 'synced' as const,
      sync_error: undefined,
      local_updated_at: remoteTime,
      remote_updated_at: remoteTime,
      conflict_backup: local.conflict_backup,
    };
    return { resolved, hadConflict: true, backupCreated };
  }

  /**
   * A conflict's remote_data is the raw Convex document. Writing it verbatim
   * into Dexie would replace numeric local foreign keys (customer_id/pool_id)
   * with Convex id strings and add server-only fields (_id, business_id).
   * Strip those and keep local keys, remembering the Convex ids alongside.
   * (SyncService additionally maps Convex ids to local ids via Dexie lookups.)
   */
  private normalizeRemoteForLocal(local: SyncableRecord, remote: SyncableRecord): SyncableRecord {
    const normalized: any = { ...remote };
    const localAny = local as any;

    if (typeof normalized._id === 'string' && !normalized.convex_id) {
      normalized.convex_id = normalized._id;
    }
    delete normalized._id;
    delete normalized._creationTime;
    delete normalized.business_id;
    delete normalized.deleted_at;
    delete normalized.local_id;

    for (const key of ['customer_id', 'pool_id'] as const) {
      if (typeof normalized[key] === 'string') {
        normalized[`convex_${key}`] = normalized[key];
        if (typeof localAny[key] === 'number') {
          normalized[key] = localAny[key];
        } else {
          delete normalized[key];
        }
      }
    }

    if (!normalized.convex_id && localAny.convex_id) normalized.convex_id = localAny.convex_id;
    return normalized as SyncableRecord;
  }

  /**
   * Create backup of local version before overwriting
   * Stores the backup in the conflict_backup field as JSON
   */
  createBackup(record: SyncableRecord): boolean {
    try {
      // Create a clean copy without the conflict_backup field to avoid recursion
      const { conflict_backup, ...cleanRecord } = record;
      
      // Store backup as JSON string
      const backup = JSON.stringify({
        timestamp: Date.now(),
        data: cleanRecord,
      });

      // Update the record with backup (mutates the original)
      (record as any).conflict_backup = backup;
      
      return true;
    } catch (error) {
      console.error('Failed to create conflict backup:', error);
      return false;
    }
  }

  /**
   * Get conflict information for debugging/logging
   */
  getConflictInfo(local: SyncableRecord, remote: SyncableRecord | undefined): ConflictInfo | null {
    if (!remote || !this.detectConflict(local, remote)) {
      return null;
    }

    // Find fields that differ between local and remote
    const conflictedFields: string[] = [];
    const localData = { ...local };
    const remoteData = { ...remote };
    
    // Remove sync-specific fields from comparison
    const syncFields = ['id', 'convex_id', 'sync_status', 'sync_error', 'local_updated_at', 'remote_updated_at', 'conflict_backup'];
    syncFields.forEach(field => {
      delete (localData as any)[field];
      delete (remoteData as any)[field];
    });

    // Compare remaining fields
    const allKeys = Array.from(new Set([...Object.keys(localData), ...Object.keys(remoteData)]));
    for (const key of allKeys) {
      if (localData[key as keyof SyncableRecord] !== remoteData[key as keyof SyncableRecord]) {
        conflictedFields.push(key);
      }
    }

    return {
      localTimestamp: local.local_updated_at || 0,
      remoteTimestamp: remote.remote_updated_at || 0,
      conflictedFields,
    };
  }

  /**
   * Parse conflict backup from JSON string
   */
  parseBackup(backupJson: string): { timestamp: number; data: SyncableRecord } | null {
    try {
      const parsed = JSON.parse(backupJson);
      if (parsed.timestamp && parsed.data) {
        return parsed;
      }
      return null;
    } catch (error) {
      console.error('Failed to parse conflict backup:', error);
      return null;
    }
  }

  /**
   * Log conflict for debugging purposes
   */
  logConflict(table: string, localId: number, conflictInfo: ConflictInfo): void {
    console.warn(`Conflict detected for ${table}[${localId}]:`, {
      localTimestamp: new Date(conflictInfo.localTimestamp).toISOString(),
      remoteTimestamp: new Date(conflictInfo.remoteTimestamp).toISOString(),
      conflictedFields: conflictInfo.conflictedFields,
      winner: 'local',
    });
  }
}

// Singleton instance
export const conflictResolver = new ConflictResolver();