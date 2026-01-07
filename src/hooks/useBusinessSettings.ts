/**
 * Hook for managing business proof-of-service settings
 * Stores settings in localStorage for offline-first operation
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ProofOfServiceSettings,
  DEFAULT_PROOF_OF_SERVICE_SETTINGS,
} from '@/lib/proof-of-service/types';

const STORAGE_KEY = 'chemcheck_business_proof_settings';

export interface BusinessSettings {
  proof_of_service: ProofOfServiceSettings;
}

const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  proof_of_service: DEFAULT_PROOF_OF_SERVICE_SETTINGS,
};

/**
 * Check if localStorage is available (guards against SSR environments)
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

/**
 * Hook to get and update business proof-of-service settings
 */
export function useBusinessSettings() {
  const [settings, setSettings] = useState<BusinessSettings>(DEFAULT_BUSINESS_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  // Load settings from localStorage on mount
  useEffect(() => {
    if (!isLocalStorageAvailable()) {
      setIsLoading(false);
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings({
          proof_of_service: {
            ...DEFAULT_PROOF_OF_SERVICE_SETTINGS,
            ...parsed.proof_of_service,
          },
        });
      }
    } catch (e) {
      console.error('Failed to load business settings:', e);
    }
    setIsLoading(false);
  }, []);

  // Update settings
  const updateSettings = useCallback((newSettings: Partial<BusinessSettings>) => {
    setSettings((prev) => {
      const updated = {
        ...prev,
        ...newSettings,
        proof_of_service: {
          ...prev.proof_of_service,
          ...newSettings.proof_of_service,
        },
      };
      
      if (isLocalStorageAvailable()) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
          console.error('Failed to save business settings:', e);
        }
      }
      
      return updated;
    });
  }, []);

  // Update proof-of-service settings specifically
  const updateProofOfServiceSettings = useCallback(
    (newSettings: Partial<ProofOfServiceSettings>) => {
      setSettings((prev) => {
        const updated = {
          ...prev,
          proof_of_service: {
            ...prev.proof_of_service,
            ...newSettings,
          },
        };
        
        if (isLocalStorageAvailable()) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          } catch (e) {
            console.error('Failed to save business settings:', e);
          }
        }
        
        return updated;
      });
    },
    []
  );

  return {
    settings,
    isLoading,
    updateSettings,
    updateProofOfServiceSettings,
    proofOfServiceSettings: settings.proof_of_service,
  };
}

/**
 * Get proof-of-service settings synchronously (for non-React contexts)
 */
export function getProofOfServiceSettings(): ProofOfServiceSettings {
  if (!isLocalStorageAvailable()) {
    return DEFAULT_PROOF_OF_SERVICE_SETTINGS;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_PROOF_OF_SERVICE_SETTINGS,
        ...parsed.proof_of_service,
      };
    }
  } catch (e) {
    console.error('Failed to load business settings:', e);
  }
  return DEFAULT_PROOF_OF_SERVICE_SETTINGS;
}
