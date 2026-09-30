/**
 * Local offline queue for customer report sends.
 *
 * When the device is offline (or a network error occurs while sending),
 * pending report-send items are stored in localStorage and replayed when
 * connectivity returns.
 *
 * The queue is scoped to the signed-in account: the storage key carries a
 * hash of the account email and every item is stamped with the same owner
 * hash, so a different account on the same device can neither read nor replay
 * another account's queued sends.
 */

import { getStoredCurrentUserEmail, hashIdentity } from './sessionIdentity';

const QUEUE_KEY_PREFIX = 'chemcheck.reportSendQueue';

/** Maximum automatic retry attempts before an item is considered failed. */
export const MAX_REPORT_SEND_RETRIES = 3;

export function getReportQueueOwner() {
  return hashIdentity(getStoredCurrentUserEmail());
}

export function getReportQueueStorageKey(owner = getReportQueueOwner()) {
  return `${QUEUE_KEY_PREFIX}.${owner}`;
}

function readQueue(owner = getReportQueueOwner()) {
  try {
    const raw = localStorage.getItem(getReportQueueStorageKey(owner));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Only replay items that belong to the current account.
    return parsed.filter((item) => item && item.owner === owner);
  } catch {
    return [];
  }
}

function writeQueue(queue, owner = getReportQueueOwner()) {
  try {
    localStorage.setItem(getReportQueueStorageKey(owner), JSON.stringify(queue));
  } catch {
    // Ignore storage errors (e.g. private mode).
  }
}

export function getReportQueue() {
  return readQueue();
}

export function addToReportQueue(item) {
  const owner = getReportQueueOwner();
  const queue = readQueue(owner);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const newItem = {
    id,
    timestamp: Date.now(),
    retryCount: 0,
    status: 'queued',
    ...item,
    owner,
  };
  queue.push(newItem);
  writeQueue(queue, owner);
  return id;
}

export function removeFromReportQueue(id) {
  const owner = getReportQueueOwner();
  const queue = readQueue(owner).filter((item) => item.id !== id);
  writeQueue(queue, owner);
}

export function updateReportQueueItem(id, updates) {
  const owner = getReportQueueOwner();
  const queue = readQueue(owner);
  const index = queue.findIndex((item) => item.id === id);
  if (index === -1) return false;
  queue[index] = { ...queue[index], ...updates, owner };
  writeQueue(queue, owner);
  return true;
}

export function clearReportQueue() {
  writeQueue([]);
}
