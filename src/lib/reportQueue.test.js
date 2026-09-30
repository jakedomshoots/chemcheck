import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToReportQueue,
  getReportQueue,
  getReportQueueStorageKey,
  removeFromReportQueue,
  updateReportQueueItem,
} from './reportQueue';

function signIn(email) {
  localStorage.setItem('chemcheck_current_user', JSON.stringify({ email }));
}

describe('reportQueue account scoping', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('stores the queue under an account-scoped key that does not reveal the email', () => {
    signIn('first@example.com');
    addToReportQueue({ localCustomerId: 1, localServiceLogId: 2, deliveryMethod: 'email' });
    const key = getReportQueueStorageKey();
    expect(key.startsWith('chemcheck.reportSendQueue.')).toBe(true);
    expect(key).not.toContain('first@example.com');
    expect(localStorage.getItem('chemcheck.reportSendQueue')).toBeNull();
    expect(JSON.parse(localStorage.getItem(key))[0].owner).toBeDefined();
  });

  it('does not expose one account\'s queued reports to another account', () => {
    signIn('first@example.com');
    const id = addToReportQueue({ localCustomerId: 1, localServiceLogId: 2, deliveryMethod: 'sms' });
    expect(getReportQueue()).toHaveLength(1);

    signIn('second@example.com');
    expect(getReportQueue()).toHaveLength(0);
    expect(updateReportQueueItem(id, { retryCount: 1 })).toBe(false);

    signIn('first@example.com');
    expect(getReportQueue()).toHaveLength(1);
    removeFromReportQueue(id);
    expect(getReportQueue()).toHaveLength(0);
  });

  it('ignores items whose owner stamp does not match the current account', () => {
    signIn('first@example.com');
    localStorage.setItem(getReportQueueStorageKey(), JSON.stringify([
      { id: 'a', owner: 'someone-else', localServiceLogId: 1 },
      { id: 'b', localServiceLogId: 2 },
    ]));
    expect(getReportQueue()).toHaveLength(0);
  });
});
