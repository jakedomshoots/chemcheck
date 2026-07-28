import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const MAX_SAVED_ROUTES = 40;

function rememberScrollPosition(positions, key, top) {
  positions.delete(key);
  positions.set(key, top);

  while (positions.size > MAX_SAVED_ROUTES) {
    const oldestKey = positions.keys().next().value;
    positions.delete(oldestKey);
  }
}

function scrollWindowTo(top) {
  try {
    window.scrollTo({ left: 0, top, behavior: 'auto' });
  } catch {
    window.scrollTo(0, top);
  }
}

/**
 * Starts new routes at the top while restoring the prior position on browser Back/Forward.
 * BrowserRouter does not provide this behavior for SPA navigation by itself.
 */
export function RouteScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positionsRef = useRef(new Map());

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return undefined;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    const routeKey = location.key || `${location.pathname}${location.search}`;
    const nextTop = navigationType === 'POP'
      ? positionsRef.current.get(routeKey) ?? 0
      : 0;
    const frameId = navigationType === 'POP'
      ? window.requestAnimationFrame(() => scrollWindowTo(nextTop))
      : null;

    // Push/replace navigation should commit at the top in the same frame so
    // View Transitions never capture the incoming page at the old route's offset.
    if (navigationType !== 'POP') scrollWindowTo(nextTop);

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      rememberScrollPosition(positionsRef.current, routeKey, window.scrollY || 0);
    };
  }, [location.key, location.pathname, location.search, navigationType]);

  return null;
}
