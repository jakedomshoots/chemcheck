/**
 * useTimeTracker Hook
 * 
 * A custom React hook that manages automatic time tracking for service visits.
 * Implements start/stop tracking, duration calculation, and localStorage persistence.
 * 
 * Requirements: 3.1, 3.2, 3.3 - Automatic time tracking with duration calculation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  saveTimeState,
  getTimeState,
  clearTimeState,
  storedToTimeTrackerState,
} from '@/lib/proof-of-service/timeTrackingStorage';
import type { TimeTrackerState } from '@/lib/proof-of-service/types';
import {
  generateUTCTimestamp,
  formatDuration,
  calculateDuration,
} from '@/lib/proof-of-service/timeUtils';

export interface UseTimeTrackerReturn {
  state: TimeTrackerState;
  startTracking: () => void;
  stopTracking: () => void;
  getDurationDisplay: () => string;
  resetTracking: () => void;
}

/**
 * Custom hook for managing time tracking during service visits
 * 
 * @param customerId - The customer ID to track time for
 * @returns Time tracking state and control functions
 */
export function useTimeTracker(customerId: string): UseTimeTrackerReturn {
  // Initialize state - will be updated when customerId changes
  const [state, setState] = useState<TimeTrackerState>(() => {
    const stored = getTimeState(customerId);
    return storedToTimeTrackerState(stored);
  });

  // Track the current customerId to detect changes
  const customerIdRef = useRef(customerId);

  // Ref to track interval for live duration updates
  const intervalRef = useRef<number | null>(null);

  // Track if we need to persist (only on significant state changes)
  const shouldPersistRef = useRef(false);

  // Reload state when customerId changes
  useEffect(() => {
    if (customerIdRef.current !== customerId) {
      // Clean up interval from previous customer
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      // Load state for new customer
      const stored = getTimeState(customerId);
      setState(storedToTimeTrackerState(stored));
      customerIdRef.current = customerId;
      shouldPersistRef.current = false;
    }
  }, [customerId]);

  // Update duration while tracking is active
  useEffect(() => {
    if (state.isTracking && state.startTime) {
      // Update duration every second while tracking
      const updateDuration = () => {
        const now = new Date().getTime();
        const start = new Date(state.startTime!).getTime();
        const duration = now - start;
        
        // Only update duration, don't trigger persistence
        setState((prev: TimeTrackerState) => ({
          ...prev,
          duration,
        }));
      };

      // Initial update
      updateDuration();

      // Set up interval for live updates
      intervalRef.current = window.setInterval(updateDuration, 1000);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [state.isTracking, state.startTime]);

  // Persist state to localStorage only on significant changes (start, stop, reset)
  // Not on every duration tick to avoid performance issues
  useEffect(() => {
    if (shouldPersistRef.current && state.startTime) {
      saveTimeState(customerId, state);
      shouldPersistRef.current = false;
    }
  }, [customerId, state.startTime, state.endTime, state.isTracking]);

  /**
   * Start time tracking
   * Records the current time as the start time in UTC
   */
  const startTracking = useCallback(() => {
    const startTime = generateUTCTimestamp();
    
    shouldPersistRef.current = true;
    setState({
      startTime,
      endTime: null,
      duration: 0,
      isTracking: true,
    });
  }, []);

  /**
   * Stop time tracking
   * Records the current time as the end time and calculates final duration
   */
  const stopTracking = useCallback(() => {
    if (!state.startTime) {
      return;
    }

    const endTime = generateUTCTimestamp();
    const duration = calculateDuration(state.startTime, endTime);

    shouldPersistRef.current = true;
    setState((prev: TimeTrackerState) => ({
      ...prev,
      endTime,
      duration,
      isTracking: false,
    }));
  }, [state.startTime]);

  /**
   * Get formatted duration display string
   * Returns human-readable duration like "45 min" or "1h 23min"
   */
  const getDurationDisplay = useCallback((): string => {
    if (state.duration === null || state.duration === 0) {
      if (state.isTracking && state.startTime) {
        // Calculate live duration
        const now = new Date().getTime();
        const start = new Date(state.startTime).getTime();
        return formatDuration(now - start);
      }
      return '0 min';
    }
    return formatDuration(state.duration);
  }, [state.duration, state.isTracking, state.startTime]);

  /**
   * Reset time tracking state
   * Clears all tracking data and localStorage
   */
  const resetTracking = useCallback(() => {
    clearTimeState(customerId);
    shouldPersistRef.current = false;
    setState({
      startTime: null,
      endTime: null,
      duration: null,
      isTracking: false,
    });
  }, [customerId]);

  return {
    state,
    startTracking,
    stopTracking,
    getDurationDisplay,
    resetTracking,
  };
}

export default useTimeTracker;
