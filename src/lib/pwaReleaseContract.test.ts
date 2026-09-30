import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

const SELF_ORIGIN = 'https://chemcheck.xyz';

type Strategy = 'bypass' | 'navigation' | 'network-first' | 'cache-first' | 'stale-while-revalidate';

interface SwHelpers {
  classifyRequest: (request: Request, selfOrigin: string) => Strategy;
  isNeverCacheHost: (hostname: string) => boolean;
  hasCacheFirstExtension: (pathname: string) => boolean;
  stampResponse: (response: Response, now?: number) => Response;
  isExpired: (response: Response, now?: number, maxAgeMs?: number) => boolean;
  trimCache: (cache: FakeCache, options?: { maxEntries?: number; maxAgeMs?: number; now?: number }) => Promise<number>;
  putWithEviction: (cache: FakeCache, request: Request, response: Response, options?: { maxEntries?: number; maxAgeMs?: number; now?: number }) => Promise<void>;
  matchFresh: (cache: FakeCache, request: Request) => Promise<Response | undefined>;
  CACHED_AT_HEADER: string;
  MAX_CACHE_ENTRIES: number;
  MAX_CACHE_AGE_MS: number;
}

/** Minimal in-memory Cache that preserves insertion order like the real one. */
class FakeCache {
  private entries = new Map<string, Response>();

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async match(request: Request | string): Promise<Response | undefined> {
    const url = typeof request === 'string' ? request : request.url;
    return this.entries.get(url);
  }

  async put(request: Request | string, response: Response): Promise<void> {
    const url = typeof request === 'string' ? request : request.url;
    this.entries.set(url, response);
  }

  async delete(request: Request | string): Promise<boolean> {
    const url = typeof request === 'string' ? request : request.url;
    return this.entries.delete(url);
  }

  size(): number {
    return this.entries.size;
  }
}

async function loadServiceWorkerHelpers(): Promise<SwHelpers> {
  const source = await readFile(path.resolve('public/sw.js'), 'utf8');
  const listeners: Record<string, unknown> = {};
  const self: Record<string, unknown> = {
    location: { origin: SELF_ORIGIN },
    addEventListener: (type: string, handler: unknown) => {
      listeners[type] = handler;
    },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
    registration: { showNotification: () => Promise.resolve() },
  };
  const sandbox = {
    self,
    caches: { open: async () => new FakeCache(), keys: async () => [], match: async () => undefined, delete: async () => true },
    fetch: () => Promise.reject(new Error('network disabled in test')),
    console: { log: () => {}, error: () => {}, warn: () => {} },
    URL,
    Request,
    Response,
    Headers,
    Date,
    Number,
    String,
    Promise,
    Math,
    JSON,
  };
  vm.runInNewContext(source, sandbox, { filename: 'sw.js' });
  expect(listeners.fetch).toBeTypeOf('function');
  return self.__chemcheckSw as SwHelpers;
}

