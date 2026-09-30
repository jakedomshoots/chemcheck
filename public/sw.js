// ChemCheck Service Worker
// Provides offline functionality and caching for PWA

// Replaced in dist/sw.js after every production build. A changed worker script
// lets installed Safari PWAs discover a release even when this source is stable.
const BUILD_ID = '__CHEMCHECK_BUILD_ID__';
const CACHE_PREFIX = 'chemcheck';
const CACHE_NAME = `${CACHE_PREFIX}-runtime-${BUILD_ID}`;
const STATIC_CACHE = `${CACHE_PREFIX}-static-${BUILD_ID}`;
const DYNAMIC_CACHE = `${CACHE_PREFIX}-dynamic-${BUILD_ID}`;

// Files to cache immediately (critical app shell)
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  // Note: Vite builds will have hashed filenames, so we'll cache them dynamically
];

// Same-origin paths that should always be fetched from network when available
const NETWORK_FIRST_PATH_PREFIXES = [
  '/api/',
  '/convex/',
];

// Same-origin paths / extensions that can be served from cache first.
// Matched against url.pathname only, never the full URL string.
const CACHE_FIRST_PATH_PREFIXES = [
  '/assets/',
  '/static/',
];
const CACHE_FIRST_EXTENSIONS = [
  '.css',
  '.js',
  '.mjs',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
];

// The only cross-origin hosts the worker may cache. Everything else (Clerk,
// Convex, Stripe, Sentry, analytics, storage URLs) always goes straight to the
// network so a shared device never serves another user's session or photos.
const ALLOWED_CROSS_ORIGIN_HOSTS = {
  // Font CSS can vary by user agent; revalidate it in the background.
  'fonts.googleapis.com': 'stale-while-revalidate',
  // Font binaries are content-addressed and immutable.
  'fonts.gstatic.com': 'cache-first',
};

// Hosts that must never be cached, even if they were same-origin aliases.
const NEVER_CACHE_HOST_FRAGMENTS = ['clerk', 'convex'];

// Eviction policy for the runtime (stale-while-revalidate) and dynamic
// (network-first) caches. The static cache holds only the app shell and hashed
// build assets, which are invalidated by BUILD_ID instead.
const MAX_CACHE_ENTRIES = 100;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHED_AT_HEADER = 'x-chemcheck-cached-at';

// ============================================
// Request Classification (pure helpers)
// ============================================

