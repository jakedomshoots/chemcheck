// Cloud Backup Integration
// Provides optional cloud storage for backups while maintaining offline-first approach

import { createBackup, restoreFromBackup, BackupData } from './backup';
import { monitoring } from './monitoring';
import { userManager } from './userManager';

export interface CloudProvider {
  id: string;
  name: string;
  icon: string;
  isConfigured: boolean;
  lastSync?: string;
}

export interface CloudBackupConfig {
  provider: string;
  autoSync: boolean;
  syncInterval: number; // hours
  encryptBackups: boolean;
  maxBackups: number;
}

class CloudBackupManager {
  private config: CloudBackupConfig | null = null;
  private syncInterval: number | null = null;

  constructor() {
    this.loadConfig();
  }

  // ============================================
  // Configuration
  // ============================================

  getAvailableProviders(): CloudProvider[] {
    return [
      {
        id: 'google-drive',
        name: 'Google Drive',
        icon: '📁',
        isConfigured: this.isProviderConfigured('google-drive')
      },
      {
        id: 'dropbox',
        name: 'Dropbox',
        icon: '📦',
        isConfigured: this.isProviderConfigured('dropbox')
      },
      {
        id: 'onedrive',
        name: 'OneDrive',
        icon: '☁️',
        isConfigured: this.isProviderConfigured('onedrive')
      },
      {
        id: 'webdav',
        name: 'WebDAV',
        icon: '🌐',
        isConfigured: this.isProviderConfigured('webdav')
      }
    ];
  }

  async configureProvider(providerId: string, credentials: any): Promise<boolean> {
    try {
      // Store encrypted credentials
      const encryptedCredentials = await this.encryptCredentials(credentials);
      localStorage.setItem(`cloudBackup_${providerId}`, encryptedCredentials);
      
      // Test connection
      const testResult = await this.testConnection(providerId);
      if (!testResult.success) {
        throw new Error(testResult.error);
      }

      monitoring.recordMetric('cloud_provider_configured', performance.now(), {
        provider: providerId
      });

      return true;
    } catch (error) {
      console.error(`Failed to configure ${providerId}:`, error);
      monitoring.reportError({
        message: `Cloud provider configuration failed: ${providerId}`,
        severity: 'medium',
        metadata: { provider: providerId, error: error instanceof Error ? error.message : 'Unknown error' }
      });
      return false;
    }
  }

  updateConfig(newConfig: Partial<CloudBackupConfig>): void {
    this.config = {
      ...this.getDefaultConfig(),
      ...this.config,
      ...newConfig
    };
    
    localStorage.setItem('cloudBackup_config', JSON.stringify(this.config));
    
    // Restart sync if needed
    if (this.config.autoSync) {
      this.startAutoSync();
    } else {
      this.stopAutoSync();
    }
  }

  getConfig(): CloudBackupConfig {
    return this.config || this.getDefaultConfig();
  }

  // ============================================
  // Backup Operations
  // ============================================

