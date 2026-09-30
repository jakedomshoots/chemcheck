import * as Sentry from "@sentry/react";

/** Keys whose values are personal or physical-access data and never leave the device. */
const SENSITIVE_KEYS = new Set([
  'gate_code',
  'gatecode',
  'gate',
  'phone',
  'phone_number',
  'customerphone',
  'email',
  'email_address',
  'customeremail',
  'username',
  'full_name',
  'address',
]);

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const REDACTED = '[redacted]';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

export function redactString(value: string): string {
  return value.replace(EMAIL_PATTERN, REDACTED);
}

/**
 * Deep-scrub a value: sensitive keys are replaced wholesale and any string
 * containing an email address is redacted. Cycles are guarded.
 */
export function scrubSensitiveData<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === 'string') {
    return redactString(value) as unknown as T;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((entry) => scrubSensitiveData(entry, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : scrubSensitiveData(entry, seen);
  }
  return result as T;
}

type ScrubbableEvent = {
  message?: string;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: Array<Record<string, unknown>>;
  user?: Record<string, unknown> | null;
  request?: Record<string, unknown>;
  exception?: { values?: Array<{ value?: string }> };
};

/**
 * beforeSend hook: strips email-like strings and gate_code/phone/email fields
 * from every part of the event that can carry free-form data, and reduces the
 * user context to its stable id.
 */
export function scrubEvent<E>(rawEvent: E): E {
  if (!rawEvent) return rawEvent;
  // Sentry's ErrorEvent/TransactionEvent types are richer than what we touch;
  // scrub through a loose structural view and hand back the same object type.
  const event = rawEvent as unknown as ScrubbableEvent;
  if (event.message) event.message = redactString(event.message);
  if (event.extra) event.extra = scrubSensitiveData(event.extra);
  if (event.contexts) event.contexts = scrubSensitiveData(event.contexts);
  if (event.tags) event.tags = scrubSensitiveData(event.tags);
  if (event.request) event.request = scrubSensitiveData(event.request);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((crumb) => scrubSensitiveData(crumb));
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((entry) =>
      entry?.value ? { ...entry, value: redactString(entry.value) } : entry
    );
  }
  if (event.user) {
    event.user = event.user.id ? { id: String(event.user.id) } : null;
  }
  return rawEvent;
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  const environment = import.meta.env.PROD ? 'production' : 'development';

  // Only initialize Sentry if DSN is provided
  if (dsn) {
    Sentry.init({
      dsn,
      environment,
      sendDefaultPii: false,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      // Replay only a tiny slice of healthy sessions, but every session with an error.
      replaysSessionSampleRate: 0.01,
      replaysOnErrorSampleRate: 1.0,
      // Performance Monitoring
      tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
      // Set sample rate for profiling - this is relative to tracesSampleRate
      profilesSampleRate: 0.1,
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (breadcrumb) => scrubSensitiveData(breadcrumb),
    });

    console.log(`[Sentry] Initialized for ${environment} environment`);
  } else {
    console.log('[Sentry] DSN not provided, skipping initialization');
  }
}

// Error reporting helper
export function reportError(error: Error, context?: Record<string, any>) {
  if (import.meta.env.DEV) {
    console.error('Error:', error, context);
  }

  Sentry.captureException(error, {
    extra: context ? scrubSensitiveData(context) : undefined,
  });
}

// Performance monitoring helper
export function startSpan(name: string, op: string, callback: () => any) {
  return Sentry.startSpan({ name, op }, callback);
}

/**
 * User context helper. Only a stable, non-identifying id is attached; email
 * and name are intentionally dropped even when a caller passes them.
 */
export function setUserContext(user: { id: string; email?: string; username?: string }) {
  Sentry.setUser({ id: user.id });
}

// Clear user context on logout
export function clearUserContext() {
  Sentry.setUser(null);
}
