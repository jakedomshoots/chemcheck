// Service Worker Registration and Management
// Handles PWA functionality, offline support, and app updates

import { monitoring } from './monitoring';
import { shouldRegisterServiceWorker } from './platformPolicy';

const SW_SCRIPT_PATH = '/sw.js';
const SW_SCOPE = '/';
const SW_DEFAULT_METRIC_PREFIX = 'service_worker';

export interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  isControlling: boolean;
  hasUpdate: boolean;
  registration: ServiceWorkerRegistration | null;
}

export interface UpdateAvailableEvent {
  type: 'update-available';
  registration: ServiceWorkerRegistration;
}

export interface UpdateInstalledEvent {
  type: 'update-installed';
  registration: ServiceWorkerRegistration;
}

export type ServiceWorkerEvent = UpdateAvailableEvent | UpdateInstalledEvent;

class ServiceWorkerManager {
  private registration: ServiceWorkerRegistration | null = null;
  private listeners: ((event: ServiceWorkerEvent) => void)[] = [];
  private isRegistering = false;
  private readonly UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
  private updateCheckInterval: number | null = null;
  private updateListenersInitialized = false;
  private networkListenersInitialized = false;
  private visibilityChangeListener: (() => void) | null = null;
  private onlineListener: (() => void) | null = null;
  private offlineListener: (() => void) | null = null;
  private controllerChangeListener: (() => void) | null = null;
  private updateFoundListener: (() => void) | null = null;
  private messageListener: ((event: MessageEvent) => void) | null = null;

  constructor() {
    this.setupMessageListener();
  }

  // ============================================
  // Registration
  // ============================================

  async register(): Promise<ServiceWorkerState> {
    if (!this.shouldAttemptRegistration()) {
      if (this.isSupported()) {
        monitoring.recordMetric(`${SW_DEFAULT_METRIC_PREFIX}_not_attempted`, performance.now(), {
          reason: 'policy_disabled'
        });
        await this.unregisterForPolicy();
      }
      return this.getState();
    }

    if (this.isRegistering) {
      return this.getState();
    }

    if (this.registration) {
      this.setupUpdateListeners();
      this.startUpdateChecks();
      this.setupNetworkListeners();
      return this.getState();
    }

    if (!this.isSupported()) {
      return this.getState();
    }

    this.isRegistering = true;
    try {
      const existingRegistration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
      const registration = existingRegistration ??
        await navigator.serviceWorker.register(SW_SCRIPT_PATH, { scope: SW_SCOPE });

      this.registration = registration;
      this.setupUpdateListeners();
      this.startUpdateChecks();
      this.setupNetworkListeners();

      monitoring.recordMetric('service_worker_registered', performance.now(), {
        scope: SW_SCOPE,
        script: SW_SCRIPT_PATH,
        hasUpdate: !!registration.waiting
      });

      return this.getState();
    } catch (error) {
      console.error('[SW] Service worker registration failed:', error);
      monitoring.recordMetric('service_worker_register_failed', performance.now(), {
        reason: error instanceof Error ? error.message : 'unknown'
      });
      return this.getState();
    } finally {
      this.isRegistering = false;
    }
  }

  // ============================================
  // Update Management
  // ============================================

  private setupUpdateListeners(): void {
    if (!this.registration || this.updateListenersInitialized) return;
    if (!this.isSupported()) return;

    this.updateFoundListener = () => {
      if (!this.registration) return;

      const newWorker = this.registration.installing;
      if (!newWorker) return;

      const stateChangeHandler = () => {
        if (newWorker.state === 'installed') {
          const controllerExists = !!navigator.serviceWorker.controller;

          if (controllerExists) {
            this.notifyListeners({ type: 'update-available', registration: this.registration! });
          } else {
            this.notifyListeners({ type: 'update-installed', registration: this.registration! });
          }
        }

        if (newWorker.state === 'installed' || newWorker.state === 'activated' || newWorker.state === 'redundant') {
          newWorker.removeEventListener('statechange', stateChangeHandler);
        }
      };

      newWorker.addEventListener('statechange', stateChangeHandler);
    };

    this.controllerChangeListener = () => {
      console.log('[SW] Service worker took control');
      monitoring.recordMetric('sw_controller_change', performance.now());
      window.location.reload();
    };

    this.registration.addEventListener('updatefound', this.updateFoundListener);
    navigator.serviceWorker.addEventListener('controllerchange', this.controllerChangeListener);
    this.updateListenersInitialized = true;
  }

