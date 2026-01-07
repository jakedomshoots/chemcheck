import { Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSyncState } from '@/hooks/useSyncState';
import { cn } from '@/lib/utils';
import { 
  getStatusText, 
  getStatusColor, 
  isSyncButtonDisabled,
  getRecordStatusText,
  getRecordStatusColor
} from './syncStatusUtils';

/**
 * Global sync status indicator component
 * Shows current sync status, pending count, and provides manual sync trigger
 */
export function SyncStatusIndicator({ 
  className, 
  showLabel = false, 
  showPendingCount = true 
}) {
  const { status, pendingCount, lastSyncAt, error, syncNow } = useSyncState();

  const getStatusIcon = () => {
    switch (status) {
      case 'syncing':
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'offline':
        return <WifiOff className="h-4 w-4 text-gray-500" />;
      case 'idle':
        return pendingCount > 0 
          ? <Clock className="h-4 w-4 text-yellow-500" />
          : <CheckCircle className="h-4 w-4 text-green-500" />;
      default:
        return <Wifi className="h-4 w-4" />;
    }
  };

  const getTooltipContent = () => {
    const lines = [getStatusText(status, pendingCount)];
    
    if (lastSyncAt) {
      const lastSyncDate = new Date(lastSyncAt);
      lines.push(`Last sync: ${lastSyncDate.toLocaleString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })}`);
    }
    
    if (error) {
      lines.push('Error: Sync failed. Please try again.');
    }

    return lines.join('\n');
  };

  const handleSyncNow = async () => {
    if (isSyncButtonDisabled(status)) return;
    
    try {
      await syncNow();
    } catch (err) {
      console.error('Manual sync failed:', err);
    }
  };

  return (
    <TooltipProvider>
      <div className={cn('flex items-center gap-2', className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSyncNow}
              disabled={isSyncButtonDisabled(status)}
              className="h-8 px-2 text-slate-700 hover:text-slate-900 hover:bg-slate-100"
            >
              {getStatusIcon()}
              {showLabel && (
                <span className="ml-2 text-sm text-slate-700">
                  {getStatusText(status, pendingCount)}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="whitespace-pre-line text-slate-900">
              {getTooltipContent()}
              {status !== 'syncing' && status !== 'offline' && (
                <div className="mt-1 text-xs text-slate-600">
                  Click to sync now
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>

        {showPendingCount && pendingCount > 0 && (
          <Badge variant="secondary" className={cn('text-xs font-medium', getStatusColor(status, pendingCount))}>
            {pendingCount}
          </Badge>
        )}
      </div>
    </TooltipProvider>
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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={cn(
              'flex items-center gap-1 text-xs cursor-default',
              getRecordStatusColor(status),
              status === 'error' && onRetry && 'cursor-pointer hover:opacity-80',
              className
            )}
            onClick={status === 'error' && onRetry ? onRetry : undefined}
          >
            {getIcon()}
            {getRecordStatusText(status)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div>
            {status === 'synced' && 'Record is synced to cloud'}
            {status === 'pending' && 'Record will sync when online'}
            {status === 'error' && (
              <div>
                <div>Sync failed. Please try again.</div>
                {onRetry && (
                  <div className="mt-1 text-xs opacity-75">
                    Click to retry
                  </div>
                )}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}