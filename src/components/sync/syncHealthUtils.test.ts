import { describe, expect, it } from 'vitest';
// @ts-expect-error syncHealthUtils is an untyped .js module.
import { describePullState, describeQueueItem, describeSyncError, formatRelativeTime, getTableLabel } from './syncHealthUtils';

describe('describeSyncError', () => {
  it.each([
    ['Access denied: cannot sync data for another user\'s customer', 'This record belongs to another account', 'access'],
    ['Forbidden', 'This record belongs to another account', 'access'],
    ['Pool j57abc not found', "The pool for this log hasn't synced yet", 'dependency'],
    ['Pool not found for customer', "The pool for this log hasn't synced yet", 'dependency'],
    ['Orphaned record: Customer 12 no longer exists', "The customer for this record hasn't synced or was deleted", 'dependency'],
    ['Customer with id abc not found', "The customer for this record hasn't synced or was deleted", 'dependency'],
    ['TypeError: Failed to fetch', 'No connection', 'network'],
    ['Cannot sync while offline', 'No connection', 'network'],
    ['Request timed out', 'No connection', 'network'],
    ['Not authenticated', "You're signed out", 'auth'],
    ['Conflict resolution failed after 2 attempts. Local changes preserved but not synced.', 'The server has a newer version of this record', 'conflict'],
    ['Subscription inactive: subscription is unpaid. Update billing to continue.', 'Your subscription is inactive', 'subscription'],
    ['Rate limit exceeded for note.create', 'Too many changes at once', 'rate_limit'],
    ['SyncService not initialized with Convex client', 'Sync is not ready yet', 'uninitialized'],
    ['Note with convex_id abc not found', 'This record no longer exists on the server', 'missing'],
  ])('maps %j to a plain-English reason', (raw, reason, kind) => {
    const described = describeSyncError(raw);
    expect(described.reason).toBe(reason);
    expect(described.kind).toBe(kind);
    expect(described.hint.length).toBeGreaterThan(0);
  });

  it('keeps the raw text as the hint when nothing matches', () => {
    expect(describeSyncError('Something weird happened')).toEqual({
      reason: 'Sync failed',
      hint: 'Something weird happened',
      kind: 'unknown',
    });
  });

  it('handles missing errors', () => {
    expect(describeSyncError(undefined).reason).toBe('Sync failed');
    expect(describeSyncError('').kind).toBe('unknown');
  });
});

describe('describeQueueItem', () => {
  it('uses the local record before the queued payload', () => {
    const item = { table: 'customers', localId: 4, operation: 'update', data: { full_name: 'Old Name' } };
    expect(describeQueueItem(item, { full_name: 'Alice Smith' }, null)).toBe('Alice Smith');
    expect(describeQueueItem(item, null, null)).toBe('Old Name');
    expect(describeQueueItem({ ...item, data: {} }, null, null)).toBe('Customer #4');
  });

  it('joins the customer name onto child records', () => {
    expect(describeQueueItem({ table: 'serviceLogs', localId: 1, data: { service_date: '2026-09-30' } }, null, 'Bob Jones'))
      .toBe('Service on 2026-09-30 · Bob Jones');
    expect(describeQueueItem({ table: 'chemicalUsage', localId: 2, data: { chemical_type: 'Chlorine', created_date: '2026-09-29' } }, null, 'Bob Jones'))
      .toBe('Chlorine on 2026-09-29 · Bob Jones');
    expect(describeQueueItem({ table: 'notes', localId: 3, data: { title: 'Gate code' } }, null, null)).toBe('Gate code');
    expect(describeQueueItem({ table: 'saltCellLogs', localId: 5, data: { cleaning_date: '2026-09-01' } }, null, null))
      .toBe('Salt cell cleaning on 2026-09-01');
    expect(describeQueueItem({ table: 'pools', localId: 6, data: { name: 'Lap pool' } }, null, 'Cara')).toBe('Lap pool · Cara');
    expect(describeQueueItem({ table: 'equipment', localId: 7, data: { equipment_type: 'Pump' } }, null, null)).toBe('Pump');
  });

  it('falls back to a generic label for unknown tables', () => {
    expect(describeQueueItem({ table: 'widgets', localId: 9 }, null, null)).toBe('widgets #9');
    expect(getTableLabel('widgets')).toBe('widgets');
    expect(getTableLabel('serviceLogs')).toBe('Service log');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');

  it('formats recent timestamps relative to now', () => {
    expect(formatRelativeTime(null, now)).toBe('Never');
    expect(formatRelativeTime(0, now)).toBe('Never');
    expect(formatRelativeTime(now - 10_000, now)).toBe('Just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 hr ago');
  });

  it('switches to an absolute time after a day', () => {
    const text = formatRelativeTime(now - 2 * 86_400_000, now);
    expect(text).not.toMatch(/ago/);
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('describePullState', () => {
  it('describes the watermark and cursor', () => {
    expect(describePullState(undefined)).toBe('Full account pull pending');
    expect(describePullState({ since: 0, cursor: null })).toBe('Full account pull pending');
    expect(describePullState({ since: Date.now() - 1000, cursor: null })).toBe('Pulled through Just now');
    expect(describePullState({ since: Date.now() - 1000, cursor: 'abc' })).toBe('Pulled through Just now (resuming mid-page)');
    expect(describePullState({ since: 0, cursor: 'abc' })).toBe('Pull in progress (resuming mid-page)');
  });
});
