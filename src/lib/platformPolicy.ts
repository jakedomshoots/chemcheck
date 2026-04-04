export interface ServiceWorkerEnvironmentPolicy {
  disableServiceWorker: boolean;
  enableInDev: boolean;
  registerInProduction: boolean;
}

export interface AuthBypassEnvironmentPolicy {
  iosSimulatorBypassEnabled: boolean;
  localhostAuthBypassEnabled: boolean;
  bypassDisabled: boolean;
}

const toBoolean = (value?: string): boolean => value === 'true';

const env = {
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
  appVersion: import.meta.env.VITE_APP_VERSION || '1.0.0',
  iosSimulatorBypassEnabled: toBoolean(import.meta.env.VITE_IOS_SIM_AUTH_BYPASS),
  // Optional hard-disable for any auth bypass in shared environments.
  bypassDisabled: toBoolean(import.meta.env.VITE_DISABLE_AUTH_BYPASS),
  // Optional explicit opt-in for localhost auth bypass to keep intent clear.
  localhostBypassEnabled:
    import.meta.env.VITE_ENABLE_LOCALHOST_AUTH_BYPASS === undefined
      ? true
      : toBoolean(import.meta.env.VITE_ENABLE_LOCALHOST_AUTH_BYPASS),
  enableServiceWorkerInDev: toBoolean(import.meta.env.VITE_ENABLE_SERVICE_WORKER_DEV),
  disableServiceWorker: toBoolean(import.meta.env.VITE_DISABLE_SERVICE_WORKER)
};

const isBrowser = () => typeof window !== 'undefined';
const getHostname = () => (isBrowser() ? window.location.hostname : '');

export const serviceWorkerPolicy: ServiceWorkerEnvironmentPolicy = {
  disableServiceWorker: env.disableServiceWorker,
  enableInDev: env.enableServiceWorkerInDev,
  registerInProduction: env.isProd
};

export const authBypassPolicy: AuthBypassEnvironmentPolicy = {
  iosSimulatorBypassEnabled: env.iosSimulatorBypassEnabled,
  localhostAuthBypassEnabled: env.localhostBypassEnabled,
  bypassDisabled: env.bypassDisabled
};

export const appRuntime = {
  isDev: env.isDev,
  isProd: env.isProd,
  appVersion: env.appVersion
};

export function shouldRegisterServiceWorker(): boolean {
  if (env.disableServiceWorker) return false;

  if (env.isProd) return true;
  return env.enableServiceWorkerInDev;
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function shouldUseLocalhostAuthBypass(): boolean {
  if (!env.isDev || env.bypassDisabled) return false;
  if (!env.localhostBypassEnabled) return false;

  return isLocalhostHost(getHostname());
}

export function shouldUseIosSimulatorAuthBypass(): boolean {
  if (!env.isDev || env.bypassDisabled) return false;
  if (!env.iosSimulatorBypassEnabled) return false;

  if (!isBrowser()) return false;

  const capacitor = (window as any).Capacitor;
  if (!capacitor || typeof capacitor.getPlatform !== 'function') return false;

  return capacitor.getPlatform() === 'ios';
}

export function getAuthBypassReason(): 'disabled' | 'localhost' | 'ios-simulator' | 'none' {
  if (env.bypassDisabled) return 'disabled';
  if (shouldUseLocalhostAuthBypass()) return 'localhost';
  if (shouldUseIosSimulatorAuthBypass()) return 'ios-simulator';
  return 'none';
}