  private startUpdateChecks(): void {
    if (!this.isSupported()) return;
    if (this.updateCheckInterval !== null) return;

    this.updateCheckInterval = window.setInterval(() => {
      this.checkForUpdates();
    }, this.UPDATE_CHECK_INTERVAL_MS);
  }

  async checkForUpdates(): Promise<void> {
    if (!this.isSupported()) return;

    let activeRegistration = this.registration;
    if (!activeRegistration) {
      activeRegistration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
      this.registration = activeRegistration;
    }

    if (!activeRegistration) return;

    try {
      await activeRegistration.update();
    } catch (error) {
      console.error('[SW] Update check failed:', error);
      monitoring.recordMetric('sw_update_check_failed', performance.now(), {
        reason: error instanceof Error ? error.message : 'unknown'
      });
    }

    if (document.hidden) return;

    this.startVisibilityMonitoring();
  }

  private startVisibilityMonitoring(): void {
    if (this.visibilityChangeListener || !this.isSupported()) return;

    this.visibilityChangeListener = () => {
      if (!document.hidden) {
        this.checkForUpdates();
      }
    };

    document.addEventListener('visibilitychange', this.visibilityChangeListener);
  }

  async applyUpdate(): Promise<void> {
    if (!this.registration || !this.registration.waiting) {
      throw new Error('No update available');
    }

    this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  // ============================================
  // State Management
  // ============================================

  getState(): ServiceWorkerState {
    const sw = this.isSupported() ? navigator.serviceWorker : null;
    return {
      isSupported: this.isSupported(),
      isRegistered: !!this.registration,
      isControlling: !!(sw && sw.controller),
      hasUpdate: !!(this.registration?.waiting),
      registration: this.registration
    };
  }

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !!navigator.serviceWorker;
  }

  isOnline(): boolean {
    return typeof navigator === 'undefined' ? false : navigator.onLine;
  }

  // ============================================
  // Event Handling
  // ============================================

  addEventListener(listener: (event: ServiceWorkerEvent) => void): void {
    if (!this.listeners.includes(listener)) {
      this.listeners.push(listener);
    }
  }

