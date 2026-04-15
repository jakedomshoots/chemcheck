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
        colorClass: 'text-green-600',
        bgClass: 'bg-green-50',
      };
    case 'pending':
      return {
        icon: RefreshCw,
        label: 'Pending',
        colorClass: 'text-amber-600',
        bgClass: 'bg-amber-50',
      };
    case 'failed':
      return {
        icon: CloudOff,
        label: 'Failed',
        colorClass: 'text-red-600',
        bgClass: 'bg-red-50',
      };
    default:
      // Exhaustive check - should never reach here
      return {
        icon: Cloud,
        label: 'Unknown',
        colorClass: 'text-slate-600',
        bgClass: 'bg-slate-50',
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
            ? 'bg-cyan-50 text-cyan-700 border border-cyan-200'
            : 'bg-slate-50 text-slate-500 border border-slate-200'
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
            ? 'bg-purple-50 text-purple-700 border border-purple-200'
            : 'bg-slate-50 text-slate-500 border border-slate-200'
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
          syncStatus === 'synced' && 'border-green-200',
          syncStatus === 'pending' && 'border-amber-200',
          syncStatus === 'failed' && 'border-red-200'
        )}
        title={`Sync status: ${syncConfig.label}`}
      >
        <SyncIcon className={cn('w-3.5 h-3.5', syncStatus === 'pending' && 'animate-spin')} />
        <span>{syncConfig.label}</span>
      </div>
    </div>
  );
}

export default ProofStatus;
