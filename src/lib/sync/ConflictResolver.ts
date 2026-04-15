/**
 * ConflictResolver handles conflicts when the same record is modified both locally and remotely
 * Implements last-write-wins strategy with backup functionality
 */

import { SyncableRecord } from '@/db/chemcheck-db';

// Extended type for Dexie records that include numeric id
interface DexieRecord extends SyncableRecord {
  id: number;
}

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
 * Uses last-write-wins strategy by default
 */
export class ConflictResolver {
  
  /**
   * Detect if there's a conflict between local and remote records
   * A conflict exists when both records have been modified since last sync
   * and their timestamps differ
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

    // No conflict if local record hasn't been modified since last remote sync
    if (local.remote_updated_at && local.local_updated_at <= local.remote_updated_at) {
      return false;
    }

    // Conflict exists if timestamps differ (both have been modified)
    return local.local_updated_at !== remote.remote_updated_at;
  }

  /**
   * Resolve conflict using last-write-wins strategy
   * Returns the record with the most recent timestamp
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
    
    // Last-write-wins: choose record with most recent timestamp
    const localTime = local.local_updated_at || 0;
    const remoteTime = remote.remote_updated_at || 0;
    
    let resolved: SyncableRecord;
    
    if (localTime > remoteTime) {
      // Local wins - keep local record but update remote timestamp
      resolved = {
        ...local,
        remote_updated_at: remoteTime,
      };
    } else {
      // Remote wins - use remote data and UPDATE local_updated_at to match remote
      // This is critical to prevent sync loops - the local timestamp must be >= remote
      // so the next sync attempt won't detect another conflict
      resolved = {
        ...remote,
        // Preserve local-only fields that aren't part of SyncableRecord
        ...('id' in local && (local as DexieRecord).id ? { id: (local as DexieRecord).id } : {}),
        sync_status: 'synced' as const,
        sync_error: undefined,
        local_updated_at: remoteTime,
        remote_updated_at: remoteTime,
        conflict_backup: local.conflict_backup,
      };
    }

    return {
      resolved,
      hadConflict: true,
      backupCreated,
    };
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
      record.conflict_backup = backup;
      
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
      delete (localData as Record<string, unknown>)[field];
      delete (remoteData as Record<string, unknown>)[field];
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
      winner: conflictInfo.localTimestamp > conflictInfo.remoteTimestamp ? 'local' : 'remote',
    });
  }
}

// Singleton instance
export const conflictResolver = new ConflictResolver();