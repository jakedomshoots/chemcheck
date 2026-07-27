export interface ServiceWorkerEnvironmentPolicy {
  disableServiceWorker: boolean;
  enableInDev: boolean;
  registerInProduction: boolean;
}

export interface AuthBypassEnvironmentPolicy {
  iosSimulatorBypassEnabled: boolean;
  localhostAuthBypassEnabled: boolean;
  localNetworkAuthBypassEnabled: boolean;
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
  // Explicit opt-in for testing from a phone on the same private network.
  localNetworkBypassEnabled: toBoolean(import.meta.env.VITE_ENABLE_LOCAL_NETWORK_AUTH_BYPASS),
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
  localNetworkAuthBypassEnabled: env.localNetworkBypassEnabled,
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
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function isPrivateNetworkHost(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (normalizedHostname.endsWith('.local')) return true;

  const ipv4Parts = normalizedHostname.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every((part) => /^\d{1,3}$/.test(part))) {
    const octets = ipv4Parts.map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return false;

    const [first, second] = octets;
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }

  if (!normalizedHostname.includes(':')) return false;

  const firstIpv6Group = Number.parseInt(normalizedHostname.split(':')[0], 16);
  if (Number.isNaN(firstIpv6Group)) return false;

  const isUniqueLocalIpv6 = (firstIpv6Group & 0xfe00) === 0xfc00;
  const isLinkLocalIpv6 = (firstIpv6Group & 0xffc0) === 0xfe80;
  return isUniqueLocalIpv6 || isLinkLocalIpv6;
}

export function shouldUseLocalhostAuthBypass(): boolean {
  if (!env.isDev || env.bypassDisabled) return false;
  if (!env.localhostBypassEnabled) return false;

  return isLocalhostHost(getHostname());
}

export function shouldUseLocalNetworkAuthBypass(): boolean {
  if (!env.isDev || env.bypassDisabled) return false;
  if (!env.localNetworkBypassEnabled) return false;

  return isPrivateNetworkHost(getHostname());
}

export function shouldUseIosSimulatorAuthBypass(): boolean {
  if (!env.isDev || env.bypassDisabled) return false;
  if (!env.iosSimulatorBypassEnabled) return false;

  if (!isBrowser()) return false;

  const capacitor = (window as any).Capacitor;
  if (!capacitor || typeof capacitor.getPlatform !== 'function') return false;

  return capacitor.getPlatform() === 'ios';
}

export function shouldUseDevelopmentAuthBypass(): boolean {
  return (
    shouldUseLocalhostAuthBypass() ||
    shouldUseLocalNetworkAuthBypass() ||
    shouldUseIosSimulatorAuthBypass()
  );
}

export function getAuthBypassReason(): 'disabled' | 'localhost' | 'local-network' | 'ios-simulator' | 'none' {
  if (env.bypassDisabled) return 'disabled';
  if (shouldUseLocalhostAuthBypass()) return 'localhost';
  if (shouldUseLocalNetworkAuthBypass()) return 'local-network';
  if (shouldUseIosSimulatorAuthBypass()) return 'ios-simulator';
  return 'none';
}
