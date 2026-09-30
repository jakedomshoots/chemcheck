// Chunk Loading Error Recovery
// Handles dynamic import failures and provides recovery mechanisms.
//
// Retry state is persisted in sessionStorage (per chunk) because a page reload
// wipes module state: with in-memory counters MAX_RETRIES could never be
// reached and a permanently missing chunk caused an infinite reload loop.

export const MAX_RETRIES = 3;

/** A chunk that loaded cleanly this long after its last failure resets its counter. */
export const RETRY_COOL_DOWN_MS = 60 * 1000;

const STORAGE_PREFIX = 'chemcheck_chunk_retry:';
const FAILURE_BANNER_ID = 'chemcheck-chunk-update-failed';

function storageKey(chunkName) {
  return `${STORAGE_PREFIX}${chunkName || 'unknown'}`;
}

function safeSessionStorage() {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage || null;
  } catch {
    return null;
  }
}

export function readRetryState(chunkName) {
  const storage = safeSessionStorage();
  if (!storage) return { attempts: 0, lastAttemptAt: 0 };
  try {
    const raw = storage.getItem(storageKey(chunkName));
    if (!raw) return { attempts: 0, lastAttemptAt: 0 };
    const parsed = JSON.parse(raw);
    return {
      attempts: Number.isFinite(parsed?.attempts) ? parsed.attempts : 0,
      lastAttemptAt: Number.isFinite(parsed?.lastAttemptAt) ? parsed.lastAttemptAt : 0,
    };
  } catch {
    return { attempts: 0, lastAttemptAt: 0 };
  }
}

function writeRetryState(chunkName, state) {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(chunkName), JSON.stringify(state));
  } catch {
    // Private mode / quota errors: fall back to a single reload attempt.
  }
}

function clearRetryState(chunkName) {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(chunkName));
  } catch {
    // ignore
  }
}

function listTrackedChunks() {
  const storage = safeSessionStorage();
  if (!storage) return [];
  const names = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key && key.startsWith(STORAGE_PREFIX)) names.push(key.slice(STORAGE_PREFIX.length));
    }
  } catch {
    // ignore
  }
  return names;
}

function clearCachesThenReload() {
  const reload = () => window.location.reload();
  if ('caches' in window && typeof caches.keys === 'function') {
    caches.keys()
      .then((names) => Promise.all(names.map((name) => caches.delete(name))))
      .catch(() => {})
      .finally(reload);
  } else {
    reload();
  }
}

/**
 * Render a visible, non-blocking failure notice with a manual retry control
 * instead of reloading again. Retrying clears the chunk's counter so the next
 * reload gets a fresh MAX_RETRIES budget.
 */
export function renderChunkFailure(chunkName) {
  if (typeof document === 'undefined') return null;
  let banner = document.getElementById(FAILURE_BANNER_ID);
  if (banner) return banner;

  banner = document.createElement('div');
  banner.id = FAILURE_BANNER_ID;
  banner.setAttribute('role', 'alert');
  banner.dataset.chunk = chunkName || '';
  banner.style.cssText = [
    'position:fixed', 'left:16px', 'right:16px', 'bottom:16px', 'z-index:2147483647',
    'padding:14px 16px', 'border-radius:12px', 'background:#1e293b', 'color:#fff',
    'font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'box-shadow:0 10px 25px rgba(0,0,0,.25)', 'display:flex', 'gap:12px', 'align-items:center',
  ].join(';');

  const message = document.createElement('span');
  message.style.flex = '1';
  message.textContent = 'Update failed. Tap to retry.';

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Retry';
  button.style.cssText = 'background:#0891b2;color:#fff;border:0;border-radius:999px;padding:8px 16px;font-weight:600;cursor:pointer';
  button.addEventListener('click', () => {
    clearRetryState(chunkName);
    clearCachesThenReload();
  });

  banner.appendChild(message);
  banner.appendChild(button);
  banner.addEventListener('click', (event) => {
    if (event.target === banner || event.target === message) button.click();
  });
  (document.body || document.documentElement).appendChild(banner);
  return banner;
}

/**
 * Handle a failed chunk load. Returns 'reload' when a reload was scheduled and
 * 'failed' when the retry budget is exhausted and the failure UI was shown.
 */
export function handleChunkError(error, chunkName) {
  console.warn(`Chunk loading failed for ${chunkName}:`, error);

  const state = readRetryState(chunkName);
  if (state.attempts >= MAX_RETRIES) {
    console.error(`Chunk ${chunkName} failed ${state.attempts} times; not reloading again`);
    renderChunkFailure(chunkName);
    return 'failed';
  }

  const attempts = state.attempts + 1;
  writeRetryState(chunkName, { attempts, lastAttemptAt: Date.now() });
  console.log(`Retrying chunk load (attempt ${attempts}/${MAX_RETRIES})`);
  clearCachesThenReload();
  return 'reload';
}

/** Mark a chunk as loaded; its counter resets only once the cool-down has elapsed. */
export function markChunkLoaded(chunkName, now = Date.now()) {
  const state = readRetryState(chunkName);
  if (state.attempts === 0) return;
  if (now - state.lastAttemptAt >= RETRY_COOL_DOWN_MS) {
    clearRetryState(chunkName);
  }
}

// Enhanced dynamic import wrapper with error recovery
export async function importWithRetry(importFn, chunkName) {
  try {
    const module = await importFn();
    markChunkLoaded(chunkName);
    return module;
  } catch (error) {
    // Check if this is a chunk loading error
    const message = String(error?.message || '');
    if (message.includes('Loading chunk') ||
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Importing a module script failed')) {
      handleChunkError(error, chunkName);
      throw error;
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Reset retry counters. Without a chunk name every tracked chunk whose last
 * failure is older than the cool-down is cleared; a fresh reload right after a
 * failure keeps its count so the budget is actually enforced.
 */
export function resetRetryCount(chunkName, now = Date.now()) {
  if (typeof chunkName === 'string' && chunkName) {
    clearRetryState(chunkName);
    return;
  }
  for (const name of listTrackedChunks()) {
    markChunkLoaded(name, now);
  }
}

// Listen for successful page loads to reset cooled-down retry counts
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => resetRetryCount());
}
