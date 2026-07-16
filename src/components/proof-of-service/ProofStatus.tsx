/**
 * ProofStatus Indicator Component
 * Displays proof-of-service completion status on service log cards
 * Requirements: 4.3, 6.4
 */

import { Camera, Clock, Cloud, CloudOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SyncStatus } from '@/lib/proof-of-service/types';

// ============================================
// Types
// ============================================

export interface ProofStatusProps {
  hasPhotos: boolean;
  photoCount: number;
  hasTimeTracking: boolean;
  duration?: number;  // milliseconds
  syncStatus: SyncStatus;
  className?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Format duration in milliseconds to human-readable string
 * @param durationMs - Duration in milliseconds
 * @returns Formatted duration string (e.g., "45 min" or "1h 23min")
 */
export function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || durationMs < 0) {
    return '--';
  }
  
  const totalMinutes = Math.floor(durationMs / 60000);
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
 * Determine sync status for display based on proof-of-service data
 * Property 10: Sync Status Accuracy
 * @param syncStatus - Current sync status
 * @returns Sync status configuration for display
 */
export function getSyncStatusConfig(syncStatus: SyncStatus): {
  icon: typeof Cloud;
  label: string;
  colorClass: string;
  bgClass: string;
} {
  switch (syncStatus) {
    case 'synced':
      return {
        icon: CheckCircle2,
        label: 'Synced',
        colorClass: 'text-ok',
        bgClass: 'bg-[var(--status-ok-soft)]',
      };
    case 'pending':
      return {
        icon: RefreshCw,
        label: 'Pending',
        colorClass: 'text-watch',
        bgClass: 'bg-[var(--status-watch-soft)]',
      };
    case 'failed':
      return {
        icon: CloudOff,
        label: 'Failed',
        colorClass: 'text-critical',
        bgClass: 'bg-[var(--status-critical-soft)]',
      };
    default:
      // Exhaustive check - should never reach here
      return {
        icon: Cloud,
        label: 'Unknown',
        colorClass: 'text-ink-secondary',
        bgClass: 'bg-surface-2',
      };
  }
}

// ============================================
// Component
// ============================================

export function ProofStatus({
  hasPhotos,
  photoCount,
  hasTimeTracking,
  duration,
  syncStatus,
  className,
}: ProofStatusProps) {
  const syncConfig = getSyncStatusConfig(syncStatus);
  const SyncIcon = syncConfig.icon;

  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      {/* Photo Count Indicator */}
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium',
          hasPhotos
            ? 'bg-brand-softer text-brand-ink border border-[var(--status-info-line)]'
            : 'bg-surface-2 text-ink-muted border border-line'
        )}
        title={hasPhotos ? `${photoCount} photo${photoCount !== 1 ? 's' : ''} captured` : 'No photos'}
      >
        <Camera className="w-3.5 h-3.5" />
        <span>{photoCount}</span>
      </div>

      {/* Time Tracking Indicator */}
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium',
          hasTimeTracking
            ? 'bg-brand-softer text-brand-ink border border-[var(--status-info-line)]'
            : 'bg-surface-2 text-ink-muted border border-line'
        )}
        title={hasTimeTracking ? `Duration: ${formatDuration(duration)}` : 'No time tracking'}
      >
        <Clock className="w-3.5 h-3.5" />
        <span>{hasTimeTracking ? formatDuration(duration) : '--'}</span>
      </div>

      {/* Sync Status Indicator */}
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border',
          syncConfig.bgClass,
          syncConfig.colorClass,
          syncStatus === 'synced' && 'border-[var(--status-ok-line)]',
          syncStatus === 'pending' && 'border-[var(--status-watch-line)]',
          syncStatus === 'failed' && 'border-[var(--status-critical-line)]'
        )}
        title={`Sync status: ${syncConfig.label}`}
      >
        <SyncIcon className={cn('w-3.5 h-3.5', syncStatus === 'pending' && 'animate-spin')} />
        <span>{syncConfig.label}</span>
      </div>
    </div>
  );
}