describe('PWA release contract', () => {
  it('uses a build-stamped cache identity and network-first app navigation', async () => {
    const source = await readFile(path.resolve('public/sw.js'), 'utf8');

    expect(source).toContain('__CHEMCHECK_BUILD_ID__');
    expect(source).not.toContain("const CACHE_NAME = 'chemcheck-v1.0.0'");
    expect(source).toMatch(/request\.mode === ['"]navigate['"]/);
    expect(source).toContain('networkFirstNavigation(request)');
    expect(source).toContain("fetch(request, { cache: 'no-store' })");
    expect(source).toContain("event.data.type === 'SKIP_WAITING'");
  });
});

describe('service worker caching policy', () => {
  let sw: SwHelpers;

  beforeAll(async () => {
    sw = await loadServiceWorkerHelpers();
  });

  describe('origin rule', () => {
    it('never caches Clerk or Convex hosts, even when they look same-site', () => {
      const clerkApi = new Request('https://clerk.chemcheck.xyz/v1/client?_clerk_js_version=5');
      const clerkJs = new Request('https://cheerful-owl-12.clerk.accounts.dev/npm/@clerk/clerk-js@5/dist/clerk.browser.js');
      const convexStorage = new Request('https://happy-otter-123.convex.cloud/api/storage/abc-photo.jpg');
      const convexSite = new Request('https://happy-otter-123.convex.site/stripe/webhook');

      expect(sw.classifyRequest(clerkApi, SELF_ORIGIN)).toBe('bypass');
      expect(sw.classifyRequest(clerkJs, SELF_ORIGIN)).toBe('bypass');
      expect(sw.classifyRequest(convexStorage, SELF_ORIGIN)).toBe('bypass');
      expect(sw.classifyRequest(convexSite, SELF_ORIGIN)).toBe('bypass');
      expect(sw.isNeverCacheHost('CLERK.chemcheck.xyz')).toBe(true);
      expect(sw.isNeverCacheHost('foo.convex.cloud')).toBe(true);
      expect(sw.isNeverCacheHost('chemcheck.xyz')).toBe(false);
    });

    it('bypasses arbitrary cross-origin requests that are not on the allow-list', () => {
      expect(sw.classifyRequest(new Request('https://js.stripe.com/v3/'), SELF_ORIGIN)).toBe('bypass');
      expect(sw.classifyRequest(new Request('https://o123.ingest.sentry.io/api/1/envelope/'), SELF_ORIGIN)).toBe('bypass');
      expect(sw.classifyRequest(new Request('https://www.googletagmanager.com/gtag/js?id=G-1'), SELF_ORIGIN)).toBe('bypass');
      expect(sw.classifyRequest(new Request('https://cdn.example.com/assets/app.js'), SELF_ORIGIN)).toBe('bypass');
    });

    it('allows only Google Fonts cross-origin assets, with immutable binaries cache-first', () => {
      expect(sw.classifyRequest(new Request('https://fonts.googleapis.com/css2?family=Outfit'), SELF_ORIGIN)).toBe('stale-while-revalidate');
      expect(sw.classifyRequest(new Request('https://fonts.gstatic.com/s/outfit/v11/abc.woff2'), SELF_ORIGIN)).toBe('cache-first');
    });

    it('bypasses allow-listed hosts when credentials or an Authorization header are present', () => {
      const withCredentials = new Request('https://fonts.gstatic.com/s/outfit/v11/abc.woff2', { credentials: 'include' });
      const withAuth = new Request('https://fonts.gstatic.com/s/outfit/v11/abc.woff2', { headers: { Authorization: 'Bearer x' } });

      expect(sw.classifyRequest(withCredentials, SELF_ORIGIN)).toBe('bypass');
      expect(sw.classifyRequest(withAuth, SELF_ORIGIN)).toBe('bypass');
    });

    it('bypasses same-origin requests that carry an Authorization header', () => {
      const authed = new Request(`${SELF_ORIGIN}/api/me`, { headers: { authorization: 'Bearer token' } });
      expect(sw.classifyRequest(authed, SELF_ORIGIN)).toBe('bypass');
    });

    it('bypasses non-GET and non-http requests', () => {
      expect(sw.classifyRequest(new Request(`${SELF_ORIGIN}/api/sync`, { method: 'POST' }), SELF_ORIGIN)).toBe('bypass');
      expect(sw.classifyRequest(new Request('chrome-extension://abc/script.js'), SELF_ORIGIN)).toBe('bypass');
    });

    it('routes same-origin requests by strategy', () => {
      expect(sw.classifyRequest(new Request(`${SELF_ORIGIN}/api/health`), SELF_ORIGIN)).toBe('network-first');
      expect(sw.classifyRequest(new Request(`${SELF_ORIGIN}/assets/index-abc123.js`), SELF_ORIGIN)).toBe('cache-first');
      expect(sw.classifyRequest(new Request(`${SELF_ORIGIN}/icon-192.png`), SELF_ORIGIN)).toBe('cache-first');
      expect(sw.classifyRequest(new Request(`${SELF_ORIGIN}/manifest.json`), SELF_ORIGIN)).toBe('stale-while-revalidate');
      expect(sw.classifyRequest(new Request(`${SELF_ORIGIN}/build.json`), SELF_ORIGIN)).toBe('stale-while-revalidate');
    });
  });

  describe('cache-first matching', () => {
    it('matches by pathname extension, not by substring of the full URL', () => {
      // "/clients?ref=.js" and "/history/.jsx-notes" used to match via url.includes('.js')
      expect(sw.classifyRequest(new Request(`${SELF_ORIGIN}/clients?ref=app.js`), SELF_ORIGIN)).toBe('stale-while-revalidate');
      expect(sw.classifyRequest(new Request(`${SELF_ORIGIN}/history#/foo.js`), SELF_ORIGIN)).toBe('stale-while-revalidate');
      expect(sw.classifyRequest(new Request(`${SELF_ORIGIN}/.json-viewer`), SELF_ORIGIN)).toBe('stale-while-revalidate');
      expect(sw.hasCacheFirstExtension('/assets/vendor-react-ABC.js')).toBe(true);
      expect(sw.hasCacheFirstExtension('/notes.jsx')).toBe(false);
    });
  });

  describe('eviction', () => {
    it('stamps a cached-at header on stored responses', async () => {
      const stamped = sw.stampResponse(new Response('body', { headers: { 'content-type': 'text/plain' } }), 1_700_000_000_000);
      expect(stamped.headers.get(sw.CACHED_AT_HEADER)).toBe('1700000000000');
      expect(stamped.headers.get('content-type')).toBe('text/plain');
      expect(await stamped.text()).toBe('body');
    });

    it('caps bounded caches at MAX_CACHE_ENTRIES, dropping the oldest entries first', async () => {
      const cache = new FakeCache();
      const total = sw.MAX_CACHE_ENTRIES + 5;

      for (let index = 0; index < total; index += 1) {
        await sw.putWithEviction(cache, new Request(`${SELF_ORIGIN}/page-${index}`), new Response(`page ${index}`));
      }

      expect(cache.size()).toBe(sw.MAX_CACHE_ENTRIES);
      expect(await cache.match(`${SELF_ORIGIN}/page-0`)).toBeUndefined();
      expect(await cache.match(`${SELF_ORIGIN}/page-4`)).toBeUndefined();
      expect(await cache.match(`${SELF_ORIGIN}/page-5`)).toBeDefined();
      expect(await cache.match(`${SELF_ORIGIN}/page-${total - 1}`)).toBeDefined();
    });

    it('evicts entries older than seven days and treats them as cache misses', async () => {
      const cache = new FakeCache();
      const now = Date.now();
      const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
      const oneHourAgo = now - 60 * 60 * 1000;

      await cache.put(new Request(`${SELF_ORIGIN}/stale`), sw.stampResponse(new Response('stale'), eightDaysAgo));
      await cache.put(new Request(`${SELF_ORIGIN}/fresh`), sw.stampResponse(new Response('fresh'), oneHourAgo));

      expect(sw.MAX_CACHE_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
      expect(await sw.matchFresh(cache, new Request(`${SELF_ORIGIN}/stale`))).toBeUndefined();
      expect(await sw.matchFresh(cache, new Request(`${SELF_ORIGIN}/fresh`))).toBeDefined();

      await cache.put(new Request(`${SELF_ORIGIN}/stale-2`), sw.stampResponse(new Response('stale'), eightDaysAgo));
      const remaining = await sw.trimCache(cache, { now });
      expect(remaining).toBe(1);
      expect(cache.size()).toBe(1);
    });

    it('falls back to the Date header when no cached-at stamp is present', () => {
      const old = new Response('x', { headers: { date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toUTCString() } });
      const recent = new Response('x', { headers: { date: new Date().toUTCString() } });
      const unstamped = new Response('x');

      expect(sw.isExpired(old)).toBe(true);
      expect(sw.isExpired(recent)).toBe(false);
      expect(sw.isExpired(unstamped)).toBe(false);
    });
  });
});
