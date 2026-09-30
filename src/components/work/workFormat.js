import { format } from "date-fns";

/** Base path of the work tickets feature (kept at the legacy Work Orders URL). */
export const WORK_BASE = "/workorders";

export const workPaths = {
  feed: (filter) => (filter && filter !== "all" ? `${WORK_BASE}?filter=${filter}` : WORK_BASE),
  newTicket: () => `${WORK_BASE}/new`,
  sent: () => `${WORK_BASE}/sent`,
  ticket: (id) => `${WORK_BASE}/t/${encodeURIComponent(id)}`,
  schedule: (id) => `${WORK_BASE}/s/${encodeURIComponent(id)}`,
};

export const FEED_FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "quote", label: "Quotes" },
  { id: "paid", label: "Paid" },
  { id: "recurring", label: "Recurring" },
];

export function normalizeFilter(value) {
  return FEED_FILTERS.some((f) => f.id === value) ? value : "all";
}

/** Formats dollars as "$1,234.50". */
export function money(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  const fixed = (Math.round(n * 100) / 100).toFixed(2);
  const [whole, cents] = fixed.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  return `${sign}$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

export function roundCents(n) {
  return Math.round(n * 100) / 100;
}

export function sumItems(items) {
  return roundCents((items || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
}

export const MAX_INTEGER_DIGITS = 5;

/**
 * Keypad entry rules for the amount string:
 * one decimal point, two decimals max, five integer digits max, backspace.
 */
export function pressKey(amount, key) {
  const a = amount || "";
  if (key === "back") return a.slice(0, -1);
  if (key === ".") return a.includes(".") ? a : `${a || "0"}.`;
  if (!/^\d$/.test(key)) return a;
  const dot = a.indexOf(".");
  if (dot !== -1 && a.length - dot > 2) return a;
  if (dot === -1 && a.replace(/^0+/, "").length >= MAX_INTEGER_DIGITS) return a;
  if (a === "0") return key;
  return a + key;
}

export function parseAmount(amount) {
  const v = parseFloat(amount);
  return Number.isFinite(v) ? roundCents(v) : 0;
}

/** Visual + label for a ticket's status chip. */
export const STATUS_META = {
  draft: { label: "Draft", className: "bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100" },
  quote: { label: "Quote sent", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-100" },
  requested: { label: "Requested", className: "bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-100" },
  paid: { label: "Paid", className: "bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-100" },
  canceled: { label: "Canceled", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200" },
};

export function ticketStatusKey(ticket) {
  if (!ticket) return "draft";
  if (ticket.status === "requested" && ticket.overdue) return "overdue";
  return STATUS_META[ticket.status] ? ticket.status : "draft";
}

export function ticketAmountClass(ticket) {
  if (ticket?.status === "paid") return "text-teal-700 dark:text-teal-300";
  if (ticket?.status === "canceled") return "text-ink-muted line-through";
  return "text-ink";
}

export function scheduleChip(schedule) {
  if (schedule.last_error) {
    return { label: "Needs attention", className: STATUS_META.overdue.className };
  }
  if (schedule.paused) {
    return { label: "Paused", className: STATUS_META.canceled.className };
  }
  if (schedule.autopay && schedule.card_label) {
    return { label: "Autopay", className: STATUS_META.paid.className };
  }
  return { label: "Invoice", className: STATUS_META.quote.className };
}

export function cadenceText(cadence) {
  return cadence === "weekly" ? "Weekly on Mon" : "Monthly on the 1st";
}

export function billingText(schedule) {
  if (schedule.bill_mode === "visits") return `${money(schedule.rate)}/visit + chemicals`;
  return `${money(schedule.rate)}${schedule.cadence === "weekly" ? "/wk" : "/mo"}`;
}

/** Short relative time used in the activity timeline ("Now", "5m", "3h", "2d", "Sep 12"). */
export function shortWhen(at, now = Date.now()) {
  if (!at) return "";
  const diff = Math.max(0, now - at);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "Now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return format(new Date(at), "MMM d");
}

export function shortDate(at) {
  if (!at) return "";
  return format(new Date(at), "EEE, MMM d");
}

export function timelineDotClass(event) {
  const key = `${event?.type || ""} ${event?.text || ""}`.toLowerCase();
  if (/paid|autopay|charged/.test(key)) return "bg-teal-700";
  if (/declin|cancel|refund/.test(key)) return "bg-gray-500";
  if (/quote|estimate/.test(key)) return "bg-indigo-700";
  if (/sent|request|remind|invoice/.test(key)) return "bg-amber-700";
  return "bg-gray-400";
}

export const PAID_METHODS = [
  { id: "cash", label: "Cash" },
  { id: "check", label: "Check" },
  { id: "other", label: "Other" },
];

export function deliveredViaText(via, name) {
  if (via === "email") return `${name} gets an email`;
  if (via === "sms") return `${name} gets a text`;
  return `${name} has no email or phone on file, so share the pay link from the ticket`;
}

/**
 * Turns a thrown Convex error into the user-readable message the server wrote.
 * Convex wraps server errors as "[CONVEX A(tickets:send)] [Request ID: …] Server Error\nUncaught Error: <message>\n    at …".
 */
export function readableError(error, fallback = "Something went wrong. Try again.") {
  if (!error) return fallback;
  if (typeof error?.data === "string" && error.data.trim()) return error.data.trim();
  if (typeof error?.data?.message === "string" && error.data.message.trim()) return error.data.message.trim();
  const raw = typeof error === "string" ? error : error.message;
  if (!raw) return fallback;
  const uncaught = raw.match(/Uncaught (?:\w*Error): ([^\n]+)/);
  if (uncaught) return uncaught[1].trim();
  const stripped = raw.replace(/\[[^\]]*\]\s*/g, "").split("\n")[0].trim();
  if (!stripped || /^Server Error$/i.test(stripped)) return fallback;
  return stripped;
}
