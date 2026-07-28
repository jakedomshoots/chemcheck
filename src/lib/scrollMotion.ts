export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;

  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function getPreferredScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

export function scrollElementIntoView(
  element: Element | null | undefined,
  options: Omit<ScrollIntoViewOptions, 'behavior'> = {},
): void {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  element.scrollIntoView({
    ...options,
    behavior: getPreferredScrollBehavior(),
  });
}
