type EnvShape = {
  DEV?: boolean;
  PROD?: boolean;
  VITE_APP_VERSION?: string;
  VITE_IOS_SIM_AUTH_BYPASS?: string;
  VITE_DISABLE_AUTH_BYPASS?: string;
  VITE_ENABLE_LOCALHOST_AUTH_BYPASS?: string;
  VITE_ENABLE_SERVICE_WORKER_DEV?: string;
  VITE_DISABLE_SERVICE_WORKER?: string;
};

type CreatePlatformPolicyOptions = {
  env: EnvShape;
  hostname?: string;
  capacitorPlatform?: string | null;
};

type RuntimeWindowShape = {
  location?: {
    hostname?: string;
  };
  Capacitor?: {
    getPlatform?: () => string;
  };
};

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

const toBoolean = (value?: string): boolean => value === "true";

export function assertNoProductionAuthBypassFlags(env: EnvShape): void {
  const iosSimulatorBypassEnabled = toBoolean(env.VITE_IOS_SIM_AUTH_BYPASS);
  const localhostAuthBypassEnabled = toBoolean(env.VITE_ENABLE_LOCALHOST_AUTH_BYPASS);

  if (env.PROD && (iosSimulatorBypassEnabled || localhostAuthBypassEnabled)) {
    throw new Error("Auth bypass flags must not be enabled in production.");
  }
}

export function resolveAuthBypassPolicy(env: EnvShape): AuthBypassEnvironmentPolicy {
  assertNoProductionAuthBypassFlags(env);

  const bypassDisabled = toBoolean(env.VITE_DISABLE_AUTH_BYPASS);
  const iosSimulatorBypassEnabled = toBoolean(env.VITE_IOS_SIM_AUTH_BYPASS);
  const localhostAuthBypassEnabled = toBoolean(env.VITE_ENABLE_LOCALHOST_AUTH_BYPASS);

  return {
    iosSimulatorBypassEnabled,
    localhostAuthBypassEnabled,
    bypassDisabled,
  };
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function createPlatformPolicy(options: CreatePlatformPolicyOptions) {
  const { env, hostname = "", capacitorPlatform = null } = options;
  const authBypassPolicy = resolveAuthBypassPolicy(env);
  const serviceWorkerPolicy: ServiceWorkerEnvironmentPolicy = {
    disableServiceWorker: toBoolean(env.VITE_DISABLE_SERVICE_WORKER),
    enableInDev: toBoolean(env.VITE_ENABLE_SERVICE_WORKER_DEV),
    registerInProduction: Boolean(env.PROD),
  };

  function shouldRegisterServiceWorker(): boolean {
    if (serviceWorkerPolicy.disableServiceWorker) return false;
    if (env.PROD) return true;
    return serviceWorkerPolicy.enableInDev;
  }

  function shouldUseLocalhostAuthBypass(): boolean {
    if (!env.DEV || authBypassPolicy.bypassDisabled) return false;
    if (!authBypassPolicy.localhostAuthBypassEnabled) return false;
    return isLocalhostHost(hostname);
  }

  function shouldUseIosSimulatorAuthBypass(): boolean {
    if (!env.DEV || authBypassPolicy.bypassDisabled) return false;
    if (!authBypassPolicy.iosSimulatorBypassEnabled) return false;
    return capacitorPlatform === "ios";
  }

  function getAuthBypassReason(): "disabled" | "localhost" | "ios-simulator" | "none" {
    if (authBypassPolicy.bypassDisabled) return "disabled";
    if (shouldUseLocalhostAuthBypass()) return "localhost";
    if (shouldUseIosSimulatorAuthBypass()) return "ios-simulator";
    return "none";
  }

  return {
    authBypassPolicy,
    serviceWorkerPolicy,
    appRuntime: {
      isDev: Boolean(env.DEV),
      isProd: Boolean(env.PROD),
      appVersion: env.VITE_APP_VERSION || "1.0.0",
    },
    shouldRegisterServiceWorker,
    shouldUseLocalhostAuthBypass,
    shouldUseIosSimulatorAuthBypass,
    getAuthBypassReason,
  };
}

export function getPlatformPolicy({
  env,
  runtimeWindow,
}: {
  env: EnvShape;
  runtimeWindow?: RuntimeWindowShape;
}) {
  const policy = createPlatformPolicy({
    env,
    hostname: runtimeWindow?.location?.hostname || "",
    capacitorPlatform:
      runtimeWindow?.Capacitor && typeof runtimeWindow.Capacitor.getPlatform === "function"
        ? runtimeWindow.Capacitor.getPlatform()
        : null,
  });

  const isLocalhostAuthBypassEnabled = policy.shouldUseLocalhostAuthBypass();
  const isIosSimulatorAuthBypassEnabled = policy.shouldUseIosSimulatorAuthBypass();

  return {
    ...policy,
    isLocalhostAuthBypassEnabled,
    isIosSimulatorAuthBypassEnabled,
    isAuthBypassEnabled: isLocalhostAuthBypassEnabled || isIosSimulatorAuthBypassEnabled,
  };
}

const capacitorPlatform =
  typeof window !== "undefined" && window.Capacitor && typeof window.Capacitor.getPlatform === "function"
    ? window.Capacitor.getPlatform()
    : null;

const platformPolicy = createPlatformPolicy({
  env: import.meta.env,
  hostname: typeof window !== "undefined" ? window.location.hostname : "",
  capacitorPlatform,
});

export const { authBypassPolicy, serviceWorkerPolicy, appRuntime } = platformPolicy;
export const shouldRegisterServiceWorker = platformPolicy.shouldRegisterServiceWorker;
export const shouldUseLocalhostAuthBypass = platformPolicy.shouldUseLocalhostAuthBypass;
export const shouldUseIosSimulatorAuthBypass = platformPolicy.shouldUseIosSimulatorAuthBypass;
export const getAuthBypassReason = platformPolicy.getAuthBypassReason;
