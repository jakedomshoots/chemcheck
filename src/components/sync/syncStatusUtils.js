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
    default:
      return 'bg-surface-2 text-gray-800 border-line';
  }
}