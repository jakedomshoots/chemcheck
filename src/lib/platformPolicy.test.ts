// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://192.168.4.193:5174/"}

import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadPolicy({
  lanBypass = '',
  disableBypass = '',
}: {
  lanBypass?: string;
  disableBypass?: string;
} = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_ENABLE_LOCAL_NETWORK_AUTH_BYPASS', lanBypass);
  vi.stubEnv('VITE_DISABLE_AUTH_BYPASS', disableBypass);

  return import('./platformPolicy');
}

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