  async uploadBackup(providerId?: string): Promise<{
    success: boolean;
    backupId?: string;
    error?: string;
  }> {
    try {
      const config = this.getConfig();
      const provider = providerId || config.provider;
      
      if (!provider || !this.isProviderConfigured(provider)) {
        throw new Error('Cloud provider not configured');
      }

      // Create backup
      const backup = await createBackup();
      
      // Add metadata
      const cloudBackup = {
        ...backup,
        cloudMetadata: {
          uploadedAt: new Date().toISOString(),
          uploadedBy: userManager.getCurrentUser()?.id || 'unknown',
          provider: provider,
          encrypted: config.encryptBackups
        }
      };

      // Encrypt if enabled
      let backupData = JSON.stringify(cloudBackup);
      if (config.encryptBackups) {
        backupData = await this.encryptBackup(backupData);
      }

      // Upload to provider
      const backupId = await this.uploadToProvider(provider, backupData);
      
      // Update last sync time
      this.updateLastSync(provider);
      
      monitoring.recordMetric('cloud_backup_upload', performance.now(), {
        provider,
        size: backupData.length,
        encrypted: config.encryptBackups
      });

      return { success: true, backupId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      monitoring.reportError({
        message: 'Cloud backup upload failed',
        severity: 'medium',
        metadata: { provider: providerId, error: errorMsg }
      });
      return { success: false, error: errorMsg };
    }
  }

  async downloadBackup(backupId: string, providerId?: string): Promise<{
    success: boolean;
    backup?: BackupData;
    error?: string;
  }> {
    try {
      const config = this.getConfig();
      const provider = providerId || config.provider;
      
      if (!provider || !this.isProviderConfigured(provider)) {
        throw new Error('Cloud provider not configured');
      }

      // Download from provider
      let backupData = await this.downloadFromProvider(provider, backupId);
      
      // Decrypt if needed
      if (config.encryptBackups) {
        backupData = await this.decryptBackup(backupData);
      }

      const backup = JSON.parse(backupData);
      
      monitoring.recordMetric('cloud_backup_download', performance.now(), {
        provider,
        size: backupData.length
      });

      return { success: true, backup };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      monitoring.reportError({
        message: 'Cloud backup download failed',
        severity: 'medium',
        metadata: { provider: providerId, backupId, error: errorMsg }
      });
      return { success: false, error: errorMsg };
    }
  }

  async listBackups(providerId?: string): Promise<{
    success: boolean;
    backups?: Array<{
      id: string;
      name: string;
      size: number;
      uploadedAt: string;
      metadata?: any;
    }>;
    error?: string;
  }> {
    try {
      const config = this.getConfig();
      const provider = providerId || config.provider;
      
      if (!provider || !this.isProviderConfigured(provider)) {
        throw new Error('Cloud provider not configured');
      }

      const backups = await this.listFromProvider(provider);
      return { success: true, backups };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }

  async restoreFromCloud(backupId: string, providerId?: string): Promise<{
    success: boolean;
    imported?: {
      customers: number;
      serviceLogs: number;
      chemicalUsage: number;
      notes: number;
    };
    errors?: string[];
  }> {
    try {
      const downloadResult = await this.downloadBackup(backupId, providerId);
      if (!downloadResult.success || !downloadResult.backup) {
        throw new Error(downloadResult.error || 'Failed to download backup');
      }

      const restoreResult = await restoreFromBackup(downloadResult.backup, {
        clearExisting: false,
        mergeStrategy: 'replace'
      });

      monitoring.recordMetric('cloud_backup_restore', performance.now(), {
        provider: providerId,
        backupId
      });

      return restoreResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      monitoring.reportError({
        message: 'Cloud backup restore failed',
        severity: 'high',
        metadata: { provider: providerId, backupId, error: errorMsg }
      });
      return {
        success: false,
        errors: [errorMsg]
      };
    }
  }

  // ============================================
  // Auto Sync
  // ============================================

  startAutoSync(): void {
    this.stopAutoSync();
    
    const config = this.getConfig();
    if (!config.autoSync || !config.provider) return;

    this.syncInterval = window.setInterval(() => {
      this.performAutoSync();
    }, config.syncInterval * 60 * 60 * 1000); // Convert hours to milliseconds

    console.log(`Auto-sync started for ${config.provider} every ${config.syncInterval} hours`);
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  private async performAutoSync(): Promise<void> {
    try {
      const config = this.getConfig();
      if (!config.provider || !navigator.onLine) return;

      console.log('Performing auto-sync to cloud...');
      const result = await this.uploadBackup();
      
      if (result.success) {
        console.log('Auto-sync completed successfully');
        
        // Clean up old backups if needed
        await this.cleanupOldBackups();
      } else {
        console.error('Auto-sync failed:', result.error);
      }
    } catch (error) {
      console.error('Auto-sync error:', error);
    }
  }

  private async cleanupOldBackups(): Promise<void> {
    try {
      const config = this.getConfig();
      const listResult = await this.listBackups();
      
      if (!listResult.success || !listResult.backups) return;

      const backups = listResult.backups
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

      if (backups.length > config.maxBackups) {
        const toDelete = backups.slice(config.maxBackups);
        
        for (const backup of toDelete) {
          await this.deleteFromProvider(config.provider, backup.id);
        }
        
        console.log(`Cleaned up ${toDelete.length} old backups`);
      }
    } catch (error) {
      console.error('Backup cleanup failed:', error);
    }
  }

  // ============================================
  // Provider Implementations
  // ============================================

  private async testConnection(providerId: string): Promise<{ success: boolean; error?: string }> {
    // This would implement actual provider testing
    // For now, return success for demo purposes
    return { success: true };
  }

  private async uploadToProvider(providerId: string, data: string): Promise<string> {
    // This would implement actual provider upload
    // For now, simulate with localStorage
    const backupId = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(`cloudBackup_${providerId}_${backupId}`, data);
    return backupId;
  }

  private async downloadFromProvider(providerId: string, backupId: string): Promise<string> {
    // This would implement actual provider download
    const data = localStorage.getItem(`cloudBackup_${providerId}_${backupId}`);
    if (!data) throw new Error('Backup not found');
    return data;
  }

  private async listFromProvider(providerId: string): Promise<Array<{
    id: string;
    name: string;
    size: number;
    uploadedAt: string;
  }>> {
    // This would implement actual provider listing
    const backups = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`cloudBackup_${providerId}_`)) {
        const backupId = key.replace(`cloudBackup_${providerId}_`, '');
        const data = localStorage.getItem(key);
        if (data) {
          backups.push({
            id: backupId,
            name: `Backup ${backupId}`,
            size: data.length,
            uploadedAt: new Date().toISOString()
          });
        }
      }
    }
    return backups;
  }

