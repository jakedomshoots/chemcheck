/**
 * Photo Accessibility Utilities
 * 
 * Provides accessibility helpers for photo components including:
 * - Screen reader announcements
 * - Keyboard navigation helpers
 * - Focus management
 * - ARIA attribute generators
 */

// ============================================
// Screen Reader Announcements
// ============================================

let announcer: HTMLDivElement | null = null;

/**
 * Initialize the screen reader announcer element.
 * Returns null in non-DOM environments (SSR).
 */
function ensureAnnouncer(): HTMLDivElement | null {
    if (typeof document === 'undefined') {
        return null;
    }
    if (!announcer) {
        announcer = document.createElement('div');
        announcer.setAttribute('role', 'status');
        announcer.setAttribute('aria-live', 'polite');
        announcer.setAttribute('aria-atomic', 'true');
        announcer.className = 'sr-only';
        announcer.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
        document.body.appendChild(announcer);
    }
    return announcer;
}

/**
 * Announce a message to screen readers.
 * No-op in non-DOM environments (SSR).
 */
export function announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    const el = ensureAnnouncer();
    if (!el) return; // Gracefully degrade in SSR

    el.setAttribute('aria-live', priority);

    // Clear and set to trigger announcement
    el.textContent = '';
    requestAnimationFrame(() => {
        el.textContent = message;
    });
}

/**
 * Announce photo capture status
 */
export function announcePhotoCapture(category: 'before' | 'after', success: boolean): void {
    const message = success
        ? `${category} photo captured successfully`
        : `Failed to capture ${category} photo`;
    announce(message, success ? 'polite' : 'assertive');
}

/**
 * Announce photo deletion
 */
export function announcePhotoDeleted(category: string): void {
    announce(`${category} photo deleted`);
}

/**
 * Announce sync status
 */
export function announceSyncStatus(pending: number, synced: number): void {
    if (pending === 0) {
        announce('All photos synced');
    } else {
        announce(`${pending} photos pending sync, ${synced} synced`);
    }
}

// ============================================
// Keyboard Navigation
// ============================================

export type KeyboardHandler = (event: KeyboardEvent) => void;

export interface KeyBindings {
    [key: string]: KeyboardHandler;
}

/**
 * Create a keyboard navigation handler.
 * Normalizes single-character keys to lowercase for consistent matching.
 */
export function createKeyboardHandler(bindings: KeyBindings): KeyboardHandler {
    return (event: KeyboardEvent) => {
        // Normalize single-character keys to lowercase for consistent matching
        // (e.g., 'Z' with Shift becomes 'z' to match 'Ctrl+Shift+z')
        const normalizedKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;

        // Build key string with modifiers
        const parts: string[] = [];
        if (event.ctrlKey) parts.push('Ctrl');
        if (event.altKey) parts.push('Alt');
        if (event.shiftKey) parts.push('Shift');
        if (event.metaKey) parts.push('Meta');
        parts.push(normalizedKey);

        const keyString = parts.join('+');
        const handler = bindings[keyString] || bindings[normalizedKey];

        if (handler) {
            handler(event);
        }
    };
}

/**
 * Default photo gallery keyboard bindings
 */
export const GALLERY_KEY_BINDINGS: Readonly<Record<string, string>> = {
    ArrowLeft: 'Previous photo',
    ArrowRight: 'Next photo',
    ArrowUp: 'Previous row',
    ArrowDown: 'Next row',
    Enter: 'Open photo',
    Space: 'Select photo',
    Delete: 'Delete photo',
    Escape: 'Close lightbox',
    'Shift++': 'Zoom in',
    '-': 'Zoom out',
    '0': 'Reset zoom',
};

/**
 * Default editor keyboard bindings
 */
export const EDITOR_KEY_BINDINGS: Readonly<Record<string, string>> = {
    'Ctrl+z': 'Undo',
    'Ctrl+y': 'Redo',
    'Ctrl+Shift+z': 'Redo',
    r: 'Rotate right',
    'Shift+r': 'Rotate left',
    s: 'Save',
    Escape: 'Cancel',
};

// ============================================
// Focus Management
// ============================================

/**
 * Trap focus within an element (for modals)
 */
export function trapFocus(container: HTMLElement): () => void {
    const focusableElements = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Tab') return;

        if (event.shiftKey) {
            if (document.activeElement === firstFocusable) {
                event.preventDefault();
                lastFocusable?.focus();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                event.preventDefault();
                firstFocusable?.focus();
            }
        }
    };

    container.addEventListener('keydown', handleKeyDown);
    firstFocusable?.focus();

    return () => {
        container.removeEventListener('keydown', handleKeyDown);
    };
}

/**
 * Save and restore focus (for closing modals)
 */
export function createFocusGuard(): { save: () => void; restore: () => void } {
    let previousFocus: HTMLElement | null = null;

    return {
        save: () => {
            previousFocus = document.activeElement as HTMLElement;
        },
        restore: () => {
            if (previousFocus && typeof previousFocus.focus === 'function') {
                previousFocus.focus();
            }
        },
    };
}

// ============================================
// ARIA Attribute Generators
// ============================================

/**
 * Generate ARIA attributes for a photo thumbnail
 */
export function getPhotoThumbnailAria(photo: {
    id: string;
    category: string;
    timestamp: string;
    index?: number;
    total?: number;
}): Record<string, string> {
    const attrs: Record<string, string> = {
        role: 'button',
        'aria-label': `${photo.category} photo, captured ${new Date(photo.timestamp).toLocaleString()}`,
    };

    if (photo.index !== undefined && photo.total !== undefined) {
        attrs['aria-describedby'] = `photo-${photo.id}-desc`;
        attrs['aria-posinset'] = String(photo.index + 1);
        attrs['aria-setsize'] = String(photo.total);
    }

    return attrs;
}

/**
 * Generate ARIA attributes for the photo lightbox
 */
export function getLightboxAria(currentIndex: number, total: number): Record<string, string> {
    return {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': `Photo ${currentIndex + 1} of ${total}`,
        'aria-describedby': 'lightbox-controls-description',
    };
}

/**
 * Generate ARIA attributes for the photo editor
 */
export function getEditorAria(): Record<string, string> {
    return {
        role: 'application',
        'aria-label': 'Photo editor',
        'aria-describedby': 'editor-help',
    };
}

/**
 * Generate ARIA attributes for a slider control
 */
export function getSliderAria(
    label: string,
    value: number,
    min: number,
    max: number
): Record<string, string> {
    return {
        role: 'slider',
        'aria-label': label,
        'aria-valuenow': String(value),
        'aria-valuemin': String(min),
        'aria-valuemax': String(max),
        'aria-valuetext': `${value}%`,
    };
}

// ============================================
// Reduced Motion
// ============================================

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Get animation duration based on motion preference
 */
export function getAnimationDuration(normalMs: number): number {
    return prefersReducedMotion() ? 0 : normalMs;
}

// ============================================
// Color Contrast
// ============================================

/**
 * Check if high contrast mode is preferred
 */
export function prefersHighContrast(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-contrast: more)').matches;
}

// ============================================
// Touch Accessibility
// ============================================

/**
 * Minimum touch target size (44x44 as per WCAG)
 */
export const MIN_TOUCH_TARGET_SIZE = 44;

/**
 * Check if an element meets minimum touch target size
 */
export function meetsMinTouchTarget(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return rect.width >= MIN_TOUCH_TARGET_SIZE && rect.height >= MIN_TOUCH_TARGET_SIZE;
}
