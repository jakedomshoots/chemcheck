// ============================================
// Audit Logging System
// Tracks important user actions for security and compliance
// ============================================

import { getActiveTenantScope } from '@/lib/tenantScope';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent: string;
  success: boolean;
  errorMessage?: string;
}

export type AuditAction = 
  | 'CREATE'
  | 'READ'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'EXPORT'
  | 'IMPORT'
  | 'BACKUP'
  | 'RESTORE'
  | 'SETTINGS_CHANGE'
  | 'PASSWORD_CHANGE'
  | 'PERMISSION_CHANGE';

export type AuditResource = 
  | 'CUSTOMER'
  | 'SERVICE_LOG'
  | 'CHEMICAL_USAGE'
  | 'NOTE'
  | 'USER'
  | 'BUSINESS'
  | 'SETTINGS'
  | 'BACKUP'
  | 'SESSION';

const LEGACY_STORAGE_KEY = 'chemcheck_audit_log';
const STORAGE_KEY_PREFIX = 'chemcheck_audit_log_v2_';
const MAX_ENTRIES = 1000;
const RETENTION_DAYS = 90;
const SENSITIVE_DETAIL_KEY = /address|email|phone|gate|code|note|photo|location|token|message|customer/i;

function hashScope(scopeKey: string): string {
  let hash = 2166136261;
  for (let index = 0; index < scopeKey.length; index += 1) {
    hash ^= scopeKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sanitizeDetails(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_DETAIL_KEY.test(key)) return '[redacted]';
  if (depth > 3) return '[truncated]';
  if (typeof value === 'string') return value.slice(0, 120);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeDetails(item, '', depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeDetails(entryValue, entryKey, depth + 1),
      ]),
    );
  }
  return undefined;
}

class AuditLogger {
  private entries: AuditLogEntry[] = [];
  private storageKey: string | null = null;

