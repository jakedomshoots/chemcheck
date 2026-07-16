import { flushSync } from 'react-dom';

/**
 * View Transitions for SPA navigation.
 *
 * Wraps a react-router navigate() call so the browser captures a
 * before/after pair and morphs between them (see ::view-transition rules in
 * index.css). flushSync forces React to commit the new tree inside the
 * transition callback, which is the documented SPA integration pattern.
 *
 * Degrades to a plain navigate when the API or the motion preference
 * says no.
 */

export function isViewTransitionSupported() {
  return (
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function navigateWithTransition(navigate, to, options) {
  if (!isViewTransitionSupported()) {
    navigate(to, options);
    return null;
  }

  try {
    return document.startViewTransition(() => {
      flushSync(() => {
        navigate(to, options);
      });
    });
  } catch {
    // Transition aborted (e.g. rapid double navigation) — just go.
    navigate(to, options);
    return null;
  }
}

/** Pop history with a transition (BackButton path). */
export function goBackWithTransition(navigate, fallback) {
  const perform = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else if (fallback) {
      navigate(fallback);
    }
  };

  if (!isViewTransitionSupported()) {
    perform();
    return null;
  }

  try {
    return document.startViewTransition(() => {
      flushSync(perform);
    });
  } catch {
    perform();
    return null;
  }
}

/**
 * view-transition-name helper — names must be unique per document, so only
 * apply when the API exists (keeps jsdom and old browsers untouched).
 */
export function transitionName(name) {
  return isViewTransitionSupported() ? { viewTransitionName: name } : undefined;
}
