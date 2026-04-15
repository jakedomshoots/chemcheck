/**
 * Photo Performance Optimization Utilities
 * 
 * Provides caching, lazy loading, and batch processing
 * for improved photo handling performance.
 */

import type { CapturedPhoto } from './types';

// ============================================
// Memory Cache
// ============================================

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    size: number;
}

class PhotoCache {
    private cache: Map<string, CacheEntry<string>> = new Map();
    private maxSizeBytes: number;
    private currentSize: number = 0;

    constructor(maxSizeMB: number = 50) {
        this.maxSizeBytes = maxSizeMB * 1024 * 1024;
    }

    /**
     * Get a cached photo by ID
     */
    get(id: string): string | null {
        const entry = this.cache.get(id);
        if (entry) {
            // Update access time for LRU
            entry.timestamp = Date.now();
            return entry.data;
        }
        return null;
    }

    /**
     * Cache a photo
     */
    set(id: string, dataUrl: string): void {
        const size = this.estimateSize(dataUrl);

        // Reject items larger than the entire cache
        if (size > this.maxSizeBytes) {
            console.warn(`PhotoCache: Item ${id} (${size} bytes) exceeds max cache size (${this.maxSizeBytes} bytes), not caching`);
            return;
        }

        // Evict if needed
        while (this.currentSize + size > this.maxSizeBytes && this.cache.size > 0) {
            this.evictOldest();
        }

        // Remove existing entry if present
        const existing = this.cache.get(id);
        if (existing) {
            this.currentSize -= existing.size;
        }

        this.cache.set(id, {
            data: dataUrl,
            timestamp: Date.now(),
            size,
        });
        this.currentSize += size;
    }

    /**
     * Remove a photo from cache
     */
    delete(id: string): void {
        const entry = this.cache.get(id);
        if (entry) {
            this.currentSize -= entry.size;
            this.cache.delete(id);
        }
    }

    /**
     * Clear the entire cache
     */
    clear(): void {
        this.cache.clear();
        this.currentSize = 0;
    }

    /**
     * Get cache statistics
     */
    getStats(): { entries: number; sizeBytes: number; maxSizeBytes: number } {
        return {
            entries: this.cache.size,
            sizeBytes: this.currentSize,
            maxSizeBytes: this.maxSizeBytes,
        };
    }

    private estimateSize(dataUrl: string): number {
        // Base64 is about 4/3 the size of the original
        const base64 = dataUrl.split(',')[1] || '';
        return Math.ceil(base64.length * 0.75);
    }

    private evictOldest(): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.delete(oldestKey);
        }
    }
}

// Singleton instance
export const photoCache = new PhotoCache(50); // 50MB max

// ============================================
// Thumbnail Cache
// ============================================

const thumbnailCache = new PhotoCache(20); // 20MB for thumbnails

/**
 * Get or create a thumbnail for a photo
 */
export async function getCachedThumbnail(
    photo: CapturedPhoto,
    size: number = 150
): Promise<string> {
    const cacheKey = `thumb_${photo.id}_${size}`;

    // Check cache first
    const cached = thumbnailCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    // Generate thumbnail
    const thumbnail = await createThumbnail(photo.dataUrl, size);
    thumbnailCache.set(cacheKey, thumbnail);

    return thumbnail;
}

/**
 * Create a thumbnail from a data URL
 */
async function createThumbnail(dataUrl: string, maxSize: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Could not get canvas context'));
                return;
            }

            // Calculate dimensions
            const ratio = Math.min(maxSize / img.width, maxSize / img.height);
            const width = Math.round(img.width * ratio);
            const height = Math.round(img.height * ratio);

            canvas.width = width;
            canvas.height = height;

            // Use high-quality scaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'medium';

            ctx.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = dataUrl;
    });
}

// ============================================
// Lazy Loading
// ============================================

export interface LazyPhotoRef {
    id: string;
    thumbnail: string | null;
    isLoaded: boolean;
    load: () => Promise<string>;
}

/**
 * Create a lazy-loadable photo reference
 */
