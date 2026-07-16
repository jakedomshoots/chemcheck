/**
 * Theme controller — light / dark / system.
 *
 * The `.dark` class on <html> drives the token remap in index.css.
 * index.html applies the saved theme before first paint; this module owns
 * runtime changes and the system-preference listener.
 */

const STORAGE_KEY = 'chemcheck-theme';
const MEDIA = '(prefers-color-scheme: dark)';

export function getTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme = getTheme()) {
  if (typeof window === 'undefined') return 'light';
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia(MEDIA).matches);
  document.documentElement.classList.toggle('dark', dark);
  return dark ? 'dark' : 'light';
}

export function setTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode — theme applies for the session only */
  }
  return applyTheme(theme);
}

/** Re-apply on OS-level changes while set to "system". */
export function watchSystemTheme() {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia(MEDIA);
  const handler = () => {
    if (getTheme() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
