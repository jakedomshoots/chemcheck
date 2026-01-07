import * as Sentry from "@sentry/react";

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
        Sentry.replayIntegration({
          // Capture 10% of all sessions,
          // plus 100% of sessions with an error
          sessionSampleRate: 0.1,
          errorSampleRate: 1.0,
        }),
      ],
      // Performance Monitoring
      tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
      // Release Health
      autoSessionTracking: true,
      // Set sample rate for profiling - this is relative to tracesSampleRate
      profilesSampleRate: 1.0,
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
    extra: context,
  });
}

// Performance monitoring helper
export function startSpan(name: string, op: string, callback: () => any) {
  return Sentry.startSpan({ name, op }, callback);
}

// User context helper
export function setUserContext(user: { id: string; email?: string; username?: string }) {
  Sentry.setUser(user);
}

// Clear user context on logout
export function clearUserContext() {
  Sentry.setUser(null);
}