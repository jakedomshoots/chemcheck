// ============================================
// Audit Logging System
// Tracks important user actions for security and compliance
// ============================================

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string;
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

const STORAGE_KEY = 'chemcheck_audit_log';
const MAX_ENTRIES = 1000;
const RETENTION_DAYS = 90;

class AuditLogger {
  private entries: AuditLogEntry[] = [];

  constructor() {
    this.loadEntries();
    this.cleanOldEntries();
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
    const { resourceId, details, success = true, errorMessage } = options;

    // Get current user info
    const currentUser = this.getCurrentUserInfo();

    const entry: AuditLogEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      userId: currentUser.userId,
      userEmail: currentUser.userEmail,
      action,
      resource,
      resourceId,
      details,
      userAgent: navigator.userAgent,
      success,
      errorMessage
    };

    this.entries.push(entry);
    this.trimEntries();
    this.saveEntries();

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[AUDIT] ${action} ${resource}`, entry);
    }

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
    return this.entries.filter(e => 
      e.action === 'LOGIN' || 
      e.action === 'LOGOUT' || 
      e.action === 'PASSWORD_CHANGE' ||
      e.action === 'PERMISSION_CHANGE' ||
      !e.success
    ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  getFailedActions(): AuditLogEntry[] {
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
    this.entries = [];
    this.saveEntries();
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private getCurrentUserInfo(): { userId: string; userEmail: string } {
    try {
      const userData = localStorage.getItem('chemcheck_current_user');
      if (userData) {
        const user = JSON.parse(userData);
        return {
          userId: user.id || 'unknown',
          userEmail: user.email || 'unknown'
        };
      }
    } catch (error) {
      console.warn('Failed to get current user for audit log:', error);
    }
    return { userId: 'anonymous', userEmail: 'anonymous' };
  }

  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private loadEntries(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.entries = JSON.parse(data);
      }
    } catch (error) {
      console.warn('Failed to load audit log:', error);
      this.entries = [];
    }
  }

  private saveEntries(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
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
