/**
 * Pure helpers for the sync health panel: turn raw queue items and error
 * strings into something a technician can act on. Kept free of React and of
 * the database so they are trivially testable.
 */

export const TABLE_LABELS = {
  customers: 'Customer',
  pools: 'Pool',
  equipment: 'Equipment',
  serviceLogs: 'Service log',
  chemicalUsage: 'Chemical usage',
  notes: 'Note',
  saltCellLogs: 'Salt cell log',
};

const AUTH_PATTERN = /\b(not authenticated|unauthenticated|401)\b/i;
const ACCESS_PATTERN = /\b(access denied|permission denied|forbidden|unauthorized|403|another user)\b/i;
const POOL_MISSING_PATTERN = /\bpool\b.*\bnot found\b|\bpool not found\b/i;
const CUSTOMER_MISSING_PATTERN = /\bcustomer\b.*\b(not found|no longer exists)\b|\borphaned record\b/i;
const NOTE_MISSING_PATTERN = /\b(note|record|service ?log|equipment|salt cell log)\b.*\bnot found\b/i;
const NETWORK_PATTERN = /\b(network|offline|failed to fetch|fetch failed|timeout|timed out|connection|econn\w*|socket|dns|websocket)\b/i;
const CONFLICT_PATTERN = /\bconflict\b/i;
const SUBSCRIPTION_PATTERN = /\bsubscription inactive\b/i;
const RATE_LIMIT_PATTERN = /\brate limit/i;
const UNINITIALIZED_PATTERN = /not initialized/i;
const VALIDATION_PATTERN = /\b(validation|invalid|must be)\b/i;

/**
 * Map a raw sync error string to a plain-English explanation plus a hint
 * about what the technician can do. Returns an object so the UI can decide
 * how to style the two parts.
 *
 * @param {string | undefined | null} error
 * @returns {{ reason: string, hint: string, kind: string }}
 */
export function describeSyncError(error) {
  const text = typeof error === 'string' ? error.trim() : '';
  if (!text) {
    return { reason: 'Sync failed', hint: 'No error details were recorded.', kind: 'unknown' };
  }
  if (AUTH_PATTERN.test(text)) {
    return { reason: "You're signed out", hint: 'Sign in again, then retry.', kind: 'auth' };
  }
  if (ACCESS_PATTERN.test(text)) {
    return {
      reason: 'This record belongs to another account',
      hint: 'It was created under a different login. Discard it here, or sign in with that account to sync it.',
      kind: 'access',
    };
  }
  if (POOL_MISSING_PATTERN.test(text)) {
    return {
      reason: "The pool for this log hasn't synced yet",
      hint: 'Retry after the pool syncs. If the pool was deleted, discard this record.',
      kind: 'dependency',
    };
  }
  if (CUSTOMER_MISSING_PATTERN.test(text)) {
    return {
      reason: "The customer for this record hasn't synced or was deleted",
      hint: 'Retry after the customer syncs. If the customer was deleted, discard this record.',
      kind: 'dependency',
    };
  }
  if (NETWORK_PATTERN.test(text)) {
    return { reason: 'No connection', hint: 'Retry once you are back online.', kind: 'network' };
  }
  if (CONFLICT_PATTERN.test(text)) {
    return {
      reason: 'The server has a newer version of this record',
      hint: 'Retry to merge again, or discard to keep the server version.',
      kind: 'conflict',
    };
  }
  if (SUBSCRIPTION_PATTERN.test(text)) {
    return { reason: 'Your subscription is inactive', hint: 'Update billing, then retry.', kind: 'subscription' };
  }
  if (RATE_LIMIT_PATTERN.test(text)) {
    return { reason: 'Too many changes at once', hint: 'Wait a minute, then retry.', kind: 'rate_limit' };
  }
  if (UNINITIALIZED_PATTERN.test(text)) {
    return { reason: 'Sync is not ready yet', hint: 'Reopen the app, then retry.', kind: 'uninitialized' };
  }
  if (NOTE_MISSING_PATTERN.test(text)) {
    return {
      reason: 'This record no longer exists on the server',
      hint: 'Discard it here, or edit it to create it again.',
      kind: 'missing',
    };
  }
  if (VALIDATION_PATTERN.test(text)) {
    return { reason: 'The server rejected this record', hint: `Edit the record and save it again. (${text})`, kind: 'validation' };
  }
  return { reason: 'Sync failed', hint: text, kind: 'unknown' };
}

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/**
 * Human label for a queue item built from the local row (preferred) or the
 * payload captured in the queue. `customerName` is an optional join from the
 * parent customer for child records.
 *
 * @param {{ table: string, localId: number, operation?: string, data?: any }} item
 * @param {Record<string, any> | undefined | null} record
 * @param {string | undefined | null} customerName
 * @returns {string}
 */
export function describeQueueItem(item, record, customerName) {
  const row = record || item?.data || {};
  const owner = pick(customerName);
  const withOwner = (label) => (owner ? `${label} · ${owner}` : label);

  switch (item?.table) {
    case 'customers':
      return pick(row.full_name, `Customer #${item.localId}`);
    case 'pools':
      return withOwner(pick(row.name, `Pool #${item.localId}`));
    case 'equipment':
      return withOwner(pick(row.name, row.equipment_type, `Equipment #${item.localId}`));
    case 'serviceLogs':
      return withOwner(row.service_date ? `Service on ${row.service_date}` : `Service log #${item.localId}`);
    case 'chemicalUsage': {
      const chemical = pick(row.chemical_type, 'Chemical');
      return withOwner(row.created_date ? `${chemical} on ${row.created_date}` : `${chemical} usage #${item.localId}`);
    }
    case 'notes':
      return withOwner(pick(row.title, `Note #${item.localId}`));
    case 'saltCellLogs':
      return withOwner(row.cleaning_date ? `Salt cell cleaning on ${row.cleaning_date}` : `Salt cell log #${item.localId}`);
    default:
      return `${item?.table || 'Record'} #${item?.localId ?? '?'}`;
  }
}

export function getTableLabel(table) {
  return TABLE_LABELS[table] || table || 'Record';
}

/**
 * "3 minutes ago" style relative time for small UI labels. Falls back to the
 * absolute time for anything older than a day so it stays unambiguous.
 *
 * @param {number | null | undefined} timestamp
 * @param {number} [now]
 */
export function formatRelativeTime(timestamp, now = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return 'Never';
  const diff = Math.max(0, now - value);
  const seconds = Math.round(diff / 1000);
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Summarise the pull watermark for display.
 *
 * @param {{ since?: number, cursor?: string | null } | undefined | null} pullState
 */
export function describePullState(pullState) {
  const since = Number(pullState?.since || 0);
  const cursor = pullState?.cursor || null;
  if (!since && !cursor) return 'Full account pull pending';
  const base = since ? `Pulled through ${formatRelativeTime(since)}` : 'Pull in progress';
  return cursor ? `${base} (resuming mid-page)` : base;
}
