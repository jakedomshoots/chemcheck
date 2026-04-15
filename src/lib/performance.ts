import { useMemo, useCallback, useRef, useEffect } from 'react';
import { monitoring } from './monitoring';

// ============================================
// Performance Optimization Utilities
// ============================================

/**
 * Debounce hook for expensive operations
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Throttle hook for high-frequency events
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastRun = useRef(Date.now());

  return useCallback(
    ((...args) => {
      if (Date.now() - lastRun.current >= delay) {
        callback(...args);
        lastRun.current = Date.now();
      }
    }) as T,
    [callback, delay]
  );
}

/**
 * Memoized search/filter hook
 */
export function useOptimizedFilter<T>(
  items: T[],
  searchTerm: string,
  filterFn: (item: T, term: string) => boolean,
  sortFn?: (a: T, b: T) => number
) {
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  return useMemo(() => {
    const startTime = performance.now();
    
    let filtered = items;
    
    if (debouncedSearchTerm) {
      filtered = items.filter(item => filterFn(item, debouncedSearchTerm));
    }
    
    if (sortFn) {
      filtered = [...filtered].sort(sortFn);
    }
    
    const duration = performance.now() - startTime;
    
    // Log slow filters
    if (duration > 50) {
      monitoring.recordMetric('slow_filter', duration, {
        itemCount: items.length,
        searchTerm: debouncedSearchTerm,
        resultCount: filtered.length
      });
    }
    
    return filtered;
  }, [items, debouncedSearchTerm, filterFn, sortFn]);
}

/**
 * Pagination hook for large datasets
 */
export function usePagination<T>(
  items: T[],
  pageSize: number = 50
) {
  const [currentPage, setCurrentPage] = React.useState(1);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return items.slice(startIndex, endIndex);
  }, [items, currentPage, pageSize]);

  const totalPages = Math.ceil(items.length / pageSize);
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  const nextPage = useCallback(() => {
    if (hasNextPage) goToPage(currentPage + 1);
  }, [hasNextPage, currentPage, goToPage]);

  const prevPage = useCallback(() => {
    if (hasPrevPage) goToPage(currentPage - 1);
  }, [hasPrevPage, currentPage, goToPage]);

  // Reset to first page when items change
  useEffect(() => {
    setCurrentPage(1);
  }, [items.length]);

  return {
    currentPage,
    totalPages,
    pageSize,
    hasNextPage,
    hasPrevPage,
    paginatedData,
    goToPage,
    nextPage,
    prevPage,
    totalItems: items.length
  };
}

/**
 * Virtual scrolling hook for very large lists
 */
export function useVirtualScroll<T>({
  items,
  itemHeight,
  containerHeight,
  overscan = 5
}: {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}) {
  const [scrollTop, setScrollTop] = React.useState(0);

  const visibleStart = Math.floor(scrollTop / itemHeight);
  const visibleEnd = Math.min(
    visibleStart + Math.ceil(containerHeight / itemHeight),
    items.length - 1
  );

  const startIndex = Math.max(0, visibleStart - overscan);
  const endIndex = Math.min(items.length - 1, visibleEnd + overscan);

  const visibleItems = useMemo(() => {
    return items.slice(startIndex, endIndex + 1).map((item, index) => ({
      item,
      index: startIndex + index
    }));
  }, [items, startIndex, endIndex]);

  const totalHeight = items.length * itemHeight;
  const offsetY = startIndex * itemHeight;

  const handleScroll = useThrottle((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, 16); // ~60fps

  return {
    visibleItems,
    totalHeight,
    offsetY,
    handleScroll
  };
}

/**
 * Lazy loading hook for components
 */
export function useLazyLoad(
  threshold: number = 0.1,
  rootMargin: string = '0px'
) {
  const [isVisible, setIsVisible] = React.useState(false);
  const [hasLoaded, setHasLoaded] = React.useState(false);
  const elementRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || hasLoaded) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          setHasLoaded(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [threshold, rootMargin, hasLoaded]);

  return { elementRef, isVisible, hasLoaded };
}

