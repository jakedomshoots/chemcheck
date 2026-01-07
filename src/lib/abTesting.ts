/**
 * Simple A/B Testing Framework
 * 
 * Lightweight client-side A/B testing for conversion optimization.
 * Integrates with Google Analytics for tracking.
 */

import { trackEvent } from './analytics';

export interface Experiment {
  id: string;
  name: string;
  variants: string[];
  weights?: number[]; // Optional weights for each variant (must sum to 1)
}

interface ExperimentAssignment {
  experimentId: string;
  variant: string;
  assignedAt: number;
}

const STORAGE_KEY = 'chemcheck_ab_experiments';

/**
 * Get all experiment assignments from localStorage
 */
function getAssignments(): Record<string, ExperimentAssignment> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Save experiment assignments to localStorage
 */
function saveAssignments(assignments: Record<string, ExperimentAssignment>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
}

/**
 * Select a variant based on weights (or uniform distribution)
 */
function selectVariant(variants: string[], weights?: number[]): string {
  const random = Math.random();
  
  if (weights && weights.length === variants.length) {
    let cumulative = 0;
    for (let i = 0; i < variants.length; i++) {
      cumulative += weights[i];
      if (random < cumulative) {
        return variants[i];
      }
    }
    return variants[variants.length - 1];
  }
  
  // Uniform distribution
  const index = Math.floor(random * variants.length);
  return variants[index];
}

/**
 * Get the variant for an experiment
 * Assigns a variant if not already assigned
 */
export function getVariant(experiment: Experiment): string {
  const assignments = getAssignments();
  
  // Check if already assigned
  if (assignments[experiment.id]) {
    return assignments[experiment.id].variant;
  }
  
  // Assign a new variant
  const variant = selectVariant(experiment.variants, experiment.weights);
  
  assignments[experiment.id] = {
    experimentId: experiment.id,
    variant,
    assignedAt: Date.now(),
  };
  
  saveAssignments(assignments);
  
  // Track assignment in analytics
  trackEvent('experiment_assigned', {
    experiment_id: experiment.id,
    experiment_name: experiment.name,
    variant,
  });
  
  return variant;
}

/**
 * Track a conversion event for an experiment
 */
export function trackConversion(experimentId: string, conversionType: string = 'default'): void {
  const assignments = getAssignments();
  const assignment = assignments[experimentId];
  
  if (!assignment) {
    console.warn(`No assignment found for experiment: ${experimentId}`);
    return;
  }
  
  trackEvent('experiment_conversion', {
    experiment_id: experimentId,
    variant: assignment.variant,
    conversion_type: conversionType,
  });
}

/**
 * Reset all experiment assignments (useful for testing)
 */
export function resetExperiments(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Get all current assignments (for debugging)
 */
export function getAllAssignments(): Record<string, ExperimentAssignment> {
  return getAssignments();
}

// ============================================
// Pre-defined Experiments
// ============================================

export const Experiments = {
  // Pricing page CTA button text
  PRICING_CTA: {
    id: 'pricing_cta_v1',
    name: 'Pricing Page CTA Text',
    variants: ['Start Free Trial', 'Get Started Free', 'Try It Free'],
  } as Experiment,
  
  // Onboarding flow
  ONBOARDING_FLOW: {
    id: 'onboarding_v1',
    name: 'Onboarding Flow',
    variants: ['guided', 'self-serve'],
    weights: [0.5, 0.5],
  } as Experiment,
  
  // Dashboard layout
  DASHBOARD_LAYOUT: {
    id: 'dashboard_layout_v1',
    name: 'Dashboard Layout',
    variants: ['cards', 'list'],
  } as Experiment,
};

// ============================================
// React Hook for A/B Testing
// ============================================

import { useState, useEffect } from 'react';

/**
 * React hook for A/B testing
 * 
 * @example
 * const variant = useExperiment(Experiments.PRICING_CTA);
 * return <Button>{variant === 'Start Free Trial' ? 'Start Free Trial' : variant}</Button>
 */
export function useExperiment(experiment: Experiment): string {
  const [variant, setVariant] = useState<string>('');
  
  useEffect(() => {
    setVariant(getVariant(experiment));
  }, [experiment.id]);
  
  return variant;
}

/**
 * Track conversion from within a component
 * 
 * @example
 * const trackSignup = useConversionTracker(Experiments.PRICING_CTA.id);
 * <Button onClick={() => { trackSignup(); handleSignup(); }}>Sign Up</Button>
 */
export function useConversionTracker(experimentId: string) {
  return (conversionType: string = 'default') => {
    trackConversion(experimentId, conversionType);
  };
}
