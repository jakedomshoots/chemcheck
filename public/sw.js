// ChemCheck Service Worker
// Provides offline functionality and caching for PWA

const CACHE_NAME = 'chemcheck-v1.0.0';
const STATIC_CACHE = 'chemcheck-static-v1.0.0';
const DYNAMIC_CACHE = 'chemcheck-dynamic-v1.0.0';

// Files to cache immediately (critical app shell)
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  // Note: Vite builds will have hashed filenames, so we'll cache them dynamically
];

// Files that should always be fetched from network when available
const NETWORK_FIRST = [
  '/api/',
  '/convex/',
];

// Files that can be served from cache first
const CACHE_FIRST = [
  '/assets/',
  '/static/',
  '.css',
  '.js',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.woff',
  '.woff2'
];

// ============================================
// Service Worker Installation
// ============================================

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log('[SW] Static files cached successfully');
        return self.skipWaiting(); // Activate immediately
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static files:', error);
      })
  );
});

// ============================================
// Service Worker Activation
// ============================================

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Delete old caches
            if (cacheName !== STATIC_CACHE && 
                cacheName !== DYNAMIC_CACHE && 
                cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim(); // Take control immediately
      })
      .catch((error) => {
        console.error('[SW] Activation failed:', error);
      })
  );
});

// ============================================
// Fetch Event Handling
// ============================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // Handle different types of requests
  if (isNetworkFirst(request.url)) {
    event.respondWith(networkFirst(request));
  } else if (isCacheFirst(request.url)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// ============================================
// Caching Strategies
// ============================================

/**
 * Network First - Try network, fallback to cache
 * Good for: API calls, dynamic content
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache successful responses
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/offline.html') || createOfflineResponse();
    }
    
    throw error;
  }
}

/**
 * Cache First - Try cache, fallback to network
 * Good for: Static assets, images, fonts
 */
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache first failed for:', request.url, error);
    throw error;
  }
}

/**
 * Stale While Revalidate - Serve from cache, update in background
 * Good for: App shell, frequently updated content
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  // Fetch from network in background
  const networkResponsePromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch((error) => {
      console.log('[SW] Background fetch failed:', request.url, error);
    });
  
  // Return cached version immediately if available
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // Otherwise wait for network
  try {
    return await networkResponsePromise;
  } catch (error) {
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/offline.html') || createOfflineResponse();
    }
    throw error;
  }
}

// ============================================
// Helper Functions
// ============================================

function isNetworkFirst(url) {
  return NETWORK_FIRST.some(pattern => url.includes(pattern));
}

function isCacheFirst(url) {
  return CACHE_FIRST.some(pattern => url.includes(pattern));
}

function createOfflineResponse() {
  return new Response(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ChemCheck - Offline</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          margin: 0;
          padding: 20px;
          background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 12px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.1);
          text-align: center;
          max-width: 400px;
          width: 100%;
        }
        .icon {
          width: 60px;
          height: 60px;
          background: #dbeafe;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          font-size: 24px;
        }
        h1 {
          color: #1e40af;
          margin: 0 0 10px;
          font-size: 24px;
          font-weight: 600;
        }
        p {
          color: #6b7280;
          margin: 0 0 20px;
          line-height: 1.5;
        }
        .features {
          background: #f8fafc;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
          text-align: left;
        }
        .features h3 {
          margin: 0 0 10px;
          color: #374151;
          font-size: 16px;
        }
        .features ul {
          margin: 0;
          padding-left: 20px;
          color: #6b7280;
          font-size: 14px;
        }
        .features li {
          margin-bottom: 5px;
        }
        button {
          background: #3b82f6;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        button:hover {
          background: #2563eb;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">📱</div>
        <h1>You're Offline</h1>
        <p>No internet connection detected, but ChemCheck still works!</p>
        
        <div class="features">
          <h3>Available Offline:</h3>
          <ul>
            <li>View and manage customers</li>
            <li>Log pool service visits</li>
            <li>Track chemical usage</li>
            <li>Create and view notes</li>
            <li>Generate reports</li>
          </ul>
        </div>
        
        <p>All your data is stored locally and will sync when you're back online.</p>
        
        <button onclick="window.location.reload()">
          Try Again
        </button>
      </div>
    </body>
    </html>
  `, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache'
    }
  });
}

// ============================================
// Background Sync (Future Enhancement)
// ============================================

self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'backup-sync') {
    event.waitUntil(performBackgroundBackup());
  }
});

async function performBackgroundBackup() {
  try {
    // This would trigger a backup when connectivity is restored
    console.log('[SW] Performing background backup...');
    
    // Send message to main thread to trigger backup
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'BACKGROUND_BACKUP_REQUEST',
        timestamp: Date.now()
      });
    });
  } catch (error) {
    console.error('[SW] Background backup failed:', error);
  }
}

// ============================================
// Push Notifications (Future Enhancement)
// ============================================

self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  const options = {
    body: 'You have pending pool service visits',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'service-reminder',
    requireInteraction: false,
    actions: [
      {
        action: 'view',
        title: 'View Schedule'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('ChemCheck Reminder', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// ============================================
// Message Handling
// ============================================

self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({
      version: CACHE_NAME,
      timestamp: Date.now()
    });
  }
});

console.log('[SW] Service worker script loaded');