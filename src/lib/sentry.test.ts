import { describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'tracing' })),
  startSpan: vi.fn(),
}));

vi.mock('@sentry/react', () => sentry);

import { reportError, sanitizeSentryContext, setUserContext } from './sentry';

describe('Sentry privacy controls', () => {
  it('removes customer and access details from error context', () => {
    expect(sanitizeSentryContext({
      operation: 'sync',
      customer_name: 'Alice',
      gate_code: '1234',
      address: '1 Main Street',
    })).toEqual({ operation: 'sync' });
  });

  it('sets only a stable identifier as user context', () => {
    setUserContext({ id: 'user_123', email: 'owner@example.com', username: 'Owner' });
    expect(sentry.setUser).toHaveBeenCalledWith({ id: 'user_123' });
  });

  it('does not send raw error messages or sensitive context', () => {
    reportError(new Error('Gate code 1234 at 1 Main Street'), { note: 'customer requested callback', operation: 'sync' });
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Error' }),
      { extra: { operation: 'sync' } },
    );
  });
});
