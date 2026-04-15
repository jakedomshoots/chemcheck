/**
 * Analytics Integration
 * 
 * Provides Google Analytics 4 integration with privacy-first approach.
 * Only tracks anonymized usage data, no PII.
 */

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
    // Convex migration utility exposed for browser console usage
    migrateConvexData?: typeof import('@/utils/migrateFromConvex').migrateAll;
  }

  // Chrome-only Performance.memory API (not in standard TypeScript lib)
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
}

export {};

// GA4 Measurement ID - set via environment variable
const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

/**
 * Initialize Google Analytics
 * Call this once in main.jsx after app loads
 */
export function initAnalytics(): void {
  if (!GA_MEASUREMENT_ID) {
    return;
  }

  // Don't track in development
  if (import.meta.env.DEV) {
    return;
  }

  // Check for Do Not Track
  if (navigator.doNotTrack === '1') {
    return;
  }

  // Load gtag script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  // Initialize dataLayer
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer.push(args);
  };

  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    // Privacy settings
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
}

/**
 * Track page view
 */
export function trackPageView(pagePath: string, pageTitle?: string): void {
  if (!GA_MEASUREMENT_ID || !window.gtag) return;

  window.gtag('event', 'page_view', {
    page_path: pagePath,
    page_title: pageTitle,
  });
}

/**
 * Track custom event
 */
export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (!GA_MEASUREMENT_ID || !window.gtag) return;

  window.gtag('event', eventName, params);
}

// Pre-defined events for common actions
export const AnalyticsEvents = {
  // User actions
  signUp: () => trackEvent('sign_up'),
  login: () => trackEvent('login'),
  logout: () => trackEvent('logout'),

  // Feature usage
  createCustomer: () => trackEvent('create_customer'),
  logService: () => trackEvent('log_service'),
  viewReport: (reportType: string) => trackEvent('view_report', { report_type: reportType }),
  exportData: () => trackEvent('export_data'),
  
  // Subscription events
  viewPricing: () => trackEvent('view_pricing'),
  startTrial: () => trackEvent('start_trial'),
  subscribe: (plan: string) => trackEvent('subscribe', { plan }),
  cancelSubscription: () => trackEvent('cancel_subscription'),

  // PWA events
  installPWA: () => trackEvent('install_pwa'),
  enableNotifications: () => trackEvent('enable_notifications'),
  useOffline: () => trackEvent('use_offline'),

  // Errors (anonymized)
  error: (errorType: string) => trackEvent('error', { error_type: errorType }),
};

/**
 * Set user properties (anonymized)
 */
export function setUserProperties(properties: {
  subscription_tier?: string;
  customer_count_range?: string;
  has_team?: boolean;
}): void {
  if (!GA_MEASUREMENT_ID || !window.gtag) return;

  window.gtag('set', 'user_properties', properties);
}

/**
 * Opt out of analytics
 */
export function optOutAnalytics(): void {
  localStorage.setItem('analytics_opt_out', 'true');

  if (GA_MEASUREMENT_ID) {
    // Disable GA tracking
    (window as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`] = true;
  }
}

/**
 * Check if user has opted out
 */
export function hasOptedOut(): boolean {
  return localStorage.getItem('analytics_opt_out') === 'true';
}

/**
 * Opt back in to analytics
 */
export function optInAnalytics(): void {
  localStorage.removeItem('analytics_opt_out');

  if (GA_MEASUREMENT_ID) {
    delete (window as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`];
    initAnalytics();
  }
}
