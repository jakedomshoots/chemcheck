/**
 * Time Tracking Utilities
 * 
 * Provides timezone conversion, duration calculation, and formatting utilities
 * for the proof-of-service time tracking feature.
 * 
 * Requirements: 3.3 - Duration calculation
 * Requirements: 3.6 - Store times in UTC, display in local timezone
 */

// ============================================
// UTC Time Generation
// ============================================

/**
 * Generate a timestamp in ISO 8601 UTC format
 * All times are stored in UTC for consistency
 * 
 * @returns ISO 8601 formatted UTC timestamp
 */
export function generateUTCTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Convert a Date object to UTC ISO 8601 string
 * 
 * @param date - The date to convert
 * @returns ISO 8601 formatted UTC timestamp
 */
export function toUTCString(date: Date): string {
  return date.toISOString();
}

/**
 * Parse an ISO 8601 string to a Date object
 * 
 * @param isoString - ISO 8601 formatted string
 * @returns Date object or null if invalid
 */
export function parseUTCString(isoString: string): Date | null {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch {
    return null;
  }
}

// ============================================
// Timezone Conversion
// ============================================

/**
 * Convert a UTC timestamp to local timezone for display
 * 
 * @param utcTimestamp - ISO 8601 UTC timestamp
 * @returns Formatted local time string
 */
export function utcToLocalDisplay(utcTimestamp: string): string {
  const date = parseUTCString(utcTimestamp);
  if (!date) {
    return 'Invalid time';
  }
  
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Convert a UTC timestamp to local date and time for display
 * 
 * @param utcTimestamp - ISO 8601 UTC timestamp
 * @returns Formatted local date and time string
 */
export function utcToLocalDateTimeDisplay(utcTimestamp: string): string {
  const date = parseUTCString(utcTimestamp);
  if (!date) {
    return 'Invalid date/time';
  }
  
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Get the user's current timezone name
 * 
 * @returns Timezone name (e.g., "America/New_York")
 */
export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Check if a timestamp is in valid UTC ISO 8601 format
 * 
 * @param timestamp - The timestamp to validate
 * @returns True if valid UTC format
 */
export function isValidUTCTimestamp(timestamp: string): boolean {
  if (!timestamp || typeof timestamp !== 'string') {
    return false;
  }
  
  // Check for ISO 8601 format with Z suffix (UTC)
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
  if (!iso8601Regex.test(timestamp)) {
    return false;
  }
  
  const date = parseUTCString(timestamp);
  return date !== null;
}

// ============================================
// Duration Calculation
// ============================================

/**
 * Calculate duration between two timestamps in milliseconds
 * 
 * @param startTime - Start time in ISO 8601 format
 * @param endTime - End time in ISO 8601 format
 * @returns Duration in milliseconds, or 0 if invalid
 */
export function calculateDuration(startTime: string, endTime: string): number {
  const start = parseUTCString(startTime);
  const end = parseUTCString(endTime);
  
  if (!start || !end) {
    return 0;
  }
  
  const duration = end.getTime() - start.getTime();
  
  // Duration should be non-negative
  return Math.max(0, duration);
}

/**
 * Format duration in milliseconds to human-readable string
 * 
 * @param durationMs - Duration in milliseconds, or null for unknown duration
 * @returns Formatted string like "45 min", "1h 23min", or "--" for null/unknown
 */
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return '--';
  }
  
  if (durationMs < 0 || !Number.isFinite(durationMs)) {
    return '0 min';
  }
  
  const totalSeconds = Math.floor(durationMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours === 0) {
    return `${minutes} min`;
  }
  
  if (minutes === 0) {
    return `${hours}h`;
  }
  
  return `${hours}h ${minutes}min`;
}

/**
 * Format duration for detailed display (includes seconds)
 * 
 * @param durationMs - Duration in milliseconds
 * @returns Formatted string like "1:23:45" (h:mm:ss)
 */
export function formatDurationDetailed(durationMs: number): string {
  if (durationMs < 0 || !Number.isFinite(durationMs)) {
    return '0:00:00';
  }
  
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

// ============================================
// Time Validation
// ============================================

/**
 * Validate that a time is not in the future
 * 
 * @param timestamp - ISO 8601 timestamp to validate
 * @returns True if the time is not in the future
 */
export function isNotInFuture(timestamp: string): boolean {
  const date = parseUTCString(timestamp);
  if (!date) {
    return false;
  }
  
  return date.getTime() <= Date.now();
}

/**
 * Validate that a time is within a reasonable range (not more than 24h ago)
 * 
 * @param timestamp - ISO 8601 timestamp to validate
 * @returns True if the time is within 24 hours
 */
export function isWithin24Hours(timestamp: string): boolean {
  const date = parseUTCString(timestamp);
  if (!date) {
    return false;
  }
  
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
  
  return date.getTime() >= twentyFourHoursAgo && date.getTime() <= now;
}

/**
 * Validate that end time is at or after start time
 * Allows zero-duration events (start === end)
 * 
 * @param startTime - Start time in ISO 8601 format
 * @param endTime - End time in ISO 8601 format
 * @returns True if end time is at or after start time
 */
export function isEndAtOrAfterStart(startTime: string, endTime: string): boolean {
  const start = parseUTCString(startTime);
  const end = parseUTCString(endTime);
  
  if (!start || !end) {
    return false;
  }
  
  return end.getTime() >= start.getTime();
}

/**
 * @deprecated Use isEndAtOrAfterStart instead. This alias exists for backward compatibility.
 */
export const isEndAfterStart = isEndAtOrAfterStart;
