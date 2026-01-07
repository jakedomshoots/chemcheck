/**
 * Service Visit Summary Generation
 * Generates comprehensive summaries for completed service visits
 * Requirements: 4.1, 4.2
 */

import { formatDuration } from './timeUtils';

// ============================================
// Types
// ============================================

/**
 * Service log data from Convex database
 */
export interface ServiceLogData {
  _id: string;
  customer_id: string;
  service_date: string;
  status: string;
  notes?: string;
  ph: string;
  chlorine: string;
  alkalinity: string;
  stabilizer: string;
  salt?: number;
  // Proof-of-service fields
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  photo_count?: number;
  has_before_photos?: boolean;
  has_after_photos?: boolean;
}

/**
 * Customer data from Convex database
 */
export interface CustomerData {
  _id: string;
  full_name: string;
  address: string;
  phone?: string;
  email?: string;
  pool_type: string;
  surface_type: string;
}

/**
 * Chemical readings summary
 */
export interface ChemicalReadings {
  ph: string;
  chlorine: string;
  alkalinity: string;
  stabilizer: string;
  salt?: number;
}

/**
 * Proof-of-service metadata
 */
export interface ProofOfServiceMetadata {
  hasTimeTracking: boolean;
  startTime: string | null;
  endTime: string | null;
  durationMs: number | null;
  durationFormatted: string;
  hasPhotos: boolean;
  photoCount: number;
  hasBeforePhotos: boolean;
  hasAfterPhotos: boolean;
  isComplete: boolean;
}

/**
 * Complete service visit summary
 * Property 7: Service Summary Completeness
 * Validates: Requirements 4.2, 4.5
 */
export interface ServiceVisitSummary {
  // Required fields per Requirements 4.2
  serviceLogId: string;
  customerName: string;
  customerAddress: string;
  serviceDate: string;
  startTime: string | null;
  endTime: string | null;
  duration: number | null;
  durationFormatted: string;
  photoCount: number;
  chemicalReadings: ChemicalReadings;
  // Additional metadata
  status: string;
  notes: string | null;
  proofOfService: ProofOfServiceMetadata;
  poolType: string;
  surfaceType: string;
}


// ============================================
// Summary Generation Functions
// ============================================

/**
 * Generate proof-of-service metadata from service log data
 * @param log - Service log data
 * @returns Proof-of-service metadata
 */
export function generateProofOfServiceMetadata(log: ServiceLogData): ProofOfServiceMetadata {
  const hasTimeTracking = !!(log.start_time && log.end_time);
  const hasPhotos = (log.photo_count ?? 0) > 0;
  const hasBeforePhotos = log.has_before_photos ?? false;
  const hasAfterPhotos = log.has_after_photos ?? false;
  
  // Complete proof requires both time tracking and photos
  const isComplete = hasTimeTracking && hasPhotos;

  return {
    hasTimeTracking,
    startTime: log.start_time ?? null,
    endTime: log.end_time ?? null,
    durationMs: log.duration_ms ?? null,
    durationFormatted: formatDuration(log.duration_ms ?? null),
    hasPhotos,
    photoCount: log.photo_count ?? 0,
    hasBeforePhotos,
    hasAfterPhotos,
    isComplete,
  };
}

/**
 * Generate chemical readings from service log data
 * @param log - Service log data
 * @returns Chemical readings object
 */
export function generateChemicalReadings(log: ServiceLogData): ChemicalReadings {
  return {
    ph: log.ph,
    chlorine: log.chlorine,
    alkalinity: log.alkalinity,
    stabilizer: log.stabilizer,
    salt: log.salt,
  };
}

/**
 * Generate a complete service visit summary
 * Property 7: Service Summary Completeness
 * For any completed service log, the generated summary SHALL contain all required fields:
 * customer name, service date, start time, end time, duration, photo count, and chemical readings.
 * 
 * @param log - Service log data
 * @param customer - Customer data
 * @returns Complete service visit summary
 * 
 * Validates: Requirements 4.1, 4.2, 4.5
 */
export function generateServiceVisitSummary(
  log: ServiceLogData,
  customer: CustomerData
): ServiceVisitSummary {
  const proofOfService = generateProofOfServiceMetadata(log);
  const chemicalReadings = generateChemicalReadings(log);

  return {
    // Required fields per Requirements 4.2
    serviceLogId: log._id,
    customerName: customer.full_name,
    customerAddress: customer.address,
    serviceDate: log.service_date,
    startTime: proofOfService.startTime,
    endTime: proofOfService.endTime,
    duration: proofOfService.durationMs,
    durationFormatted: proofOfService.durationFormatted,
    photoCount: proofOfService.photoCount,
    chemicalReadings,
    // Additional metadata
    status: log.status,
    notes: log.notes ?? null,
    proofOfService,
    poolType: customer.pool_type,
    surfaceType: customer.surface_type,
  };
}

/**
 * Validate that a service visit summary contains the core required fields
 * for proof-of-service documentation.
 * 
 * Note: This validates the subset of fields required for proof-of-service:
 * - serviceLogId, customerName, serviceDate (identification)
 * - photoCount (proof documentation)
 * - chemicalReadings (service data)
 * 
 * Fields like customerAddress, status, poolType, surfaceType are included
 * in the summary but not validated here as they are supplementary metadata.
 * 
 * Property 7: Service Summary Completeness
 * 
 * @param summary - Service visit summary to validate
 * @returns True if summary contains all core required fields
 */
export function isValidServiceVisitSummary(summary: ServiceVisitSummary): boolean {
  // Check core required fields for proof-of-service documentation
  const hasRequiredFields = 
    typeof summary.serviceLogId === 'string' && summary.serviceLogId.length > 0 &&
    typeof summary.customerName === 'string' && summary.customerName.length > 0 &&
    typeof summary.serviceDate === 'string' && summary.serviceDate.length > 0 &&
    typeof summary.photoCount === 'number' &&
    summary.chemicalReadings !== null &&
    typeof summary.chemicalReadings.ph === 'string' &&
    typeof summary.chemicalReadings.chlorine === 'string' &&
    typeof summary.chemicalReadings.alkalinity === 'string' &&
    typeof summary.chemicalReadings.stabilizer === 'string';

  return hasRequiredFields;
}

/**
 * Check if a service log has complete proof-of-service documentation
 * @param log - Service log data
 * @returns True if log has both time tracking and photos
 */
export function hasCompleteProofOfService(log: ServiceLogData): boolean {
  const hasTimeTracking = !!(log.start_time && log.end_time);
  const hasPhotos = (log.photo_count ?? 0) > 0;
  return hasTimeTracking && hasPhotos;
}

/**
 * Check if a service log has any proof-of-service data
 * @param log - Service log data
 * @returns True if log has time tracking OR photos
 */
export function hasAnyProofOfService(log: ServiceLogData): boolean {
  const hasTimeTracking = !!(log.start_time && log.end_time);
  const hasPhotos = (log.photo_count ?? 0) > 0;
  return hasTimeTracking || hasPhotos;
}

/**
 * Get proof-of-service completion percentage
 * @param log - Service log data
 * @returns Percentage (0-100) of proof-of-service completion
 */
export function getProofOfServiceCompletionPercent(log: ServiceLogData): number {
  let score = 0;
  const maxScore = 4; // time tracking, before photos, after photos, any photos

  if (log.start_time && log.end_time) score += 1;
  if (log.has_before_photos) score += 1;
  if (log.has_after_photos) score += 1;
  if ((log.photo_count ?? 0) > 0) score += 1;

  return Math.round((score / maxScore) * 100);
}
