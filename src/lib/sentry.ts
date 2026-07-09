import * as Sentry from "@sentry/react";

const SENSITIVE_CONTEXT_KEY = /(address|email|phone|gate|code|note|photo|location|token|recipient|customer|message)/i;

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

export function sanitizeSentryContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!context) return undefined;
  return Object.fromEntries(
    Object.entries(context).flatMap(([key, value]) => {
      if (SENSITIVE_CONTEXT_KEY.test(key)) return [];
      if (typeof value === 'string' && value.length > 200) return [[key, value.slice(0, 200)]];
      return [[key, value]];
    })
  );
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  const environment = import.meta.env.PROD ? 'production' : 'development';
  
  // Only initialize Sentry if DSN is provided
  if (dsn) {
    Sentry.init({
      dsn,
      environment,
      integrations: [
        Sentry.browserTracingIntegration(),
      ],
      // Performance Monitoring
      tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
      // Release Health
      autoSessionTracking: true,
      // Set sample rate for profiling - this is relative to tracesSampleRate
      profilesSampleRate: 1.0,
      beforeSend(event) {
        return {
          ...event,
          user: event.user?.id ? { id: event.user.id } : undefined,
          request: event.request ? { ...event.request, url: safeUrl(event.request.url) } : undefined,
          extra: sanitizeSentryContext(event.extra as Record<string, unknown> | undefined),
          tags: sanitizeSentryContext(event.tags as Record<string, unknown> | undefined),
          breadcrumbs: event.breadcrumbs?.map((breadcrumb) => ({
            ...breadcrumb,
            message: undefined,
            data: sanitizeSentryContext(breadcrumb.data as Record<string, unknown> | undefined),
          })),
        };
      },
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
  
  // Customer-entered notes and network errors can contain sensitive service
  // data. Keep a stable error type and sanitized metadata, not raw content.
  Sentry.captureException(new Error(error?.name || 'Application error'), {
    extra: sanitizeSentryContext(context),
  });
}

// Performance monitoring helper
export function startSpan(name: string, op: string, callback: () => any) {
  return Sentry.startSpan({ name, op }, callback);
}

// User context helper
export function setUserContext(user: { id: string; email?: string; username?: string }) {
  Sentry.setUser({ id: user.id });
}

// Clear user context on logout
export function clearUserContext() {
  Sentry.setUser(null);
}