function hasPathPrefix(pathname, prefixes) {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

function hasCacheFirstExtension(pathname) {
  const lower = pathname.toLowerCase();
  return CACHE_FIRST_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isNeverCacheHost(hostname) {
  const lower = String(hostname || '').toLowerCase();
  return NEVER_CACHE_HOST_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

function hasAuthorizationHeader(request) {
  try {
    return !!(request.headers && request.headers.has('authorization'));
  } catch {
    return false;
  }
}

/**
 * Decide how the worker should treat a request.
 * Returns one of:
 *   'bypass'                 - do not call respondWith; let the browser fetch it
 *   'navigation'             - same-origin SPA navigation (network-first shell)
 *   'network-first'          - same-origin API-style paths
 *   'cache-first'            - hashed build assets / immutable font binaries
 *   'stale-while-revalidate' - everything else that is safe to cache
 */
function classifyRequest(request, selfOrigin) {
  if (!request || request.method !== 'GET') {
    return 'bypass';
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return 'bypass';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'bypass';
  }

  if (isNeverCacheHost(url.hostname)) {
    return 'bypass';
  }

  const isSameOrigin = url.origin === selfOrigin;

  if (!isSameOrigin) {
    const allowedStrategy = ALLOWED_CROSS_ORIGIN_HOSTS[url.hostname];
    if (!allowedStrategy) {
      return 'bypass';
    }
    if (request.credentials === 'include' || hasAuthorizationHeader(request)) {
      return 'bypass';
    }
    if (request.mode === 'navigate') {
      return 'bypass';
    }
    return allowedStrategy;
  }

  if (hasAuthorizationHeader(request)) {
    // Authenticated same-origin responses are user-specific; never cache them.
    return 'bypass';
  }

  if (request.mode === 'navigate') {
    return 'navigation';
  }

  if (hasPathPrefix(url.pathname, NETWORK_FIRST_PATH_PREFIXES)) {
    return 'network-first';
  }

  if (hasPathPrefix(url.pathname, CACHE_FIRST_PATH_PREFIXES) || hasCacheFirstExtension(url.pathname)) {
    return 'cache-first';
  }

  return 'stale-while-revalidate';
}

// ============================================
// Cache Bookkeeping (timestamps + eviction)
// ============================================

function stampResponse(response, now = Date.now()) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(now));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function getCachedAt(response) {
  if (!response || !response.headers) return null;
  const stamped = Number(response.headers.get(CACHED_AT_HEADER));
  if (Number.isFinite(stamped) && stamped > 0) return stamped;
  const dateHeader = response.headers.get('date');
  if (dateHeader) {
    const parsed = Date.parse(dateHeader);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isExpired(response, now = Date.now(), maxAgeMs = MAX_CACHE_AGE_MS) {
  const cachedAt = getCachedAt(response);
  if (cachedAt === null) return false;
  return now - cachedAt > maxAgeMs;
}

/**
 * Drop expired entries, then the oldest entries beyond maxEntries.
 * Cache.keys() preserves insertion order, so the front of the list is oldest.
 */
async function trimCache(cache, { maxEntries = MAX_CACHE_ENTRIES, maxAgeMs = MAX_CACHE_AGE_MS, now = Date.now() } = {}) {
  const requests = await cache.keys();
  const survivors = [];

  for (const request of requests) {
    const response = await cache.match(request);
    if (!response || isExpired(response, now, maxAgeMs)) {
      await cache.delete(request);
    } else {
      survivors.push(request);
    }
  }

  const overflow = survivors.length - maxEntries;
  for (let index = 0; index < overflow; index += 1) {
    await cache.delete(survivors[index]);
  }

  return Math.max(survivors.length, 0) - Math.max(overflow, 0);
}

/**
 * Put a timestamped copy into a bounded cache and trim it afterwards.
 */
async function putWithEviction(cache, request, response, options) {
  await cache.put(request, stampResponse(response));
  await trimCache(cache, options);
}

/**
 * Read from a bounded cache, treating expired entries as misses.
 */
async function matchFresh(cache, request) {
  const cached = await cache.match(request);
  if (!cached) return undefined;
  if (isExpired(cached)) {
    await cache.delete(request);
    return undefined;
  }
  return cached;
}

// ============================================
// Fetch Event Handling
// ============================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = classifyRequest(request, self.location.origin);

  switch (strategy) {
    case 'navigation':
      event.respondWith(networkFirstNavigation(request));
      break;
    case 'network-first':
      event.respondWith(networkFirst(request));
      break;
    case 'cache-first':
      event.respondWith(cacheFirst(request));
      break;
    case 'stale-while-revalidate':
      event.respondWith(staleWhileRevalidate(request));
      break;
    default:
      // 'bypass': cross-origin, authenticated, non-GET, or non-http requests
      // are left to the browser and never enter a ChemCheck cache.
      break;
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
      // Cache successful responses in the bounded dynamic cache
      const cache = await caches.open(DYNAMIC_CACHE);
      await putWithEviction(cache, request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await matchFresh(cache, request);
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
 * Always revalidate the SPA shell while online. Hashed JS/CSS assets remain
 * cache-first, and the most recent index shell remains available offline.
 */
async function networkFirstNavigation(request) {
  try {
    const networkResponse = await fetch(request, { cache: 'no-store' });

    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put('/index.html', networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('[SW] Navigation network failed, using cached shell:', request.url);
    const cachedShell =
      await caches.match('/index.html') ||
      await caches.match('/') ||
      await caches.match(request);

    return cachedShell || createOfflineResponse();
  }
}

/**
 * Cache First - Try cache, fallback to network
 * Good for: Hashed build assets (static cache, invalidated by BUILD_ID) and
 * allow-listed immutable cross-origin font binaries (bounded runtime cache).
 */
async function cacheFirst(request) {
  const isSameOrigin = new URL(request.url).origin === self.location.origin;
  const cache = await caches.open(isSameOrigin ? STATIC_CACHE : CACHE_NAME);
  const cachedResponse = isSameOrigin ? await cache.match(request) : await matchFresh(cache, request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      if (isSameOrigin) {
        await cache.put(request, networkResponse.clone());
      } else {
        await putWithEviction(cache, request, networkResponse.clone());
      }
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
  const cachedResponse = await matchFresh(cache, request);
  
  // Fetch from network in background
  const networkResponsePromise = fetch(request)
    .then(async (networkResponse) => {
      if (networkResponse.ok) {
        await putWithEviction(cache, request, networkResponse.clone());
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

// Exposed for unit tests (src/lib/pwaReleaseContract.test.ts). Not used by the app.
self.__chemcheckSw = {
  classifyRequest,
  isNeverCacheHost,
  hasCacheFirstExtension,
  stampResponse,
  isExpired,
  trimCache,
  putWithEviction,
  matchFresh,
  CACHED_AT_HEADER,
  MAX_CACHE_ENTRIES,
  MAX_CACHE_AGE_MS,
  cacheNames: { STATIC_CACHE, DYNAMIC_CACHE, CACHE_NAME },
};

console.log('[SW] Service worker script loaded');