/**
 * Memory usage monitoring hook
 */
export function useMemoryMonitor(interval: number = 30000) {
  const [memoryInfo, setMemoryInfo] = React.useState<{
    used: number;
    total: number;
    percentage: number;
  } | null>(null);

  useEffect(() => {
    const checkMemory = () => {
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        const used = memory.usedJSHeapSize;
        const total = memory.totalJSHeapSize;
        const percentage = (used / total) * 100;

        setMemoryInfo({ used, total, percentage });

        // Warn if memory usage is high
        if (percentage > 80) {
          monitoring.reportError({
            message: `High memory usage: ${percentage.toFixed(1)}%`,
            severity: 'medium',
            metadata: { memoryInfo: memory }
          });
        }
      }
    };

    checkMemory();
    const intervalId = setInterval(checkMemory, interval);

    return () => clearInterval(intervalId);
  }, [interval]);

  return memoryInfo;
}

/**
 * Performance-optimized data fetching hook
 */
export function useOptimizedQuery<T>(
  queryFn: () => Promise<T>,
  dependencies: any[],
  options: {
    cacheTime?: number;
    staleTime?: number;
    retryCount?: number;
  } = {}
) {
  const {
    cacheTime = 5 * 60 * 1000, // 5 minutes
    staleTime = 1 * 60 * 1000,  // 1 minute
    retryCount = 3
  } = options;

  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  const cacheRef = useRef<Map<string, { data: T; timestamp: number }>>(new Map());

  const cacheKey = useMemo(() => 
    JSON.stringify(dependencies), 
    [dependencies]
  );

  const fetchData = useCallback(async () => {
    const cached = cacheRef.current.get(cacheKey);
    const now = Date.now();

    // Return cached data if still fresh
    if (cached && (now - cached.timestamp) < staleTime) {
      setData(cached.data);
      return;
    }

    setLoading(true);
    setError(null);

    let attempts = 0;
    while (attempts < retryCount) {
      try {
        const startTime = performance.now();
        const result = await queryFn();
        const duration = performance.now() - startTime;

        // Cache the result
        cacheRef.current.set(cacheKey, { data: result, timestamp: now });

        // Clean old cache entries
        const entries = Array.from(cacheRef.current.entries());
        for (const [key, value] of entries) {
          if (now - value.timestamp > cacheTime) {
            cacheRef.current.delete(key);
          }
        }

        setData(result);
        setLoading(false);

        // Log slow queries
        if (duration > 1000) {
          monitoring.recordMetric('slow_query', duration, {
            cacheKey,
            attempts: attempts + 1
          });
        }

        return;
      } catch (err) {
        attempts++;
        if (attempts >= retryCount) {
          setError(err instanceof Error ? err : new Error('Query failed'));
          setLoading(false);
          
          monitoring.reportError({
            message: `Query failed after ${retryCount} attempts`,
            severity: 'medium',
            metadata: { cacheKey, attempts }
          });
        } else {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        }
      }
    }
  }, [queryFn, cacheKey, staleTime, cacheTime, retryCount]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => {
    cacheRef.current.delete(cacheKey);
    fetchData();
  }, [cacheKey, fetchData]);

  return { data, loading, error, refetch };
}

/**
 * Bundle size analyzer (development only)
 */
export function analyzeBundleSize() {
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    
    const analysis = {
      scripts: scripts.map(script => ({
        src: (script as HTMLScriptElement).src,
        async: (script as HTMLScriptElement).async,
        defer: (script as HTMLScriptElement).defer
      })),
      styles: styles.map(style => ({
        href: (style as HTMLLinkElement).href
      })),
      totalScripts: scripts.length,
      totalStyles: styles.length
    };

    console.log('Bundle Analysis:', analysis);
    return analysis;
  }
  return null;
}

// React import fix
import React from 'react';