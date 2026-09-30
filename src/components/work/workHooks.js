import { useCallback, useEffect, useRef, useState } from "react";
import { useConvexConnectionState } from "convex/react";
import { toast } from "sonner";
import { readableError } from "./workFormat";

function readNavigatorOnline() {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

/**
 * Tickets are cloud-only: sending needs both a network and a live Convex socket.
 * Returns true when the device is offline or Convex has dropped its connection.
 */
export function useWorkOffline() {
  const [online, setOnline] = useState(readNavigatorOnline);
  const connection = useConvexConnectionState();

  useEffect(() => {
    const update = () => setOnline(readNavigatorOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const socketDown = Boolean(connection?.hasEverConnected && !connection?.isWebSocketConnected);
  return !online || socketDown;
}

/**
 * Runs one async action at a time: tracks which action is pending, ignores
 * double-submits, and shows thrown server messages in a toast.
 */
export function useWorkRunner() {
  const [pending, setPending] = useState(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (key, fn) => {
    if (busyRef.current) return { ok: false };
    busyRef.current = true;
    setPending(key);
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (error) {
      toast.error(readableError(error));
      return { ok: false, error };
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setPending(null);
    }
  }, []);

  return { pending, run };
}

/** Moves focus to the screen heading when a work screen mounts (route change). */
export function useFocusOnMount(ref, deps = []) {
  useEffect(() => {
    const node = ref.current;
    if (node && typeof node.focus === "function") {
      node.focus({ preventScroll: true });
    }
  }, deps);
}
