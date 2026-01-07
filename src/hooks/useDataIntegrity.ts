import { useState, useCallback, useEffect, useRef } from 'react';
import { dataIntegrityService, DataIntegrityReport } from '@/lib/sync/DataIntegrityService';

export interface UseDataIntegrityReturn {
  // Perform comprehensive integrity check
  performIntegrityCheck: () => Promise<DataIntegrityReport>;
  
  // Quick integrity check
  quickIntegrityCheck: () => Promise<{ success: boolean; summary: string }>;
  
  // Fix common integrity issues
  fixIntegrityIssues: () => Promise<{ fixed: number; errors: string[] }>;
  
  // Loading state
  loading: boolean;
  
  // Last check result
  lastReport: DataIntegrityReport | null;
}

/**
 * React hook for data integrity checking and fixing
 * Provides functions to verify and repair data consistency between Dexie and Convex
 */
export function useDataIntegrity(): UseDataIntegrityReturn {
  const isMountedRef = useRef(true);
  const [loading, setLoading] = useState(false);
  const [lastReport, setLastReport] = useState<DataIntegrityReport | null>(null);
  const loadingCountRef = useRef(0);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const startLoading = useCallback(() => {
    loadingCountRef.current++;
    if (isMountedRef.current) {
      setLoading(true);
    }
  }, []);

  const endLoading = useCallback(() => {
    loadingCountRef.current--;
    if (loadingCountRef.current === 0 && isMountedRef.current) {
      setLoading(false);
    }
  }, []);

  const performIntegrityCheck = useCallback(async (): Promise<DataIntegrityReport> => {
    startLoading();
    try {
      const report = await dataIntegrityService.performIntegrityCheck();
      if (isMountedRef.current) {
        setLastReport(report);
      }
      return report;
    } catch (error) {
      console.error('Integrity check failed:', error);
      const errorReport: DataIntegrityReport = {
        success: false,
        timestamp: Date.now(),
        totalLocalRecords: 0,
        totalSyncedRecords: 0,
        totalPendingRecords: 0,
        totalErrorRecords: 0,
        tableResults: [],
        overallDiscrepancies: [`Check failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
      if (isMountedRef.current) {
        setLastReport(errorReport);
      }
      return errorReport;
    } finally {
      endLoading();
    }
  }, [startLoading, endLoading]);

  const quickIntegrityCheck = useCallback(async () => {
    startLoading();
    try {
      return await dataIntegrityService.quickIntegrityCheck();
    } catch (error) {
      console.error('Quick integrity check failed:', error);
      return {
        success: false,
        summary: `Check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    } finally {
      endLoading();
    }
  }, [startLoading, endLoading]);

  const fixIntegrityIssues = useCallback(async () => {
    startLoading();
    try {
      return await dataIntegrityService.fixIntegrityIssues();
    } catch (error) {
      console.error('Fix integrity issues failed:', error);
      return {
        fixed: 0,
        errors: [`Fix failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    } finally {
      endLoading();
    }
  }, [startLoading, endLoading]);

  return {
    performIntegrityCheck,
    quickIntegrityCheck,
    fixIntegrityIssues,
    loading,
    lastReport,
  };
}