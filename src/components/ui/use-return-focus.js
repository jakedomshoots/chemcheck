import { useCallback, useEffect, useRef } from "react";

/**
 * Restore keyboard focus to whatever opened a dialog once it closes.
 *
 * Radix modal content focuses its `DialogTrigger` on close. Dialogs that are
 * opened from React state (no trigger element) therefore drop focus onto
 * `<body>`. This hook remembers the active element when `open` flips to
 * true and hands back an `onCloseAutoFocus` handler that focuses it again.
 *
 * Usage:
 *   const onCloseAutoFocus = useReturnFocus(open);
 *   <DialogContent onCloseAutoFocus={onCloseAutoFocus}>…</DialogContent>
 */
export function useReturnFocus(open) {
  const openerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (active && active !== document.body) {
      openerRef.current = active;
    }
  }, [open]);

  return useCallback((event) => {
    const opener = openerRef.current;
    if (!opener || typeof opener.focus !== "function" || !opener.isConnected) return;
    event?.preventDefault?.();
    opener.focus({ preventScroll: true });
  }, []);
}

export default useReturnFocus;
