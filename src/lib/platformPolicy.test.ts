// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://192.168.4.193:5174/"}

import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadPolicy({
  lanBypass = '',
  disableBypass = '',
  localhostBypass,
  prod,
}: {
  lanBypass?: string;
  disableBypass?: string;
  localhostBypass?: string;
  prod?: boolean;
} = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_ENABLE_LOCAL_NETWORK_AUTH_BYPASS', lanBypass);
  vi.stubEnv('VITE_DISABLE_AUTH_BYPASS', disableBypass);
  vi.stubEnv('VITE_ENABLE_LOCALHOST_AUTH_BYPASS', localhostBypass ?? '');
  vi.stubEnv('VITE_IOS_SIM_AUTH_BYPASS', '');
  if (prod !== undefined) {
    vi.stubEnv('PROD', prod);
    vi.stubEnv('DEV', !prod);
  }

  return import('./platformPolicy');
}

describe('localhost auth bypass policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is disabled unless VITE_ENABLE_LOCALHOST_AUTH_BYPASS is explicitly true', async () => {
    const policy = await loadPolicy();
    expect(policy.authBypassPolicy.localhostAuthBypassEnabled).toBe(false);

    const enabled = await loadPolicy({ localhostBypass: 'true' });
    expect(enabled.authBypassPolicy.localhostAuthBypassEnabled).toBe(true);
  });

  it('refuses to load when any bypass flag is set in a production build', async () => {
    await expect(loadPolicy({ localhostBypass: 'true', prod: true })).rejects.toThrow(/not allowed in production/);
    await expect(loadPolicy({ lanBypass: 'true', prod: true })).rejects.toThrow(/VITE_ENABLE_LOCAL_NETWORK_AUTH_BYPASS/);
    await expect(loadPolicy({ prod: true })).resolves.toBeDefined();
  });

  it('exposes the guard for direct use', async () => {
    const policy = await loadPolicy();
    expect(() => policy.assertNoAuthBypassInProduction({
      isProd: true,
      iosSimulatorBypassEnabled: true,
      localhostBypassEnabled: false,
      localNetworkBypassEnabled: false,
    })).toThrow(/VITE_IOS_SIM_AUTH_BYPASS/);
    expect(() => policy.assertNoAuthBypassInProduction({
      isProd: false,
      iosSimulatorBypassEnabled: true,
      localhostBypassEnabled: true,
      localNetworkBypassEnabled: true,
    })).not.toThrow();
  });
});

describe('local-network auth bypass policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('stays disabled on a private network unless explicitly enabled', async () => {
    const policy = await loadPolicy();

    expect(policy.shouldUseLocalNetworkAuthBypass()).toBe(false);
  });

  it('allows an explicitly enabled development preview on a private IPv4 host', async () => {
    const policy = await loadPolicy({ lanBypass: 'true' });

    expect(policy.shouldUseLocalNetworkAuthBypass()).toBe(true);
    expect(policy.shouldUseDevelopmentAuthBypass()).toBe(true);
    expect(policy.getAuthBypassReason()).toBe('local-network');
  });

  it('honors the global bypass kill switch', async () => {
    const policy = await loadPolicy({ lanBypass: 'true', disableBypass: 'true' });

    expect(policy.shouldUseLocalNetworkAuthBypass()).toBe(false);
    expect(policy.shouldUseDevelopmentAuthBypass()).toBe(false);
    expect(policy.getAuthBypassReason()).toBe('disabled');
  });

  it('classifies private and public hosts conservatively', async () => {
    const policy = await loadPolicy();

    expect(policy.isPrivateNetworkHost('192.168.4.193')).toBe(true);
    expect(policy.isPrivateNetworkHost('10.0.0.8')).toBe(true);
    expect(policy.isPrivateNetworkHost('172.16.4.2')).toBe(true);
    expect(policy.isPrivateNetworkHost('172.31.255.254')).toBe(true);
    expect(policy.isPrivateNetworkHost('device.local')).toBe(true);
    expect(policy.isPrivateNetworkHost('172.32.0.1')).toBe(false);
    expect(policy.isPrivateNetworkHost('8.8.8.8')).toBe(false);
    expect(policy.isPrivateNetworkHost('fc00.example.com')).toBe(false);
    expect(policy.isPrivateNetworkHost('chemcheck.example.com')).toBe(false);
  });
});
