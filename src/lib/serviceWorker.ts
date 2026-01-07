// Service Worker Registration and Management
// Handles PWA functionality, offline support, and app updates

import { monitoring } from './monitoring';

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
  private updateCheckInterval: number | null = null;

  constructor() {
    this.setupMessageListener();
  }

  // ============================================
  // Registration
  // ============================================

  async register(): Promise<ServiceWorkerState> {
    // Temporarily disable service worker to force fresh code
    console.log('[SW] Service worker disabled for debugging');
    return this.getState();
  }

  // ============================================
  // Update Management
  // ============================================

  private setupUpdateListeners(): void {
    if (!this.registration) return;

    // Listen for new service worker installing
    this.registration.addEventListener('updatefound', () => {
      console.log('[SW] Update found, installing new version...');
      
      const newWorker = this.registration!.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // New update available
            console.log('[SW] New update available');
            this.notifyListeners({
              type: 'update-available',
              registration: this.registration!
            });
          } else {
            // First install
            console.log('[SW] Service worker installed for first time');
            this.notifyListeners({
              type: 'update-installed',
              registration: this.registration!
            });
          }
        }
      });
    });

    // Listen for service worker taking control
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[SW] New service worker took control');
      window.location.reload();
    });
  }

  private startUpdateChecks(): void {
    // Check for updates every 30 minutes
    this.updateCheckInterval = window.setInterval(() => {
      this.checkForUpdates();
    }, 30 * 60 * 1000);

    // Also check when page becomes visible
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.checkForUpdates();
      }
    });
  }

  async checkForUpdates(): Promise<void> {
    if (!this.registration) return;

    try {
      console.log('[SW] Checking for updates...');
      await this.registration.update();
    } catch (error) {
      console.error('[SW] Update check failed:', error);
    }
  }

  async applyUpdate(): Promise<void> {
    if (!this.registration || !this.registration.waiting) {
      throw new Error('No update available');
    }

    console.log('[SW] Applying update...');
    
    // Tell the waiting service worker to skip waiting
    this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  // ============================================
  // State Management
  // ============================================

  getState(): ServiceWorkerState {
    return {
      isSupported: this.isSupported(),
      isRegistered: !!this.registration,
      isControlling: !!navigator.serviceWorker.controller,
      hasUpdate: !!(this.registration?.waiting),
      registration: this.registration
    };
  }

  isSupported(): boolean {
    return 'serviceWorker' in navigator;
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  // ============================================
  // Event Handling
  // ============================================

  addEventListener(listener: (event: ServiceWorkerEvent) => void): void {
    this.listeners.push(listener);
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

    navigator.serviceWorker.addEventListener('message', (event) => {
      console.log('[SW] Message from service worker:', event.data);
      
      if (event.data?.type === 'BACKGROUND_BACKUP_REQUEST') {
        // Trigger backup when service worker requests it
        window.dispatchEvent(new CustomEvent('sw-backup-request', {
          detail: event.data
        }));
      }
    });
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
    window.addEventListener('online', () => {
      console.log('[SW] Network connection restored');
      monitoring.recordMetric('network_online', performance.now());
      
      // Trigger background sync if supported
      if (this.registration && 'sync' in window.ServiceWorkerRegistration.prototype) {
        this.registration.sync.register('backup-sync').catch(error => {
          console.error('[SW] Background sync registration failed:', error);
        });
      }
    });

    window.addEventListener('offline', () => {
      console.log('[SW] Network connection lost');
      monitoring.recordMetric('network_offline', performance.now());
    });
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
    
    this.listeners = [];
  }
}

// Global service worker manager instance
export const serviceWorkerManager = new ServiceWorkerManager();

// Convenience functions
export const registerServiceWorker = () => serviceWorkerManager.register();
export const checkForUpdates = () => serviceWorkerManager.checkForUpdates();
export const applyUpdate = () => serviceWorkerManager.applyUpdate();
export const getServiceWorkerState = () => serviceWorkerManager.getState();

// Auto-register service worker in production
if (import.meta.env.PROD && serviceWorkerManager.isSupported()) {
  window.addEventListener('load', () => {
    registerServiceWorker().then(state => {
      console.log('[SW] Initial registration state:', state);
    });
    
    serviceWorkerManager.setupNetworkListeners();
  });
}