import { useState, useEffect, useCallback } from 'react';
import { migrationService, MigrationStatus, MigrationResult } from '@/lib/sync/MigrationService';

export interface UseMigrationReturn {
  // Migration status
  status: MigrationStatus;
  
  // Check if migration is required
  checkMigrationRequired: () => Promise<boolean>;
  
  // Start migration process
  startMigration: () => Promise<MigrationResult>;
  
  // Resume migration from failure
  resumeMigration: () => Promise<MigrationResult>;
  
  // Verify data integrity after migration
  verifyDataIntegrity: () => Promise<{ success: boolean; discrepancies: string[] }>;
  
  // Cancel ongoing migration
  cancelMigration: () => void;
  
  // Check if migration is in progress
  isMigrationInProgress: boolean;
}

/**
 * React hook for managing data migration from Dexie to Convex
 * Provides migration status, progress tracking, and control functions
 */
export function useMigration(): UseMigrationReturn {
  const [status, setStatus] = useState<MigrationStatus>(migrationService.getMigrationStatus());
  const [isMigrationInProgress, setIsMigrationInProgress] = useState(migrationService.isMigrationInProgress());

  // Subscribe to migration status changes
  useEffect(() => {
    const unsubscribe = migrationService.onMigrationStatusChange((newStatus) => {
      setStatus(newStatus);
      setIsMigrationInProgress(migrationService.isMigrationInProgress());
    });

    // Initial status check
    setIsMigrationInProgress(migrationService.isMigrationInProgress());

    return unsubscribe;
  }, []);

  const checkMigrationRequired = useCallback(async (): Promise<boolean> => {
    try {
      return await migrationService.checkMigrationRequired();
    } catch (error) {
      console.error('Failed to check migration requirement:', error);
      return false;
    }
  }, []);

  const startMigration = useCallback(async (): Promise<MigrationResult> => {
    try {
      const result = await migrationService.startMigration();
      return result;
    } catch (error) {
      throw error;
    }
  }, []);

  const resumeMigration = useCallback(async (): Promise<MigrationResult> => {
    try {
      const result = await migrationService.resumeMigration();
      return result;
    } catch (error) {
      throw error;
    }
  }, []);

  const verifyDataIntegrity = useCallback(async () => {
    try {
      return await migrationService.verifyDataIntegrity();
    } catch (error) {
      console.error('Failed to verify data integrity:', error);
      return {
        success: false,
        discrepancies: [`Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }, []);

  const cancelMigration = useCallback(() => {
    migrationService.cancelMigration();
  }, []);

  return {
    status,
    checkMigrationRequired,
    startMigration,
    resumeMigration,
    verifyDataIntegrity,
    cancelMigration,
    isMigrationInProgress,
  };
}

/**
 * Hook for checking migration requirement on app startup
 * Useful for showing migration prompts when needed
 */
export function useMigrationCheck() {
  const [isRequired, setIsRequired] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const checkMigration = async () => {
      try {
        const required = await migrationService.checkMigrationRequired();
        if (mounted) {
          setIsRequired(required);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to check migration');
          setLoading(false);
        }
      }
    };

    checkMigration();

    return () => {
      mounted = false;
    };
  }, []);

  return {
    isRequired,
    loading,
    error,
  };
}