export function createLazyPhotoRef(
    photo: CapturedPhoto,
    thumbnailSize: number = 100
): LazyPhotoRef {
    let fullDataUrl: string | null = null;
    let thumbnailUrl: string | null = null;
    let isLoaded = false;

    // Start thumbnail generation immediately (non-blocking)
    getCachedThumbnail(photo, thumbnailSize)
        .then(thumb => {
            thumbnailUrl = thumb;
        })
        .catch(error => {
            // Log error but don't crash - thumbnail is optional
            console.error(`Failed to generate thumbnail for photo ${photo.id}:`, error);
        });

    return {
        get id() { return photo.id; },
        get thumbnail() { return thumbnailUrl; },
        get isLoaded() { return isLoaded; },
        async load() {
            if (!isLoaded) {
                fullDataUrl = photo.dataUrl;
                photoCache.set(photo.id, fullDataUrl);
                isLoaded = true;
            }
            return fullDataUrl!;
        },
    };
}

// ============================================
// Batch Processing
// ============================================

export interface BatchProcessOptions {
    concurrency: number;
    onProgress?: (completed: number, total: number) => void;
    onError?: (error: Error, index: number) => void;
}

/**
 * Process photos in batches with controlled concurrency
 */
export async function batchProcess<T>(
    items: T[],
    processor: (item: T, index: number) => Promise<void>,
    options: Partial<BatchProcessOptions> = {}
): Promise<{ success: number; failed: number }> {
    const { concurrency = 3, onProgress, onError } = options;

    let completed = 0;
    let failed = 0;

    // Process in chunks
    for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);

        await Promise.allSettled(
            chunk.map(async (item, chunkIndex) => {
                const index = i + chunkIndex;
                try {
                    await processor(item, index);
                    completed++;
                } catch (error) {
                    failed++;
                    if (onError) {
                        onError(error instanceof Error ? error : new Error(String(error)), index);
                    }
                }
            })
        );

        if (onProgress) {
            onProgress(completed + failed, items.length);
        }
    }

    return { success: completed, failed };
}

// ============================================
// Debounce & Throttle
// ============================================

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
    fn: T,
    delayMs: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return (...args: Parameters<T>) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn(...args);
            timeoutId = null;
        }, delayMs);
    };
}

/**
 * Throttle a function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
    fn: T,
    limitMs: number
): (...args: Parameters<T>) => void {
    let lastRun = 0;
    let pendingArgs: Parameters<T> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return (...args: Parameters<T>) => {
        const now = Date.now();
        const timeSinceLastRun = now - lastRun;

        if (timeSinceLastRun >= limitMs) {
            lastRun = now;
            fn(...args);
        } else {
            pendingArgs = args;
            if (!timeoutId) {
                timeoutId = setTimeout(() => {
                    if (pendingArgs) {
                        lastRun = Date.now();
                        fn(...pendingArgs);
                        pendingArgs = null;
                    }
                    timeoutId = null;
                }, limitMs - timeSinceLastRun);
            }
        }
    };
}

// ============================================
// Intersection Observer Hook Helper
// ============================================

/**
 * Create an intersection observer for lazy loading
 */
export function createLazyLoadObserver(
    onIntersect: (id: string) => void,
    options: IntersectionObserverInit = {}
): IntersectionObserver {
    return new IntersectionObserver(
        (entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.getAttribute('data-photo-id');
                    if (id) {
                        onIntersect(id);
                        // Unobserve after first intersection to prevent repeated callbacks
                        observer.unobserve(entry.target);
                    }
                }
            });
        },
        {
            rootMargin: '100px', // Start loading 100px before visible
            threshold: 0,
            ...options,
        }
    );
}

// ============================================
// Memory Management
// ============================================

/**
 * Release memory by clearing caches when needed
 */
export function releaseMemory(): void {
    photoCache.clear();
    thumbnailCache.clear();

    // Force garbage collection hint (if available)
    if (typeof window !== 'undefined' && 'gc' in window) {
        try {
            (window as unknown as { gc: () => void }).gc();
        } catch {
            // Ignore - gc is usually not exposed
        }
    }
}

/**
 * Get memory usage statistics
 */
export function getMemoryStats(): {
    photoCache: ReturnType<PhotoCache['getStats']>;
    thumbnailCache: ReturnType<PhotoCache['getStats']>;
} {
    return {
        photoCache: photoCache.getStats(),
        thumbnailCache: thumbnailCache.getStats(),
    };
}