  removeEventListener(listener: (event: ServiceWorkerEvent) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  private notifyListeners(event: ServiceWorkerEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[SW] Event listener error:', error);
      }
    });
  }

  private setupMessageListener(): void {
    if (!this.isSupported()) return;
    if (this.messageListener) return;

    this.messageListener = (event) => {
      if (event.data?.type === 'BACKGROUND_BACKUP_REQUEST') {
        window.dispatchEvent(new CustomEvent('sw-backup-request', {
          detail: event.data
        }));
      }
    };

    navigator.serviceWorker.addEventListener('message', this.messageListener);
  }

  // ============================================
  // Cache Management
  // ============================================

  async clearCaches(): Promise<void> {
    if (!this.isSupported()) return;

    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
      console.log('[SW] All caches cleared');
    } catch (error) {
      console.error('[SW] Failed to clear caches:', error);
      throw error;
    }
  }

  async getCacheSize(): Promise<number> {
    if (!this.isSupported()) return 0;

    try {
      let totalSize = 0;
      const cacheNames = await caches.keys();

      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();

        for (const request of requests) {
          const response = await cache.match(request);
          if (response) {
            const blob = await response.blob();
            totalSize += blob.size;
          }
        }
      }

      return totalSize;
    } catch (error) {
      console.error('[SW] Failed to calculate cache size:', error);
      return 0;
    }
  }

  // ============================================
  // Network Status
  // ============================================

  setupNetworkListeners(): void {
    if (!this.isSupported() || this.networkListenersInitialized) return;

    this.onlineListener = () => {
      monitoring.recordMetric('network_online', performance.now());

      if (this.registration && 'sync' in window.ServiceWorkerRegistration.prototype) {
        this.registration.sync.register('backup-sync').catch(error => {
          console.error('[SW] Background sync registration failed:', error);
        });
      }
    };

    this.offlineListener = () => {
      monitoring.recordMetric('network_offline', performance.now());
    };

    window.addEventListener('online', this.onlineListener);
    window.addEventListener('offline', this.offlineListener);
    this.networkListenersInitialized = true;
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(): void {
    if (!this.isSupported()) {
      this.resetRuntimeFlags();
      this.registration = null;
      this.isRegistering = false;
      return;
    }

    if (this.updateCheckInterval !== null) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }

    if (this.visibilityChangeListener) {
      document.removeEventListener('visibilitychange', this.visibilityChangeListener);
      this.visibilityChangeListener = null;
    }

    if (this.onlineListener) {
      window.removeEventListener('online', this.onlineListener);
      this.onlineListener = null;
    }

    if (this.offlineListener) {
      window.removeEventListener('offline', this.offlineListener);
      this.offlineListener = null;
    }

    if (this.registration && this.updateFoundListener) {
      this.registration.removeEventListener('updatefound', this.updateFoundListener);
      this.updateFoundListener = null;
    }

    if (this.controllerChangeListener && navigator && navigator.serviceWorker) {
      navigator.serviceWorker.removeEventListener('controllerchange', this.controllerChangeListener);
      this.controllerChangeListener = null;
    }

    if (this.messageListener && navigator && navigator.serviceWorker) {
      navigator.serviceWorker.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }

    this.listeners = [];
    this.updateListenersInitialized = false;
    this.networkListenersInitialized = false;
    this.registration = null;
    this.isRegistering = false;
  }

  async unregister(): Promise<void> {
    if (!this.isSupported()) return;

    try {
      const registration = this.registration || await navigator.serviceWorker.getRegistration(SW_SCOPE);
      if (registration) {
        const unregistered = await registration.unregister();
        monitoring.recordMetric('service_worker_unregistered', performance.now(), {
          scope: SW_SCRIPT_PATH,
          status: unregistered ? 'success' : 'noop',
        });
      }
    } catch (error) {
      monitoring.recordMetric('service_worker_unregister_failed', performance.now(), {
        reason: error instanceof Error ? error.message : 'unknown'
      });
      console.error('[SW] Service worker unregister failed:', error);
    } finally {
      this.cleanup();
      this.registration = null;
    }
  }

  private async unregisterForPolicy(): Promise<void> {
    if (!this.isSupported()) return;

    const registered = this.registration || await navigator.serviceWorker.getRegistration(SW_SCOPE);
    if (!registered) return;

    await this.unregister();
  }

  private resetRuntimeFlags(): void {
    this.updateCheckInterval = null;
    this.listeners = [];
    this.updateListenersInitialized = false;
    this.networkListenersInitialized = false;
    this.visibilityChangeListener = null;
    this.onlineListener = null;
    this.offlineListener = null;
    this.controllerChangeListener = null;
    this.updateFoundListener = null;
    this.messageListener = null;
  }

  private shouldAttemptRegistration(): boolean {
    return shouldRegisterServiceWorker();
  }
}

// Global service worker manager instance
export const serviceWorkerManager = new ServiceWorkerManager();

// Convenience functions
export const registerServiceWorker = () => serviceWorkerManager.register();
export const checkForUpdates = () => serviceWorkerManager.checkForUpdates();
export const applyUpdate = () => serviceWorkerManager.applyUpdate();
export const getServiceWorkerState = () => serviceWorkerManager.getState();
export const cleanupServiceWorker = () => serviceWorkerManager.cleanup();
export const unregisterServiceWorker = () => serviceWorkerManager.unregister();
