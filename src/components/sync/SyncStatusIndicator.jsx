import { Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

  const handleSyncNow = async () => {
    if (isSyncButtonDisabled(status)) return;
    
    try {
      await syncNow();
    } catch (err) {
      console.error('Manual sync failed:', err);
    }
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={isSyncButtonDisabled(status)}
            className="h-8 rounded-full border-slate-200 bg-white/90 px-3 text-slate-700 hover:bg-slate-100"
          >
            {getStatusIcon()}
            {showLabel && (
              <span className="ml-2 text-sm text-slate-700">
                {getStatusText(status, pendingCount)}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sync Status</p>
              <p className="text-sm font-medium text-slate-900">{getStatusText(status, pendingCount)}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Pending</p>
                <p className="text-sm font-semibold text-slate-900">{pendingCount}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Last Sync</p>
                <p className="text-xs font-medium text-slate-900">
                  {lastSyncAt
                    ? new Date(lastSyncAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                    : 'Not yet'}
                </p>
              </div>
            </div>
            {error && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1">
                {error}
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full"
              onClick={handleSyncNow}
              disabled={isSyncButtonDisabled(status)}
            >
              <RefreshCw className={cn('mr-2 h-3.5 w-3.5', status === 'syncing' && 'animate-spin')} />
              Sync Now
            </Button>
          </div>
        </PopoverContent>
      </Popover>

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
