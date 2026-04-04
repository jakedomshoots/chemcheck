import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('./monitoring', () => ({
  monitoring: {
    recordMetric: vi.fn(),
  },
}));

vi.mock('@/lib/platformPolicy', () => ({
  shouldRegisterServiceWorker: vi.fn(),
}));

import { shouldRegisterServiceWorker } from '@/lib/platformPolicy';

import {
  cleanupServiceWorker,
  getServiceWorkerState,
  registerServiceWorker,
  unregisterServiceWorker,
} from './serviceWorker';

describe('serviceWorkerManager', () => {
  const mockedPolicy = vi.mocked(shouldRegisterServiceWorker);

  let originalServiceWorkerDescriptor: PropertyDescriptor | undefined;

  function installServiceWorkerMock() {
    const registration = {
      waiting: null,
      scope: '/',
      sync: {
        register: vi.fn(),
      },
      update: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      unregister: vi.fn().mockResolvedValue(true),
    };

    const serviceWorker = {
      controller: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getRegistration: vi.fn().mockResolvedValue(registration),
      register: vi.fn().mockResolvedValue(registration),
      _registration: registration,
    } as any;

    originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });

    return { serviceWorker, registration };
  }

  function restoreServiceWorker() {
    if (originalServiceWorkerDescriptor) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorkerDescriptor);
      return;
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    originalServiceWorkerDescriptor = undefined;
    cleanupServiceWorker();
  });

  afterEach(() => {
    cleanupServiceWorker();
    restoreServiceWorker();
  });

  it('does not attempt registration when policy disables service worker and unregisters any existing registration', async () => {
    mockedPolicy.mockReturnValue(false);

    const { registration } = installServiceWorkerMock();

    await registerServiceWorker();

    expect(mockedPolicy).toHaveBeenCalledTimes(1);
    expect(registration.unregister).toHaveBeenCalledTimes(1);
    expect(getServiceWorkerState().isRegistered).toBe(false);
  });

  it('registers once when registration is enabled and returns existing registration on subsequent calls', async () => {
    mockedPolicy.mockReturnValue(true);
    const { serviceWorker, registration } = installServiceWorkerMock();

    await registerServiceWorker();
    await registerServiceWorker();

    expect(mockedPolicy).toHaveBeenCalledTimes(2);
    expect(serviceWorker.getRegistration).toHaveBeenCalledTimes(1);
    expect(serviceWorker.register).toHaveBeenCalledTimes(0);
    expect(serviceWorker.getRegistration).toHaveBeenCalledWith('/');
    expect(getServiceWorkerState().isRegistered).toBe(true);
    expect(registration.addEventListener).toHaveBeenCalledWith('updatefound', expect.any(Function));
    expect(serviceWorker.addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
  });

  it('is no-op in unsupported environments and never throws', async () => {
    mockedPolicy.mockReturnValue(true);

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    });

    const state = await registerServiceWorker();

    expect(state.isSupported).toBe(false);
    expect(state.isRegistered).toBe(false);
  });

  it('unregisters an active registration and leaves manager clean', async () => {
    mockedPolicy.mockReturnValue(true);
    const { serviceWorker, registration } = installServiceWorkerMock();

    await registerServiceWorker();
    await unregisterServiceWorker();

    expect(registration.unregister).toHaveBeenCalledTimes(1);
    expect(serviceWorker.getRegistration).toHaveBeenCalled();
    expect(getServiceWorkerState().isRegistered).toBe(false);
  });
});
