import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'tracing' })),
  replayIntegration: vi.fn(() => ({ name: 'replay' })),
}));

vi.mock('@sentry/react', () => sentryMock);

import { initSentry, scrubEvent, scrubSensitiveData, setUserContext } from './sentry';

describe('sentry privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('only ever sets a stable id as the user context', () => {
    setUserContext({ id: 'abc123', email: 'tech@example.com', username: 'Tech Person' });
    expect(sentryMock.setUser).toHaveBeenCalledWith({ id: 'abc123' });
  });

  it('strips sensitive fields and email-like strings from extra, contexts and breadcrumbs', () => {
    const event = scrubEvent({
      message: 'Failed for tech@example.com',
      extra: { gate_code: '1234', phone: '555-0100', email: 'a@b.co', nested: { note: 'call owner@pool.com' } },
      contexts: { customer: { Email: 'x@y.com', name: 'ok' } },
      breadcrumbs: [{ message: 'sent to tech@example.com', data: { gate_code: '9' } }],
      user: { id: 'hash', email: 'tech@example.com' },
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('tech@example.com');
    expect(serialized).not.toContain('owner@pool.com');
    expect(serialized).not.toContain('1234');
    expect(serialized).not.toContain('555-0100');
    expect(event.extra?.gate_code).toBe('[redacted]');
    expect(event.contexts?.customer).toEqual({ Email: '[redacted]', name: 'ok' });
    expect(event.user).toEqual({ id: 'hash' });
    expect(scrubSensitiveData({ list: ['mail me at a@b.io'] })).toEqual({ list: ['mail me at [redacted]'] });
  });

  it('initializes with reduced sampling, no default PII and a scrubbing beforeSend', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@sentry.example/1');
    initSentry();
    vi.unstubAllEnvs();

    const options = sentryMock.init.mock.calls[0][0];
    expect(options.profilesSampleRate).toBe(0.1);
    expect(options.replaysSessionSampleRate).toBeLessThanOrEqual(0.05);
    expect(options.replaysOnErrorSampleRate).toBe(1.0);
    expect(options.sendDefaultPii).toBe(false);
    expect(typeof options.beforeSend).toBe('function');
    const sent = options.beforeSend({ extra: { email: 'z@z.com' } });
    expect(sent.extra.email).toBe('[redacted]');
  });
});
