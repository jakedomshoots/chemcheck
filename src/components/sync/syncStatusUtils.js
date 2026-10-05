/**
 * Utility functions for sync status display logic
 * These functions are extracted for testing purposes
 */

/**
 * Helper function to get status text based on sync status and pending count
 * 
 * @param {string} status - The sync status ('idle', 'syncing', 'error', 'offline')
 * @param {number} pendingCount - Number of pending sync items
 * @returns {string} The status text to display
 */
export function getStatusText(status, pendingCount) {
  switch (status) {
    case 'syncing':
      return 'Syncing...';
    case 'error':
      return 'Sync error';
    case 'offline':
      return 'Offline';
    case 'idle':
      return pendingCount > 0 ? `${pendingCount} pending` : 'All synced';
    default:
      return 'Unknown';
  }
}

/**
 * Helper function to get status color classes based on sync status and pending count
 * 
 * @param {string} status - The sync status ('idle', 'syncing', 'error', 'offline')
 * @param {number} pendingCount - Number of pending sync items
 * @returns {string} The CSS classes for status color
 */
export function getStatusColor(status, pendingCount) {
  switch (status) {
    case 'syncing':
      return 'bg-[var(--status-info-soft)] text-info border-[var(--status-info-line)]';
    case 'error':
      return 'bg-[var(--status-critical-soft)] text-critical border-[var(--status-critical-line)]';
    case 'offline':
      return 'bg-surface-2 text-gray-800 border-line';
    case 'idle':
      return pendingCount > 0 
        ? 'bg-yellow-100 text-watch border-[var(--status-watch-line)]'
        : 'bg-[var(--status-ok-soft)] text-ok border-[var(--status-ok-line)]';
    default:
      return 'bg-surface-2 text-gray-800 border-line';
  }
}

/**
 * Helper function to determine if sync button should be disabled
 * 
 * @param {string} status - The sync status ('idle', 'syncing', 'error', 'offline')
 * @returns {boolean} Whether the sync button should be disabled
 */
export function isSyncButtonDisabled(status) {
  return status === 'syncing' || status === 'offline';
}

/**
 * Human-friendly guidance for a technician about to lose coverage.
 * This is deliberately based on the local queue: a clear queue means the
 * phone has finished saving everything it already knows about, not that a
 * future cloud change cannot exist.
 */
export function getFieldReadiness(status, pendingCount, lastCompletedSyncAt) {
  if (status === 'offline') {
    const savedChanges = pendingCount === 1 ? '1 saved change' : `${pendingCount} saved changes`;
    return {
      title: lastCompletedSyncAt ? 'Working offline' : 'Offline — route not verified',
      message: !lastCompletedSyncAt
        ? 'Reconnect and complete a sync before depending on this phone for route data.'
        : pendingCount > 0
        ? `${savedChanges} will sync automatically when coverage returns.`
        : 'Your saved route data is available on this phone. New work will sync when coverage returns.',
      tone: 'border-line bg-surface-2',
    };
  }

  if (status === 'idle' && pendingCount === 0 && lastCompletedSyncAt) {
    return {
      title: 'Ready for offline work',
      message: 'This phone has the latest saved route data. You can keep working without Wi-Fi or cell service.',
      tone: 'border-[var(--status-ok-line)] bg-[var(--status-ok-soft)]',
    };
  }

  if (status === 'idle' && pendingCount === 0) {
    return {
      title: 'Sync this phone before leaving coverage',
      message: 'No completed route download is recorded for this signed-in phone yet.',
      tone: 'border-[var(--status-watch-line)] bg-yellow-50',
    };
  }

  if (status === 'syncing') {
    return {
      title: 'Preparing this phone',
      message: 'Keep coverage on until the current sync finishes.',
      tone: 'border-[var(--status-info-line)] bg-[var(--status-info-soft)]',
    };
  }

  if (status === 'error') {
    return {
      title: 'Sync needs attention',
      message: 'Reconnect and sync before depending on this phone offline.',
      tone: 'border-[var(--status-critical-line)] bg-[var(--status-critical-soft)]',
    };
  }

  const changes = pendingCount === 1 ? '1 change' : `${pendingCount} changes`;
  return {
    title: 'Not ready to leave coverage yet',
    message: `${changes} still need to sync to the cloud.`,
    tone: 'border-[var(--status-watch-line)] bg-yellow-50',
  };
}

/**
 * Helper function to get record sync status text
 * 
 * @param {string} status - The record sync status ('synced', 'pending', 'error')
 * @returns {string} The status text to display
 */
export function getRecordStatusText(status) {
  switch (status) {
    case 'synced':
      return 'Synced';
    case 'pending':
      return 'Pending';
    case 'error':
      return 'Error';
    case 'local_only':
      return 'Local only';
    default:
      return 'Unknown';
  }
}

/**
 * Helper function to get record sync status color classes
 * 
 * @param {string} status - The record sync status ('synced', 'pending', 'error')
 * @returns {string} The CSS classes for status color
 */
export function getRecordStatusColor(status) {
  switch (status) {
    case 'synced':
      return 'bg-[var(--status-ok-soft)] text-ok border-[var(--status-ok-line)]';
    case 'pending':
      return 'bg-yellow-100 text-watch border-[var(--status-watch-line)]';
    case 'error':
      return 'bg-[var(--status-critical-soft)] text-critical border-[var(--status-critical-line)]';
    case 'local_only':
      return 'bg-surface-2 text-ink-secondary border-line';
    default:
      return 'bg-surface-2 text-gray-800 border-line';
  }
}
