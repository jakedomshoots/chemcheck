import { useState } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { useSyncState } from '@/hooks/useSyncState';
import { cn } from '@/lib/utils';
import {
  getStatusText,
  getStatusColor,
  getRecordStatusText,
  getRecordStatusColor
} from './syncStatusUtils';

// Imported statically on purpose: the health panel is most useful while
// offline, and a lazy chunk cannot be fetched then.
import { SyncHealthPanel } from './SyncHealthPanel';

/**
 * Global sync status indicator component
 * Shows current sync status and pending count. Tapping it opens the sync
 * health drawer (manual sync, dead-letter recovery, force re-sync).
 */
export function SyncStatusIndicator({ 
  className, 
  showLabel = false, 
  showPendingCount = true 
}) {
  const { status, pendingCount } = useSyncState();
  const [open, setOpen] = useState(false);
  const statusText = getStatusText(status, pendingCount);

  const getStatusIcon = () => {
    switch (status) {
      case 'syncing':
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-critical" />;
      case 'offline':
        return <WifiOff className="h-4 w-4 text-ink-muted" />;
      case 'idle':
        return pendingCount > 0 
          ? <Clock className="h-4 w-4 text-watch" />
          : <CheckCircle className="h-4 w-4 text-ok" />;
      default:
        return <Wifi className="h-4 w-4" />;
    }
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={statusText}
            title={`${statusText} – open sync health`}
            data-testid="sync-status-trigger"
            className="h-8 rounded-full border-line bg-surface-1 px-3 text-ink-secondary hover:bg-surface-2"
          >
            {getStatusIcon()}
            {showLabel && (
              <span className="ml-2 text-sm text-ink-secondary">
                {statusText}
              </span>
            )}
          </Button>
        </DrawerTrigger>
        <DrawerContent data-testid="sync-health-drawer">
          <DrawerHeader className="pb-2">
            <DrawerTitle>Sync health</DrawerTitle>
            <DrawerDescription>{statusText}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            {open && <SyncHealthPanel />}
          </div>
        </DrawerContent>
      </Drawer>

      {showPendingCount && pendingCount > 0 && (
        <Badge variant="secondary" className={cn('text-xs font-medium', getStatusColor(status, pendingCount))}>
          {pendingCount}
        </Badge>
      )}
    </div>
  );
}

/**
 * Compact sync status badge for use in cards and lists
 */
export function SyncStatusBadge({ 
  status, 
  onRetry,
  className 
}) {
  const getIcon = () => {
    switch (status) {
      case 'synced':
        return <CheckCircle className="h-3 w-3" />;
      case 'pending':
        return <Clock className="h-3 w-3" />;
      case 'error':
        return <AlertCircle className="h-3 w-3" />;
      default:
        return <Clock className="h-3 w-3" />; // Default to pending icon
    }
  };

  return (
    <button
      type="button"
      role="button"
      onClick={status === 'error' && onRetry ? onRetry : undefined}
      className="bg-transparent p-0 border-0"
      title={
        status === 'synced'
          ? 'Record is synced to cloud'
          : status === 'pending'
            ? 'Record will sync when online'
            : 'Sync failed. Please try again.'
      }
    >
      <Badge 
        variant="outline" 
        className={cn(
          'flex items-center gap-1 text-xs cursor-default',
          getRecordStatusColor(status),
          status === 'error' && onRetry && 'cursor-pointer hover:opacity-80',
          className
        )}
      >
        {getIcon()}
        {getRecordStatusText(status)}
      </Badge>
    </button>
  );
}