  private async deleteFromProvider(providerId: string, backupId: string): Promise<void> {
    localStorage.removeItem(`cloudBackup_${providerId}_${backupId}`);
  }

  // ============================================
  // Encryption
  // ============================================

  private async encryptCredentials(credentials: any): Promise<string> {
    // Simple base64 encoding for demo - use proper encryption in production
    return btoa(JSON.stringify(credentials));
  }

  private async encryptBackup(data: string): Promise<string> {
    // Simple base64 encoding for demo - use proper encryption in production
    return btoa(data);
  }

  private async decryptBackup(data: string): Promise<string> {
    // Simple base64 decoding for demo - use proper decryption in production
    return atob(data);
  }

  // ============================================
  // Helper Methods
  // ============================================

  private loadConfig(): void {
    try {
      const stored = localStorage.getItem('cloudBackup_config');
      this.config = stored ? JSON.parse(stored) : this.getDefaultConfig();
    } catch {
      this.config = this.getDefaultConfig();
    }
  }

  private getDefaultConfig(): CloudBackupConfig {
    return {
      provider: '',
      autoSync: false,
      syncInterval: 24, // 24 hours
      encryptBackups: true,
      maxBackups: 10
    };
  }

  private isProviderConfigured(providerId: string): boolean {
    return localStorage.getItem(`cloudBackup_${providerId}`) !== null;
  }

  private updateLastSync(providerId: string): void {
    const providers = this.getAvailableProviders();
    const provider = providers.find(p => p.id === providerId);
    if (provider) {
      provider.lastSync = new Date().toISOString();
      localStorage.setItem(`cloudBackup_${providerId}_lastSync`, provider.lastSync);
    }
  }
}

// Global cloud backup manager
export const cloudBackupManager = new CloudBackupManager();

// Convenience functions
export const uploadToCloud = (providerId?: string) => cloudBackupManager.uploadBackup(providerId);
export const downloadFromCloud = (backupId: string, providerId?: string) => 
  cloudBackupManager.downloadBackup(backupId, providerId);
export const listCloudBackups = (providerId?: string) => cloudBackupManager.listBackups(providerId);
export const restoreFromCloud = (backupId: string, providerId?: string) => 
  cloudBackupManager.restoreFromCloud(backupId, providerId);