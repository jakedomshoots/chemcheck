declare global {
  interface ImportMetaEnv {
    readonly VITE_GA_MEASUREMENT_ID?: string;
    readonly DEV?: boolean;
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

export function initAnalytics(): void {
  if (!GA_MEASUREMENT_ID) {
    console.log('[Analytics] No measurement ID configured, skipping initialization');
    return;
  }

  if (import.meta.env.DEV) {
    console.log('[Analytics] Development mode, skipping initialization');
    return;
  }

  if (navigator.doNotTrack === '1') {
    console.log('[Analytics] Do Not Track enabled, skipping initialization');
    return;
  }

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
  if (!GA_MEASUREMENT_ID || !window.gtag) return;

  window.gtag('event', 'page_view', {
    page_path: pagePath,
    page_title: pageTitle,
  });
}

export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (!GA_MEASUREMENT_ID || !window.gtag) return;

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
  if (!GA_MEASUREMENT_ID || !window.gtag) return;

  window.gtag('set', 'user_properties', properties);
}

export function optOutAnalytics(): void {
  localStorage.setItem('analytics_opt_out', 'true');

  if (GA_MEASUREMENT_ID) {
    (window as unknown as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`] = true;
  }
}

export function hasOptedOut(): boolean {
  return localStorage.getItem('analytics_opt_out') === 'true';
}

export function optInAnalytics(): void {
  localStorage.removeItem('analytics_opt_out');

  if (GA_MEASUREMENT_ID) {
    delete (window as unknown as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`];
    initAnalytics();
  }
}
