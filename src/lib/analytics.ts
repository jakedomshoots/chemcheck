declare global {
  interface ImportMetaEnv {
    readonly VITE_GA_MEASUREMENT_ID?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;
export const ANALYTICS_OPT_OUT_KEY = 'analytics_opt_out';

function setGaDisableFlag(disabled: boolean): void {
  if (!GA_MEASUREMENT_ID || typeof window === 'undefined') return;
  const flags = window as unknown as Record<string, unknown>;
  if (disabled) {
    flags[`ga-disable-${GA_MEASUREMENT_ID}`] = true;
  } else {
    delete flags[`ga-disable-${GA_MEASUREMENT_ID}`];
  }
}

export function isDoNotTrackEnabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { msDoNotTrack?: string };
  const win = (typeof window !== 'undefined' ? window : {}) as Window & { doNotTrack?: string };
  const signal = nav.doNotTrack ?? win.doNotTrack ?? nav.msDoNotTrack;
  return signal === '1' || signal === 'yes';
}

/** True when GA must not be loaded: user opt-out, Do Not Track, or no id. */
export function isAnalyticsBlocked(): boolean {
  return !GA_MEASUREMENT_ID || hasOptedOut() || isDoNotTrackEnabled();
}

export function initAnalytics(): void {
  if (!GA_MEASUREMENT_ID) {
    console.log('[Analytics] No measurement ID configured, skipping initialization');
    return;
  }

  // Honor the opt-out before anything else so the disable flag is in place
  // even if a stray gtag script is ever loaded.
  if (hasOptedOut()) {
    setGaDisableFlag(true);
    console.log('[Analytics] User opted out, skipping initialization');
    return;
  }

  if (isDoNotTrackEnabled()) {
    setGaDisableFlag(true);
    console.log('[Analytics] Do Not Track enabled, skipping initialization');
    return;
  }

  if (import.meta.env.DEV) {
    console.log('[Analytics] Development mode, skipping initialization');
    return;
  }

  setGaDisableFlag(false);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer.push(args);
  };

  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  console.log('[Analytics] Initialized');
}

export function trackPageView(pagePath: string, pageTitle?: string): void {
  if (isAnalyticsBlocked() || !window.gtag) return;

  window.gtag('event', 'page_view', {
    page_path: pagePath,
    page_title: pageTitle,
  });
}

export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (isAnalyticsBlocked() || !window.gtag) return;

  window.gtag('event', eventName, params);
}

export const AnalyticsEvents = {
  signUp: () => trackEvent('sign_up'),
  login: () => trackEvent('login'),
  logout: () => trackEvent('logout'),

  createCustomer: () => trackEvent('create_customer'),
  logService: () => trackEvent('log_service'),
  viewReport: (reportType: string) => trackEvent('view_report', { report_type: reportType }),
  exportData: () => trackEvent('export_data'),

  viewPricing: () => trackEvent('view_pricing'),
  startTrial: () => trackEvent('start_trial'),
  subscribe: (plan: string) => trackEvent('subscribe', { plan }),
  cancelSubscription: () => trackEvent('cancel_subscription'),

  installPWA: () => trackEvent('install_pwa'),
  enableNotifications: () => trackEvent('enable_notifications'),
  useOffline: () => trackEvent('use_offline'),

  error: (errorType: string) => trackEvent('error', { error_type: errorType }),
};

export function setUserProperties(properties: {
  subscription_tier?: string;
  customer_count_range?: string;
  has_team?: boolean;
}): void {
  if (isAnalyticsBlocked() || !window.gtag) return;

  window.gtag('set', 'user_properties', properties);
}

export function optOutAnalytics(): void {
  try {
    localStorage.setItem(ANALYTICS_OPT_OUT_KEY, 'true');
  } catch {
    // Storage unavailable; the window flag below still blocks GA for this page.
  }
  setGaDisableFlag(true);
}

export function hasOptedOut(): boolean {
  try {
    return localStorage.getItem(ANALYTICS_OPT_OUT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function optInAnalytics(): void {
  try {
    localStorage.removeItem(ANALYTICS_OPT_OUT_KEY);
  } catch {
    // ignore
  }

  if (GA_MEASUREMENT_ID) {
    setGaDisableFlag(false);
    initAnalytics();
  }
}
