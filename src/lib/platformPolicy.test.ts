import { describe, expect, it } from 'vitest';
import {
  assertNoProductionAuthBypassFlags,
  getPlatformPolicy,
} from './platformPolicy';

function createWindowLike({
  hostname = 'app.chemcheck.test',
  platform,
}: {
  hostname?: string;
  platform?: string;
} = {}) {
  return {
    location: { hostname },
    Capacitor: platform
      ? {
          getPlatform: () => platform,
        }
      : undefined,
  };
}

describe('platformPolicy', () => {
  it('requires an explicit localhost bypass flag in development', () => {
    const policy = getPlatformPolicy({
      env: {
        DEV: true,
        PROD: false,
        VITE_ENABLE_LOCALHOST_AUTH_BYPASS: 'true',
        VITE_IOS_SIM_AUTH_BYPASS: 'false',
      },
      runtimeWindow: createWindowLike({ hostname: 'localhost' }),
    });

    expect(policy.isLocalhostAuthBypassEnabled).toBe(true);
    expect(policy.isAuthBypassEnabled).toBe(true);
  });

  it('keeps localhost bypass disabled without the explicit flag', () => {
    const policy = getPlatformPolicy({
      env: {
        DEV: true,
        PROD: false,
        VITE_ENABLE_LOCALHOST_AUTH_BYPASS: 'false',
        VITE_IOS_SIM_AUTH_BYPASS: 'false',
      },
      runtimeWindow: createWindowLike({ hostname: 'localhost' }),
    });

    expect(policy.isLocalhostAuthBypassEnabled).toBe(false);
    expect(policy.isAuthBypassEnabled).toBe(false);
  });

  it('preserves the iOS simulator bypass in development only', () => {
    const policy = getPlatformPolicy({
      env: {
        DEV: true,
        PROD: false,
        VITE_ENABLE_LOCALHOST_AUTH_BYPASS: 'false',
        VITE_IOS_SIM_AUTH_BYPASS: 'true',
      },
      runtimeWindow: createWindowLike({ platform: 'ios' }),
    });

    expect(policy.isIosSimulatorAuthBypassEnabled).toBe(true);
    expect(policy.isAuthBypassEnabled).toBe(true);
  });

  it('fails closed in production when any bypass flag is enabled', () => {
    expect(() =>
      assertNoProductionAuthBypassFlags({
        DEV: false,
        PROD: true,
        VITE_ENABLE_LOCALHOST_AUTH_BYPASS: 'true',
        VITE_IOS_SIM_AUTH_BYPASS: 'false',
      })
    ).toThrow(/bypass/i);
  });
});