  constructor() {
    // Remove the unscoped legacy log. It could contain another user's email
    // and actions on a shared device, and has no safe ownership boundary.
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_STORAGE_KEY);
    this.ensureTenantLoaded();
  }

  // ============================================
  // Core Logging Methods
  // ============================================

  log(
    action: AuditAction,
    resource: AuditResource,
    options: {
      resourceId?: string;
      details?: Record<string, any>;
      success?: boolean;
      errorMessage?: string;
  } = {}
  ): string {
    if (!this.ensureTenantLoaded()) return '';
    const { resourceId, details, success = true, errorMessage } = options;

    // The browser audit trail is intentionally scoped and pseudonymous. It is
    // operational context, not a second store of customer or account PII.
    const currentUser = this.getCurrentUserInfo();

    const entry: AuditLogEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      userId: currentUser.userId,
      action,
      resource,
      resourceId,
      details: sanitizeDetails(details) as Record<string, any> | undefined,
      userAgent: navigator.userAgent,
      success,
      errorMessage: errorMessage ? 'Action failed' : undefined,
    };

    this.entries.push(entry);
    this.trimEntries();
    this.saveEntries();

    return entry.id;
  }

  // Convenience methods for common actions
  logCreate(resource: AuditResource, resourceId: string, details?: Record<string, any>): string {
    return this.log('CREATE', resource, { resourceId, details });
  }

  logUpdate(resource: AuditResource, resourceId: string, details?: Record<string, any>): string {
    return this.log('UPDATE', resource, { resourceId, details });
  }

  logDelete(resource: AuditResource, resourceId: string, details?: Record<string, any>): string {
    return this.log('DELETE', resource, { resourceId, details });
  }

  logLogin(success: boolean, errorMessage?: string): string {
    return this.log('LOGIN', 'SESSION', { success, errorMessage });
  }

  logLogout(): string {
    return this.log('LOGOUT', 'SESSION');
  }

  logExport(resource: AuditResource, details?: Record<string, any>): string {
    return this.log('EXPORT', resource, { details });
  }

  logBackup(success: boolean, details?: Record<string, any>): string {
    return this.log('BACKUP', 'BACKUP', { success, details });
  }

  logRestore(success: boolean, details?: Record<string, any>): string {
    return this.log('RESTORE', 'BACKUP', { success, details });
  }

  logSettingsChange(details: Record<string, any>): string {
    return this.log('SETTINGS_CHANGE', 'SETTINGS', { details });
  }

  // ============================================
  // Query Methods
  // ============================================

  getEntries(options: {
    action?: AuditAction;
    resource?: AuditResource;
    userId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {}): AuditLogEntry[] {
    if (!this.ensureTenantLoaded()) return [];
    let filtered = [...this.entries];

    if (options.action) {
      filtered = filtered.filter(e => e.action === options.action);
    }

    if (options.resource) {
      filtered = filtered.filter(e => e.resource === options.resource);
    }

    if (options.userId) {
      filtered = filtered.filter(e => e.userId === options.userId);
    }

    if (options.startDate) {
      filtered = filtered.filter(e => e.timestamp >= options.startDate!);
    }

    if (options.endDate) {
      filtered = filtered.filter(e => e.timestamp <= options.endDate!);
    }

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  getRecentActivity(limit: number = 50): AuditLogEntry[] {
    return this.getEntries({ limit });
  }

  getSecurityEvents(): AuditLogEntry[] {
    if (!this.ensureTenantLoaded()) return [];
    return this.entries.filter(e => 
      e.action === 'LOGIN' || 
      e.action === 'LOGOUT' || 
      e.action === 'PASSWORD_CHANGE' ||
      e.action === 'PERMISSION_CHANGE' ||
      !e.success
    ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  getFailedActions(): AuditLogEntry[] {
    if (!this.ensureTenantLoaded()) return [];
    return this.entries.filter(e => !e.success)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // ============================================
  // Statistics
  // ============================================

  getStatistics(): {
    totalEntries: number;
    entriesByAction: Record<string, number>;
    entriesByResource: Record<string, number>;
    failedActions: number;
    oldestEntry: string | null;
    newestEntry: string | null;
  } {
    if (!this.ensureTenantLoaded()) {
      return { totalEntries: 0, entriesByAction: {}, entriesByResource: {}, failedActions: 0, oldestEntry: null, newestEntry: null };
    }
    const entriesByAction: Record<string, number> = {};
    const entriesByResource: Record<string, number> = {};
    let failedActions = 0;

    this.entries.forEach(entry => {
      entriesByAction[entry.action] = (entriesByAction[entry.action] || 0) + 1;
      entriesByResource[entry.resource] = (entriesByResource[entry.resource] || 0) + 1;
      if (!entry.success) failedActions++;
    });

    const sortedEntries = [...this.entries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return {
      totalEntries: this.entries.length,
      entriesByAction,
      entriesByResource,
      failedActions,
      oldestEntry: sortedEntries[0]?.timestamp || null,
      newestEntry: sortedEntries[sortedEntries.length - 1]?.timestamp || null
    };
  }

  // ============================================
  // Export & Management
  // ============================================

  exportLog(): string {
    this.ensureTenantLoaded();
    return JSON.stringify({
      exportDate: new Date().toISOString(),
      totalEntries: this.entries.length,
      entries: this.entries
    }, null, 2);
  }

  downloadLog(): void {
    const data = this.exportLog();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const filename = `chemcheck-audit-log-${new Date().toISOString().split('T')[0]}.json`;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Log the export action
    this.logExport('BACKUP', { filename, entryCount: this.entries.length });
  }

  clearLog(): void {
    if (!this.ensureTenantLoaded()) return;
    this.entries = [];
    this.saveEntries();
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private getCurrentUserInfo(): { userId: string } {
    const scope = getActiveTenantScope();
    return { userId: scope ? `tenant_${hashScope(scope.key)}` : 'anonymous' };
  }

  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private ensureTenantLoaded(): boolean {
    const scope = getActiveTenantScope();
    const nextStorageKey = scope ? `${STORAGE_KEY_PREFIX}${hashScope(scope.key)}` : null;
    if (nextStorageKey === this.storageKey) return Boolean(nextStorageKey);

    this.entries = [];
    this.storageKey = nextStorageKey;
    if (!nextStorageKey) return false;

    try {
      const data = localStorage.getItem(nextStorageKey);
      if (data) {
        this.entries = JSON.parse(data);
      }
    } catch (error) {
      console.warn('Failed to load audit log:', error);
      this.entries = [];
    }
    this.cleanOldEntries();
    return true;
  }

  private saveEntries(): void {
    if (!this.storageKey || !getActiveTenantScope()) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.entries));
    } catch (error) {
      console.warn('Failed to save audit log:', error);
    }
  }

  private trimEntries(): void {
    if (this.entries.length > MAX_ENTRIES) {
      // Keep only the most recent entries
      this.entries = this.entries
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, MAX_ENTRIES);
    }
  }

  private cleanOldEntries(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffTimestamp = cutoffDate.toISOString();

    const originalCount = this.entries.length;
    this.entries = this.entries.filter(e => e.timestamp >= cutoffTimestamp);

    if (this.entries.length !== originalCount) {
      this.saveEntries();
      console.log(`[AUDIT] Cleaned ${originalCount - this.entries.length} old entries`);
    }
  }
}

// Global audit logger instance
export const auditLog = new AuditLogger();

// Convenience exports
export const logCreate = (resource: AuditResource, resourceId: string, details?: Record<string, any>) =>
  auditLog.logCreate(resource, resourceId, details);

export const logUpdate = (resource: AuditResource, resourceId: string, details?: Record<string, any>) =>
  auditLog.logUpdate(resource, resourceId, details);

export const logDelete = (resource: AuditResource, resourceId: string, details?: Record<string, any>) =>
  auditLog.logDelete(resource, resourceId, details);

export const logLogin = (success: boolean, errorMessage?: string) =>
  auditLog.logLogin(success, errorMessage);

export const logLogout = () => auditLog.logLogout();

export const logBackup = (success: boolean, details?: Record<string, any>) =>
  auditLog.logBackup(success, details);

export const logRestore = (success: boolean, details?: Record<string, any>) =>
  auditLog.logRestore(success, details);
