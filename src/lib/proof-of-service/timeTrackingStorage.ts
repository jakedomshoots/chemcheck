/**
 * localStorage wrapper for time tracking state
 * Implements time tracking persistence for proof-of-service feature
 * Requirements: 3.5 - Preserve start time on app crash, 6.2 - Offline time tracking
 */

import { StoredTimeState, TimeTrackerState } from './types';

// ============================================
// Constants
// ============================================

const STORAGE_KEY_PREFIX = 'timeTracker_';
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// ============================================
// SSR Guard
// ============================================

/**
 * Check if localStorage is available (guards against SSR environments)
 * @returns True if localStorage is available and functional
 */
function isLocalStorageAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const testKey = '__localStorage_test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Time State Operations
// ============================================

/**
 * Get the storage key for a customer's time state
 * @param customerId - The customer ID
 * @returns The localStorage key
 */
function getStorageKey(customerId: string): string {
  return `${STORAGE_KEY_PREFIX}${customerId}`;
}

/**
 * Save time tracking state to localStorage
 * @param customerId - The customer ID
 * @param state - The time tracker state to save
 */
export function saveTimeState(customerId: string, state: TimeTrackerState): void {
  if (!state.startTime) {
    // If no start time, clear the state
    clearTimeState(customerId);
    return;
  }

  if (!isLocalStorageAvailable()) {
    return;
  }

  const storedState: StoredTimeState = {
    customerId,
    startTime: state.startTime,
    endTime: state.endTime,
    lastUpdated: Date.now(),
  };

  try {
    localStorage.setItem(getStorageKey(customerId), JSON.stringify(storedState));
  } catch (error) {
    // localStorage might be full or unavailable
    console.error('Failed to save time state to localStorage:', error);
  }
}

/**
 * Get time tracking state from localStorage
 * @param customerId - The customer ID
 * @returns The stored time state or null if not found
 */
export function getTimeState(customerId: string): StoredTimeState | null {
  if (!isLocalStorageAvailable()) {
    return null;
  }

  try {
    const stored = localStorage.getItem(getStorageKey(customerId));
    if (!stored) {
      return null;
    }

    const state: StoredTimeState = JSON.parse(stored);
    
    // Validate the parsed state has required fields
    if (!state.customerId || !state.startTime || typeof state.lastUpdated !== 'number') {
      return null;
    }

    return state;
  } catch (error) {
    // JSON parse error or localStorage unavailable
    console.error('Failed to get time state from localStorage:', error);
    return null;
  }
}

/**
 * Clear time tracking state from localStorage
 * @param customerId - The customer ID
 */
export function clearTimeState(customerId: string): void {
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    localStorage.removeItem(getStorageKey(customerId));
  } catch (error) {
    console.error('Failed to clear time state from localStorage:', error);
  }
}

/**
 * Convert stored time state to TimeTrackerState
 * @param stored - The stored time state
 * @returns The time tracker state
 */
export function storedToTimeTrackerState(stored: StoredTimeState | null): TimeTrackerState {
  if (!stored) {
    return {
      startTime: null,
      endTime: null,
      duration: null,
      isTracking: false,
    };
  }

  const startMs = new Date(stored.startTime).getTime();
  const endMs = stored.endTime ? new Date(stored.endTime).getTime() : null;
  const duration = endMs ? endMs - startMs : null;

  return {
    startTime: stored.startTime,
    endTime: stored.endTime,
    duration,
    isTracking: !stored.endTime, // Still tracking if no end time
  };
}

/**
 * Clean up stale time tracking entries (older than 24 hours)
 * This should be called periodically to prevent localStorage bloat
 */
export function cleanupStaleEntries(): void {
  if (!isLocalStorageAvailable()) {
    return;
  }

  const now = Date.now();
  const keysToRemove: string[] = [];

  try {
    // Iterate through all localStorage keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        const stored = localStorage.getItem(key);
        if (stored) {
          try {
            const state: StoredTimeState = JSON.parse(stored);
            // Check if the entry is stale (older than 24 hours)
            if (now - state.lastUpdated > STALE_THRESHOLD_MS) {
              keysToRemove.push(key);
            }
          } catch {
            // Invalid JSON, mark for removal
            keysToRemove.push(key);
          }
        }
      }
    }

    // Remove stale entries
    keysToRemove.forEach((key) => {
      localStorage.removeItem(key);
    });

    if (keysToRemove.length > 0) {
      console.log(`Cleaned up ${keysToRemove.length} stale time tracking entries`);
    }
  } catch (error) {
    console.error('Failed to cleanup stale entries:', error);
  }
}

/**
 * Get all active time tracking states (for debugging/admin purposes)
 * @returns Array of all stored time states
 */
export function getAllTimeStates(): StoredTimeState[] {
  if (!isLocalStorageAvailable()) {
    return [];
  }

  const states: StoredTimeState[] = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        const stored = localStorage.getItem(key);
        if (stored) {
          try {
            const state: StoredTimeState = JSON.parse(stored);
            states.push(state);
          } catch {
            // Skip invalid entries
          }
        }
      }
    }
  } catch (error) {
    console.error('Failed to get all time states:', error);
  }

  return states;
}

/**
 * Check if a time state exists for a customer
 * @param customerId - The customer ID
 * @returns True if a time state exists
 */
export function hasTimeState(customerId: string): boolean {
  return getTimeState(customerId) !== null;
}

/**
 * Update only the end time for an existing time state
 * @param customerId - The customer ID
 * @param endTime - The end time in ISO 8601 format
 */
export function updateEndTime(customerId: string, endTime: string): void {
  if (!isLocalStorageAvailable()) {
    return;
  }

  const existing = getTimeState(customerId);
  if (existing) {
    const updated: StoredTimeState = {
      ...existing,
      endTime,
      lastUpdated: Date.now(),
    };
    try {
      localStorage.setItem(getStorageKey(customerId), JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to update end time:', error);
    }
  }
}

// Export constants for testing
export { STORAGE_KEY_PREFIX, STALE_THRESHOLD_MS };
