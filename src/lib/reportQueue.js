/**
 * Local offline queue for customer report sends.
 *
 * When the device is offline (or a network error occurs while sending),
 * pending report-send items are stored in localStorage and replayed when
 * connectivity returns.
 */

const QUEUE_KEY = 'chemcheck.reportSendQueue';

/** Maximum automatic retry attempts before an item is considered failed. */
export const MAX_REPORT_SEND_RETRIES = 3;

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore storage errors (e.g. private mode).
  }
}

export function getReportQueue() {
  return readQueue();
}

export function addToReportQueue(item) {
  const queue = readQueue();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const newItem = {
    id,
    timestamp: Date.now(),
    retryCount: 0,
    status: 'queued',
    ...item,
  };
  queue.push(newItem);
  writeQueue(queue);
  return id;
}

export function removeFromReportQueue(id) {
  const queue = readQueue().filter((item) => item.id !== id);
  writeQueue(queue);
}

export function updateReportQueueItem(id, updates) {
  const queue = readQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index === -1) return false;
  queue[index] = { ...queue[index], ...updates };
  writeQueue(queue);
  return true;
}

export function clearReportQueue() {
  writeQueue([]);
}
