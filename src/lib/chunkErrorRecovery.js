// Chunk Loading Error Recovery
// Handles dynamic import failures and provides recovery mechanisms

let retryCount = 0;
const MAX_RETRIES = 3;

// Track failed chunks to avoid infinite retry loops
const failedChunks = new Set();

export function handleChunkError(error, chunkName) {
  console.warn(`Chunk loading failed for ${chunkName}:`, error);
  
  // If this chunk has already failed multiple times, don't retry
  if (failedChunks.has(chunkName)) {
    console.error(`Chunk ${chunkName} has failed multiple times, forcing reload`);
    window.location.reload();
    return;
  }
  
  // Add to failed chunks set
  failedChunks.add(chunkName);
  
  // If we haven't exceeded retry limit, try reloading the page
  if (retryCount < MAX_RETRIES) {
    retryCount++;
    console.log(`Retrying chunk load (attempt ${retryCount}/${MAX_RETRIES})`);
    
    // Clear cache and reload
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => {
          caches.delete(name);
        });
      }).finally(() => {
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  } else {
    console.error('Max retries exceeded, showing error to user');
    // Could show a user-friendly error message here
    alert('Unable to load application resources. Please check your internet connection and try refreshing the page.');
  }
}

// Enhanced dynamic import wrapper with error recovery
export async function importWithRetry(importFn, chunkName) {
  try {
    return await importFn();
  } catch (error) {
    // Check if this is a chunk loading error
    if (error.message.includes('Loading chunk') || 
        error.message.includes('Failed to fetch dynamically imported module')) {
      handleChunkError(error, chunkName);
      throw error;
    }
    
    // Re-throw other errors
    throw error;
  }
}

// Reset retry count on successful navigation
export function resetRetryCount() {
  retryCount = 0;
  failedChunks.clear();
}

// Listen for successful page loads to reset retry count
if (typeof window !== 'undefined') {
  window.addEventListener('load', resetRetryCount);
}