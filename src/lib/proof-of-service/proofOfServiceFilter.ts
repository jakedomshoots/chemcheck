/**
 * Proof-of-Service Filtering
 * Provides filtering functions for service logs based on proof-of-service completeness
 * 
 * Property 9: Proof-of-Service Filter Accuracy
 * For any filter query on service logs by proof-of-service completeness,
 * the returned logs SHALL match the filter criteria (has photos, has time tracking).
 * 
 * Requirements: 4.4
 */

import { ServiceLogData } from './serviceSummary';

// ============================================
// Filter Types
// ============================================

/**
 * Available proof-of-service filter options
 */
export type ProofOfServiceFilterType = 
  | 'all'           // No filter - show all logs
  | 'has_photos'    // Logs with at least one photo
  | 'has_time'      // Logs with time tracking (start and end time)
  | 'complete'      // Logs with both photos AND time tracking
  | 'incomplete';   // Logs missing photos OR time tracking

/**
 * Filter configuration for UI
 */
export interface ProofOfServiceFilterOption {
  value: ProofOfServiceFilterType;
  label: string;
  description: string;
}

// ============================================
// Filter Options Configuration
// ============================================

/**
 * Available filter options for UI display
 */
export const PROOF_OF_SERVICE_FILTER_OPTIONS: ProofOfServiceFilterOption[] = [
  {
    value: 'all',
    label: 'All Logs',
    description: 'Show all service logs',
  },
  {
    value: 'has_photos',
    label: 'Has Photos',
    description: 'Logs with photo documentation',
  },
  {
    value: 'has_time',
    label: 'Has Time Tracking',
    description: 'Logs with recorded duration',
  },
  {
    value: 'complete',
    label: 'Complete Proof',
    description: 'Logs with both photos and time tracking',
  },
  {
    value: 'incomplete',
    label: 'Incomplete Proof',
    description: 'Logs missing photos or time tracking',
  },
];

// ============================================
// Filter Predicate Functions
// ============================================

/**
 * Check if a service log has photos
 * @param log - Service log data
 * @returns True if log has at least one photo
 */
export function hasPhotos(log: ServiceLogData): boolean {
  return (log.photo_count ?? 0) > 0;
}

/**
 * Check if a service log has time tracking
 * @param log - Service log data
 * @returns True if log has both start and end time
 */
export function hasTimeTracking(log: ServiceLogData): boolean {
  return !!(log.start_time && log.end_time);
}

/**
 * Check if a service log has complete proof-of-service
 * @param log - Service log data
 * @returns True if log has both photos AND time tracking
 */
export function hasCompleteProof(log: ServiceLogData): boolean {
  return hasPhotos(log) && hasTimeTracking(log);
}

/**
 * Check if a service log has incomplete proof-of-service
 * @param log - Service log data
 * @returns True if log is missing photos OR time tracking
 */
export function hasIncompleteProof(log: ServiceLogData): boolean {
  return !hasCompleteProof(log);
}

// ============================================
// Main Filter Function
// ============================================

/**
 * Filter service logs by proof-of-service criteria
 * 
 * Property 9: Proof-of-Service Filter Accuracy
 * For any filter query on service logs by proof-of-service completeness,
 * the returned logs SHALL match the filter criteria.
 * 
 * @param logs - Array of service logs to filter
 * @param filterType - Type of filter to apply
 * @returns Filtered array of service logs
 * 
 * Validates: Requirements 4.4
 */
export function filterByProofOfService<T extends ServiceLogData>(
  logs: T[],
  filterType: ProofOfServiceFilterType
): T[] {
  switch (filterType) {
    case 'all':
      return logs;
    
    case 'has_photos':
      return logs.filter(hasPhotos);
    
    case 'has_time':
      return logs.filter(hasTimeTracking);
    
    case 'complete':
      return logs.filter(hasCompleteProof);
    
    case 'incomplete':
      return logs.filter(hasIncompleteProof);
    
    default:
      // Exhaustive check - TypeScript will error if a case is missed
      const _exhaustiveCheck: never = filterType;
      return logs;
  }
}

/**
 * Get filter statistics for a set of logs
 * Useful for showing counts in filter UI
 * 
 * @param logs - Array of service logs
 * @returns Object with counts for each filter type
 */
export function getFilterCounts<T extends ServiceLogData>(
  logs: T[]
): Record<ProofOfServiceFilterType, number> {
  return {
    all: logs.length,
    has_photos: logs.filter(hasPhotos).length,
    has_time: logs.filter(hasTimeTracking).length,
    complete: logs.filter(hasCompleteProof).length,
    incomplete: logs.filter(hasIncompleteProof).length,
  };
}

/**
 * Validate that a filter result matches the expected criteria
 * Used for testing Property 9
 * 
 * @param log - Service log to validate
 * @param filterType - Filter type that was applied
 * @returns True if log matches the filter criteria
 */
export function validateFilterResult(
  log: ServiceLogData,
  filterType: ProofOfServiceFilterType
): boolean {
  switch (filterType) {
    case 'all':
      return true;
    
    case 'has_photos':
      return hasPhotos(log);
    
    case 'has_time':
      return hasTimeTracking(log);
    
    case 'complete':
      return hasCompleteProof(log);
    
    case 'incomplete':
      return hasIncompleteProof(log);
    
    default:
      return false;
  }
}
