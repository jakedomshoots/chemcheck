/**
 * Customer portal link helpers (browser side).
 */

export const PORTAL_ROUTE_PATH = "/portal/:token";

const UUID_LIKE = /^[A-Za-z0-9-]{16,64}$/;

export function isPortalToken(value: unknown): value is string {
  return typeof value === "string" && UUID_LIKE.test(value);
}

export function buildPortalPath(token: string): string {
  return `/portal/${encodeURIComponent(token)}`;
}

/** Absolute portal URL. Defaults to the current origin; pass one explicitly outside the browser. */
export function buildPortalUrl(token: string, origin?: string): string {
  const base = (origin ?? (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  return `${base}${buildPortalPath(token)}`;
}

/** Copy text with the async clipboard API, falling back to a hidden textarea. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function daysUntil(timestamp: number | null | undefined, now = Date.now()): number | null {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return null;
  return Math.ceil((timestamp - now) / 86400000);
}

export function formatPortalExpiry(expiresAt: number | null | undefined, now = Date.now()): string {
  const days = daysUntil(expiresAt, now);
  if (days === null) return "Never expires";
  if (days <= 0) return "Expired";
  if (days === 1) return "Expires tomorrow";
  if (days < 30) return `Expires in ${days} days`;
  return `Expires ${new Date(expiresAt as number).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export function formatVisitDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!match) return iso ?? "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

/** Today's date as YYYY-MM-DD in the viewer's local time zone (for the date input `min`). */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
