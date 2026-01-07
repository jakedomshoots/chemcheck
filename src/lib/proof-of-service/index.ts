/**
 * Proof of Service module
 * Exports all types and utilities for photo documentation and time tracking
 */

// Types
export * from './types';

// Photo storage
export {
  savePhoto,
  getPhotos,
  getPhotosByServiceLog,
  getPhotoById,
  deletePhoto,
  deletePhotosByCustomer,
  deleteUnlinkedPhotos,
  linkPhotosToServiceLog,
  updateSyncStatus,
  getPendingPhotos,
  getPhotoCounts,
  getTotalPhotoCount,
  recordToCapturedPhoto,
  clearAllPhotos,
  isDatabaseAccessible,
  offlinePhotoDb,
  PhotoStorageError,
} from './offlinePhotoStorage';

// Time tracking storage
export {
  saveTimeState,
  getTimeState,
  clearTimeState,
  storedToTimeTrackerState,
  cleanupStaleEntries,
  getAllTimeStates,
  hasTimeState,
  updateEndTime,
  STORAGE_KEY_PREFIX,
  STALE_THRESHOLD_MS,
} from './timeTrackingStorage';

// Photo utilities
export {
  validatePhotoMetadata,
  validateGeoLocation,
  generateTimestamp,
  isValidISO8601,
  validateTimestampWithinRange,
  getCurrentLocation,
  createCapturedPhoto,
  type PhotoValidationResult,
  type TimestampValidationResult,
  type GeolocationOptions,
  type GeolocationResult,
} from './photoUtils';

// Time utilities
export {
  generateUTCTimestamp,
  toUTCString,
  parseUTCString,
  utcToLocalDisplay,
  utcToLocalDateTimeDisplay,
  getUserTimezone,
  isValidUTCTimestamp,
  calculateDuration,
  formatDuration,
  formatDurationDetailed,
  isNotInFuture,
  isWithin24Hours,
  isEndAtOrAfterStart,
  isEndAfterStart, // deprecated alias for backward compatibility
} from './timeUtils';

// Photo sync service
export {
  syncPendingPhotos,
  retrySyncFailedPhotos,
  syncSinglePhoto,
  enableAutoSync,
  disableAutoSync,
  isAutoSyncEnabled,
  getServiceLogSyncStatus,
  getPendingPhotoCount,
  onSyncProgress,
  getSyncProgress,
  isOnline,
  type SyncResult,
  type SyncProgress,
  type ConvexClient,
  type SyncServiceConfig,
} from './photoSyncService';

// Service summary generation
export {
  generateServiceVisitSummary,
  generateProofOfServiceMetadata,
  generateChemicalReadings,
  isValidServiceVisitSummary,
  hasCompleteProofOfService,
  hasAnyProofOfService,
  getProofOfServiceCompletionPercent,
  type ServiceLogData,
  type CustomerData,
  type ChemicalReadings,
  type ProofOfServiceMetadata,
  type ServiceVisitSummary,
} from './serviceSummary';

// Proof-of-service filtering
export {
  filterByProofOfService,
  hasPhotos,
  hasTimeTracking,
  hasCompleteProof,
  hasIncompleteProof,
  getFilterCounts,
  validateFilterResult,
  PROOF_OF_SERVICE_FILTER_OPTIONS,
  type ProofOfServiceFilterType,
  type ProofOfServiceFilterOption,
} from './proofOfServiceFilter';

// Requirement validation
export {
  validateServiceCompletion,
  getEffectiveRequirements,
  formatValidationErrors,
  getValidationErrorMessage,
  hasAnyRequirements,
  getRequirementsSummary,
} from './requirementValidation';
