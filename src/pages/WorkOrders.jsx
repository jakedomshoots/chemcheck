import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { useCustomers } from "@/api/convexHooks";
import { createPageUrl } from "@/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ClipboardList,
  CalendarClock,
  UserRound,
  DollarSign,
  CheckCircle2,
  FileText,
  FileDown,
  Send,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import {
  calculateInvoiceTotalsFromQuote,
  canConvertQuote,
  canDraftInvoiceFromQuote,
  hasPendingDeposit,
  isWorkOrderCompleted,
} from "@/lib/workOrderLifecycle";
import { downloadInvoicePdf, downloadQuotePdf } from "@/lib/workOrderDocuments";
import { normalizeTaxRateInput } from "@/lib/taxRate";
import {
  getDefaultWorkOrdersSectionFromStorage,
  isWorkOrdersSplitEnabled,
  normalizeWorkOrdersSection,
} from "@/lib/workOrdersNavigation";

const LOCAL_WORK_ORDERS_KEY = "chemcheck_local_work_orders";
const LOCAL_INVOICES_KEY = "chemcheck_local_invoices";
const LOCAL_INVOICES_MIGRATION_V1_KEY = "chemcheck_local_invoices_migration_v1";
const LOCAL_QUOTES_KEY = "chemcheck_local_quotes";
const LOCAL_QUOTES_MIGRATION_V1_KEY = "chemcheck_local_quotes_migration_v1";
const LOCAL_COMMUNICATIONS_KEY = "chemcheck_local_communications";
const LOCAL_REMINDER_AUTOPILOT_ENABLED_KEY = "chemcheck_reminder_autopilot_enabled";
const LOCAL_REMINDER_AUTOPILOT_INTERVAL_KEY = "chemcheck_reminder_autopilot_interval_minutes";
const LOCAL_REMINDER_AUTOPILOT_NEXT_RUN_KEY = "chemcheck_reminder_autopilot_next_run";
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function getDatePlusDays(baseDate, days) {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getMonthStringFromDate(dateString) {
  if (!dateString) return "";
  return String(dateString).slice(0, 7);
}

function getMonthFromTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function toMonthLabel(monthString) {
  if (!monthString) return "Unknown month";
  const date = new Date(`${monthString}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return monthString;
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/^[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return str;
}

function downloadCsv(filename, headers, rows) {
  const content = [
    headers.map((header) => csvEscape(header)).join(","),
    ...rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")),
  ].join("\n");
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function makeLocalId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function statusBadgeClass(status) {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-700";
    case "in_progress":
      return "bg-amber-100 text-amber-700";
    case "cancelled":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-cyan-100 text-cyan-700";
  }
}

function invoiceStatusBadgeClass(status) {
  switch (status) {
    case "paid":
      return "bg-emerald-100 text-emerald-700";
    case "sent":
      return "bg-blue-100 text-blue-700";
    case "cancelled":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function quoteStatusBadgeClass(status) {
  switch (status) {
    case "approved":
      return "bg-emerald-100 text-emerald-700";
    case "sent":
      return "bg-blue-100 text-blue-700";
    case "declined":
      return "bg-rose-100 text-rose-700";
    case "converted":
      return "bg-cyan-100 text-cyan-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function roundCurrency(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeQuoteRecord(quote) {
  const lineItems = Array.isArray(quote?.line_items)
    ? quote.line_items.map((item) => {
        const quantity = toFiniteNumber(item?.quantity, 0);
        const unitPrice = toFiniteNumber(item?.unit_price, 0);
        const fallbackAmount = roundCurrency(quantity * unitPrice);
        return {
          ...item,
          quantity,
          unit_price: unitPrice,
          amount: toFiniteNumber(item?.amount, fallbackAmount),
        };
      })
    : [];

  const subtotal = toFiniteNumber(quote?.subtotal, 0);
  const tax = toFiniteNumber(quote?.tax, 0);
  const grossTotal = roundCurrency(subtotal + tax);
  const total = toFiniteNumber(quote?.total, grossTotal);

  const hasDepositValue = quote?.deposit_required !== undefined
    && quote?.deposit_required !== null
    && quote?.deposit_required !== "";
  const depositRequired = hasDepositValue
    ? Math.max(0, toFiniteNumber(quote.deposit_required, 0))
    : undefined;

  const depositStatus = depositRequired && depositRequired > 0
    ? (quote?.deposit_status === "paid" ? "paid" : "pending")
    : "not_required";

  return {
    ...quote,
    line_items: lineItems,
    subtotal,
    tax,
    total,
    deposit_required: depositRequired,
    deposit_status: depositStatus,
  };
}

function normalizeInvoiceRecord(invoice) {
  const lineItems = Array.isArray(invoice?.line_items)
    ? invoice.line_items.map((item) => {
        const quantity = toFiniteNumber(item?.quantity, 0);
        const unitPrice = toFiniteNumber(item?.unit_price, 0);
        const fallbackAmount = roundCurrency(quantity * unitPrice);
        return {
          ...item,
          quantity,
          unit_price: unitPrice,
          amount: toFiniteNumber(item?.amount, fallbackAmount),
        };
      })
    : [];

  const subtotal = toFiniteNumber(invoice?.subtotal, 0);
  const tax = toFiniteNumber(invoice?.tax, 0);
  const grossTotal = roundCurrency(subtotal + tax);
  const depositApplied = Math.max(0, toFiniteNumber(invoice?.deposit_applied, 0));
  const totalFallback = roundCurrency(Math.max(0, grossTotal - depositApplied));
  const notes = resolveInvoiceNotes(invoice?.notes, lineItems, undefined);

  return {
    ...invoice,
    line_items: lineItems,
    subtotal,
    tax,
    deposit_applied: depositApplied > 0 ? depositApplied : undefined,
    notes,
    total: toFiniteNumber(invoice?.total, totalFallback),
  };
}

function formatTaxRateForInput(subtotal, tax) {
  const safeSubtotal = toFiniteNumber(subtotal, 0);
  const safeTax = toFiniteNumber(tax, 0);
  if (safeSubtotal <= 0 || safeTax <= 0) return "0";
  return String(Number(((safeTax / safeSubtotal) * 100).toFixed(2)));
}

function matchesSearch(haystack, needle) {
  if (!needle) return true;
  const normalizedNeedle = needle.trim().toLowerCase();
  if (!normalizedNeedle) return true;
  return String(haystack || "").toLowerCase().includes(normalizedNeedle);
}

function resolveInvoiceNotes(notes, lineItems, fallback) {
  const explicitNotes = String(notes || "").trim();
  if (explicitNotes) return explicitNotes;

  const lineDescription = (Array.isArray(lineItems) ? lineItems : [])
    .map((item) => String(item?.description || "").trim())
    .find(Boolean);
  if (lineDescription) return lineDescription;

  const fallbackText = String(fallback || "").trim();
  return fallbackText || undefined;
}

function getInvoicePrimaryDescription(invoice) {
  if (!invoice) return "";
  const lineDescription = (Array.isArray(invoice.line_items) ? invoice.line_items : [])
    .map((item) => String(item?.description || "").trim())
    .find(Boolean);
  if (lineDescription) return lineDescription;
  return String(invoice.notes || "").trim();
}

function calculateDraftTotals({ lineItems, taxRate, quote }) {
  const subtotal = roundCurrency(
    (Array.isArray(lineItems) ? lineItems : []).reduce(
      (sum, item) => sum + toFiniteNumber(item?.amount, 0),
      0
    )
  );
  const safeTaxRate = normalizeTaxRateInput(toFiniteNumber(taxRate, 0));
  const tax = roundCurrency(subtotal * safeTaxRate);
  const grossTotal = roundCurrency(subtotal + tax);
  const depositApplied = getDepositAppliedAmount(quote, grossTotal);
  const total = roundCurrency(Math.max(0, grossTotal - depositApplied));
  return { subtotal, tax, grossTotal, depositApplied, total };
}

function getDepositAppliedAmount(quote, grossTotal) {
  const totals = calculateInvoiceTotalsFromQuote({
    subtotal: grossTotal,
    tax: 0,
    quote,
  });
  return totals.depositApplied;
}

function communicationStatusBadgeClass(status) {
  switch (status) {
    case "delivered":
      return "bg-cyan-100 text-cyan-700";
    case "sent":
      return "bg-emerald-100 text-emerald-700";
    case "failed":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-blue-100 text-blue-700";
  }
}

function formatTimestamp(ts) {
  if (!ts || !Number.isFinite(ts)) return null;
  return new Date(ts).toLocaleString();
}

function formatDepositSource(source) {
  if (source === "stripe") return "Stripe";
  if (source === "manual") return "Manual";
  return null;
}

function isValidEmailForSend(value) {
  if (!value || typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) return false;
  const blocked = new Set(["example.com", "example.net", "example.org", "test.com", "localhost", "localdomain"]);
  const domain = normalized.split("@")[1] || "";
  return !blocked.has(domain);
}

function isValidPhoneForSend(value) {
  if (!value || typeof value !== "string") return false;
  const digits = value.replace(/[^\d]/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function hasValidSendDestination(customer) {
  if (!customer) return false;
  return isValidPhoneForSend(customer.phone) || isValidEmailForSend(customer.email);
}

function isValidRecipientForChannel(channel, recipient) {
  if (channel === "sms") return isValidPhoneForSend(recipient);
  if (channel === "email") return isValidEmailForSend(recipient);
  return false;
}

function resolvePreferredSendDestination(customer) {
  const phone = isValidPhoneForSend(customer?.phone) ? String(customer.phone).trim() : "";
  const email = isValidEmailForSend(customer?.email) ? String(customer.email).trim() : "";
  if (phone) return { channel: "sms", recipient: phone };
  if (email) return { channel: "email", recipient: email };
  return null;
}

function safeLoadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export default function WorkOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const workOrdersSplitEnabled = useMemo(() => isWorkOrdersSplitEnabled(), []);
  const defaultSection = useMemo(
    () => (workOrdersSplitEnabled ? getDefaultWorkOrdersSectionFromStorage() : "dispatch"),
    [workOrdersSplitEnabled]
  );
  const [selectedDate, setSelectedDate] = useState(getTodayDateString());
  const [form, setForm] = useState({
    customer_id: "",
    title: "",
    description: "",
    assignee_email: "",
    is_recurring: false,
    recurrence_rule: "",
    priority: "medium",
  });
  const [isCreating, setIsCreating] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    customer_id: "",
    work_order_id: "",
    description: "",
    quantity: "1",
    unit_price: "120",
    tax_rate: "0",
    due_date: getDatePlusDays(getTodayDateString(), 7),
  });
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [invoiceActionId, setInvoiceActionId] = useState(null);
  const [isQueueingReminders, setIsQueueingReminders] = useState(false);
  const [isRetryingFailedCommunications, setIsRetryingFailedCommunications] = useState(false);
  const [reminderAutopilotEnabled, setReminderAutopilotEnabled] = useState(false);
  const [reminderAutopilotIntervalMinutes, setReminderAutopilotIntervalMinutes] = useState("60");
  const [reminderAutopilotNextRunAt, setReminderAutopilotNextRunAt] = useState(null);
  const [isReminderAutopilotRunning, setIsReminderAutopilotRunning] = useState(false);
  const [isBatchInvoicing, setIsBatchInvoicing] = useState(false);
  const [batchInvoiceForm, setBatchInvoiceForm] = useState({
    from_date: getDatePlusDays(getTodayDateString(), -7),
    to_date: getTodayDateString(),
    unit_price: "120",
    tax_rate: "0",
    due_in_days: "7",
    auto_send: false,
  });
  const [quoteForm, setQuoteForm] = useState({
    customer_id: "",
    title: "",
    description: "",
    quantity: "1",
    unit_price: "120",
    tax_rate: "0",
    deposit_required: "",
    valid_until: getDatePlusDays(getTodayDateString(), 14),
  });
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);
  const [quoteActionId, setQuoteActionId] = useState(null);
  const [isDeliveringCommunications, setIsDeliveringCommunications] = useState(false);
  const [quoteStatusFilter, setQuoteStatusFilter] = useState("active");
  const [quoteSearchTerm, setQuoteSearchTerm] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("open");
  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState("");
  const [monthCloseMonth, setMonthCloseMonth] = useState(getMonthStringFromDate(getTodayDateString()));
  const [alternateRecipientEditor, setAlternateRecipientEditor] = useState({
    key: null,
    channel: "email",
    recipient: "",
  });
  const reminderAutopilotRunningRef = useRef(false);
  const queueRemindersRef = useRef(null);

  const activeSection = useMemo(() => {
    const pathname = location.pathname.toLowerCase();
    const pathParts = pathname.split("/").filter(Boolean);
    const routeSection = pathParts.length >= 2 ? pathParts[1] : defaultSection;
    const resolvedSection = normalizeWorkOrdersSection(routeSection, defaultSection);
    return workOrdersSplitEnabled ? resolvedSection : "dispatch";
  }, [defaultSection, location.pathname, workOrdersSplitEnabled]);

  const viewMode = searchParams.get("view") === "compact" ? "compact" : "detailed";
  const isCompactView = viewMode === "compact";

  const [localWorkOrders, setLocalWorkOrders] = useState([]);
  const [localInvoices, setLocalInvoices] = useState([]);
  const [localQuotes, setLocalQuotes] = useState([]);
  const [localCommunications, setLocalCommunications] = useState([]);

  useEffect(() => {
    const pathname = location.pathname.toLowerCase();
    if (!pathname.startsWith("/workorders")) return;
    const pathParts = pathname.split("/").filter(Boolean);
    const routeSection = pathParts.length >= 2 ? pathParts[1] : defaultSection;
    const resolvedSection = workOrdersSplitEnabled
      ? normalizeWorkOrdersSection(routeSection, defaultSection)
      : "dispatch";
    if (routeSection !== resolvedSection) {
      navigate(`/workorders/${resolvedSection}`, { replace: true });
    }
  }, [defaultSection, location.pathname, navigate, workOrdersSplitEnabled]);

  const handleSectionChange = (section) => {
    if (!workOrdersSplitEnabled) return;
    const params = new URLSearchParams(searchParams);
    const query = params.toString();
    navigate(`/workorders/${section}${query ? `?${query}` : ""}`);
  };

  const handleViewModeChange = (nextView) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextView === "detailed") {
      nextParams.delete("view");
    } else {
      nextParams.set("view", "compact");
    }
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    const loadedWorkOrders = safeLoadJson(LOCAL_WORK_ORDERS_KEY, []);
    const loadedInvoices = safeLoadJson(LOCAL_INVOICES_KEY, []);
    const loadedQuotes = safeLoadJson(LOCAL_QUOTES_KEY, []);
    const loadedCommunications = safeLoadJson(LOCAL_COMMUNICATIONS_KEY, []);

    setLocalWorkOrders(loadedWorkOrders);
    const normalizedInvoices = loadedInvoices.map((invoice) => normalizeInvoiceRecord(invoice));
    setLocalInvoices(normalizedInvoices);
    const invoiceMigrationCompleted = localStorage.getItem(LOCAL_INVOICES_MIGRATION_V1_KEY) === "true";
    if (!invoiceMigrationCompleted) {
      localStorage.setItem(LOCAL_INVOICES_KEY, JSON.stringify(normalizedInvoices));
      localStorage.setItem(LOCAL_INVOICES_MIGRATION_V1_KEY, "true");
    }

    const normalizedQuotes = loadedQuotes.map((quote) => normalizeQuoteRecord(quote));
    setLocalQuotes(normalizedQuotes);
    const migrationCompleted = localStorage.getItem(LOCAL_QUOTES_MIGRATION_V1_KEY) === "true";
    if (!migrationCompleted) {
      localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(normalizedQuotes));
      localStorage.setItem(LOCAL_QUOTES_MIGRATION_V1_KEY, "true");
    }

    setLocalCommunications(loadedCommunications);

    const storedAutopilotEnabled = localStorage.getItem(LOCAL_REMINDER_AUTOPILOT_ENABLED_KEY);
    const storedAutopilotInterval = localStorage.getItem(LOCAL_REMINDER_AUTOPILOT_INTERVAL_KEY);
    const storedAutopilotNextRun = localStorage.getItem(LOCAL_REMINDER_AUTOPILOT_NEXT_RUN_KEY);
    if (storedAutopilotEnabled === "true" || storedAutopilotEnabled === "false") {
      setReminderAutopilotEnabled(storedAutopilotEnabled === "true");
    }
    if (storedAutopilotInterval && Number.isFinite(Number(storedAutopilotInterval))) {
      setReminderAutopilotIntervalMinutes(String(Math.max(15, Math.min(720, Math.floor(Number(storedAutopilotInterval))))));
    }
    if (storedAutopilotNextRun && Number.isFinite(Number(storedAutopilotNextRun))) {
      setReminderAutopilotNextRunAt(Number(storedAutopilotNextRun));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCAL_WORK_ORDERS_KEY, JSON.stringify(localWorkOrders));
  }, [localWorkOrders]);

  useEffect(() => {
    localStorage.setItem(LOCAL_INVOICES_KEY, JSON.stringify(localInvoices));
  }, [localInvoices]);

  useEffect(() => {
    localStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(localQuotes));
  }, [localQuotes]);

  useEffect(() => {
    localStorage.setItem(LOCAL_COMMUNICATIONS_KEY, JSON.stringify(localCommunications));
  }, [localCommunications]);

  useEffect(() => {
    localStorage.setItem(LOCAL_REMINDER_AUTOPILOT_ENABLED_KEY, reminderAutopilotEnabled ? "true" : "false");
  }, [reminderAutopilotEnabled]);

  useEffect(() => {
    const minutes = Math.max(15, Math.min(720, Math.floor(toFiniteNumber(reminderAutopilotIntervalMinutes, 60))));
    localStorage.setItem(LOCAL_REMINDER_AUTOPILOT_INTERVAL_KEY, String(minutes));
  }, [reminderAutopilotIntervalMinutes]);

  useEffect(() => {
    if (!reminderAutopilotNextRunAt || !Number.isFinite(reminderAutopilotNextRunAt)) {
      localStorage.removeItem(LOCAL_REMINDER_AUTOPILOT_NEXT_RUN_KEY);
      return;
    }
    localStorage.setItem(LOCAL_REMINDER_AUTOPILOT_NEXT_RUN_KEY, String(reminderAutopilotNextRunAt));
  }, [reminderAutopilotNextRunAt]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    const handleStripeReturn = async () => {
      const url = new URL(window.location.href);
      const paymentStatus = url.searchParams.get("stripe_payment");
      const sessionId = url.searchParams.get("session_id");
      if (!paymentStatus) return;

      if (paymentStatus === "invoice_success" || paymentStatus === "deposit_success") {
        if (sessionId) {
          try {
            const result = await syncCheckoutSessionStatus({ session_id: sessionId });
            if (cancelled) return;
            if (result?.success && result?.synced) {
              toast.success("Payment received and synced.");
            } else if (result?.success && !result?.synced) {
              toast.message("Payment received. Final confirmation may take a minute.");
            } else {
              toast.message("Payment received. We are still confirming details.");
            }
          } catch {
            if (!cancelled) {
              toast.message("Payment received. Final confirmation may take a minute.");
            }
          }
        } else {
          toast.success(paymentStatus === "invoice_success" ? "Invoice payment received." : "Deposit payment received.");
        }
      } else if (paymentStatus === "invoice_cancel" || paymentStatus === "deposit_cancel") {
        toast.message("Payment was cancelled.");
      }

      url.searchParams.delete("stripe_payment");
      url.searchParams.delete("invoice_id");
      url.searchParams.delete("quote_id");
      url.searchParams.delete("session_id");
      const newQuery = url.searchParams.toString();
      window.history.replaceState({}, "", `${url.pathname}${newQuery ? `?${newQuery}` : ""}${url.hash}`);
    };

    void handleStripeReturn();
    return () => {
      cancelled = true;
    };
  }, []);

  const localCustomers = useCustomers();
  const currentBusiness = useQuery(api.businesses.getCurrent, {});
  const cloudEnabled = Boolean(currentBusiness);

  const cloudCustomersData = useQuery(api.customers.list, cloudEnabled ? {} : "skip");
  const teamMembersData = useQuery(api.businesses.getTeamMembers, cloudEnabled ? {} : "skip");
  const workOrdersData = useQuery(api.workOrders.list, cloudEnabled ? { scheduled_date: selectedDate } : "skip");
  const allWorkOrdersData = useQuery(api.workOrders.list, cloudEnabled ? {} : "skip");
  const allInvoicesData = useQuery(api.invoices.list, cloudEnabled ? {} : "skip");
  const allQuotesData = useQuery(api.quotes.list, cloudEnabled ? {} : "skip");
  const communicationsData = useQuery(api.communications.list, cloudEnabled ? {} : "skip");

  const createWorkOrder = useMutation(api.workOrders.create);
  const updateWorkOrder = useMutation(api.workOrders.update);
  const completeWorkOrder = useMutation(api.workOrders.complete);
  const removeWorkOrder = useMutation(api.workOrders.remove);
  const createInvoiceDraft = useMutation(api.invoices.createDraft);
  const batchCreateFromCompletedWorkOrders = useMutation(api.invoices.batchCreateFromCompletedWorkOrders);
  const sendInvoiceWithStripe = useAction(api.payments.sendInvoiceWithStripe);
  const syncCheckoutSessionStatus = useAction(api.payments.syncCheckoutSessionStatus);
  const deliverCommunication = useAction(api.communications.deliver);
  const deliverQueuedCommunications = useAction(api.communications.deliverQueued);
  const requeueFailedCommunications = useMutation(api.communications.requeueFailed);
  const markInvoicePaid = useMutation(api.invoices.markPaid);
  const queueUnpaidReminders = useMutation(api.invoices.queueUnpaidReminders);
  const createQuote = useMutation(api.quotes.create);
  const updateQuoteStatus = useMutation(api.quotes.updateStatus);
  const convertQuoteToWorkOrder = useMutation(api.quotes.convertToWorkOrder);
  const createDepositPaymentLink = useAction(api.payments.createDepositPaymentLink);

  const cloudCustomers = useMemo(() => cloudCustomersData ?? [], [cloudCustomersData]);
  const customers = useMemo(() => {
    if (cloudEnabled) return cloudCustomers;
    return localCustomers ?? [];
  }, [cloudEnabled, cloudCustomers, localCustomers]);

  const teamMembers = useMemo(() => teamMembersData ?? [], [teamMembersData]);

  const workOrders = useMemo(() => {
    if (cloudEnabled) return workOrdersData ?? [];
    return (localWorkOrders ?? [])
      .filter((item) => item.scheduled_date === selectedDate)
      .sort((a, b) => a.created_at - b.created_at);
  }, [cloudEnabled, workOrdersData, localWorkOrders, selectedDate]);

  const allWorkOrders = useMemo(() => {
    if (cloudEnabled) return allWorkOrdersData ?? [];
    return (localWorkOrders ?? []).slice().sort((a, b) => a.created_at - b.created_at);
  }, [cloudEnabled, allWorkOrdersData, localWorkOrders]);

  const allInvoices = useMemo(() => {
    if (cloudEnabled) {
      return (allInvoicesData ?? []).map((invoice) => normalizeInvoiceRecord(invoice));
    }
    return (localInvoices ?? [])
      .map((invoice) => normalizeInvoiceRecord(invoice))
      .slice()
      .sort((a, b) => b.created_at - a.created_at);
  }, [cloudEnabled, allInvoicesData, localInvoices]);

  const allQuotes = useMemo(() => {
    if (cloudEnabled) {
      return (allQuotesData ?? []).map((quote) => normalizeQuoteRecord(quote));
    }
    return (localQuotes ?? [])
      .map((quote) => normalizeQuoteRecord(quote))
      .slice()
      .sort((a, b) => b.created_at - a.created_at);
  }, [cloudEnabled, allQuotesData, localQuotes]);

  const allCommunications = useMemo(() => {
    if (cloudEnabled) return communicationsData ?? [];
    return (localCommunications ?? []).slice().sort((a, b) => b.created_at - a.created_at);
  }, [cloudEnabled, communicationsData, localCommunications]);

  const customerById = useMemo(() => {
    const map = new Map();
    for (const customer of customers) {
      map.set(String(customer._id), customer);
    }
    return map;
  }, [customers]);

  const workOrderById = useMemo(() => {
    const map = new Map();
    for (const order of allWorkOrders) {
      map.set(String(order._id), order);
    }
    return map;
  }, [allWorkOrders]);

  const invoiceWorkOrderOptions = useMemo(() => {
    const selectedCustomerId = String(invoiceForm.customer_id || "");
    const filteredOrders = (allWorkOrders ?? []).filter((order) =>
      !selectedCustomerId || String(order.customer_id) === selectedCustomerId
    );

    return filteredOrders.sort((a, b) => {
      const dateDiff = String(b.scheduled_date || "").localeCompare(String(a.scheduled_date || ""));
      if (dateDiff !== 0) return dateDiff;
      return Number(b.created_at || 0) - Number(a.created_at || 0);
    });
  }, [allWorkOrders, invoiceForm.customer_id]);

  const quoteById = useMemo(() => {
    const map = new Map();
    for (const quote of allQuotes) {
      map.set(String(quote._id), quote);
    }
    return map;
  }, [allQuotes]);

  const quoteByWorkOrderId = useMemo(() => {
    const map = new Map();
    for (const quote of allQuotes) {
      if (quote.converted_work_order_id) {
        map.set(String(quote.converted_work_order_id), quote);
      }
    }
    return map;
  }, [allQuotes]);

  const invoicedWorkOrderIds = useMemo(() => {
    const ids = new Set();
    for (const invoice of allInvoices) {
      if (invoice.work_order_id) ids.add(String(invoice.work_order_id));
    }
    return ids;
  }, [allInvoices]);

  const invoiceByWorkOrderId = useMemo(() => {
    const map = new Map();
    for (const invoice of allInvoices) {
      if (!invoice.work_order_id) continue;
      const key = String(invoice.work_order_id);
      const existing = map.get(key);
      if (!existing || invoice.created_at > existing.created_at) {
        map.set(key, invoice);
      }
    }
    return map;
  }, [allInvoices]);

  const invoiceByQuoteId = useMemo(() => {
    const map = new Map();
    for (const invoice of allInvoices) {
      if (!invoice.source_quote_id) continue;
      const key = String(invoice.source_quote_id);
      const existing = map.get(key);
      if (!existing || invoice.created_at > existing.created_at) {
        map.set(key, invoice);
      }
    }
    return map;
  }, [allInvoices]);

  const invoicedQuoteIds = useMemo(() => {
    const ids = new Set();
    for (const invoice of allInvoices) {
      if (invoice.source_quote_id) ids.add(String(invoice.source_quote_id));
    }
    return ids;
  }, [allInvoices]);

  const openInvoices = useMemo(() => {
    return allInvoices
      .filter((invoice) => invoice.status !== "cancelled" && invoice.status !== "paid")
      .sort((a, b) => (b.updated_at || b.created_at) - (a.updated_at || a.created_at));
  }, [allInvoices]);

  const paidInvoices = useMemo(() => {
    return allInvoices
      .filter((invoice) => invoice.status === "paid")
      .sort((a, b) => (b.paid_at || b.updated_at || b.created_at) - (a.paid_at || a.updated_at || a.created_at));
  }, [allInvoices]);

  const openQuotes = useMemo(() => {
    return allQuotes
      .filter((quote) => quote.status !== "declined")
      .sort((a, b) => b.created_at - a.created_at);
  }, [allQuotes]);

  const queuedCommunications = useMemo(() => {
    return allCommunications
      .filter((item) => item.status === "queued")
      .sort((a, b) => b.created_at - a.created_at);
  }, [allCommunications]);

  const dashboardMetrics = useMemo(() => {
    const today = getTodayDateString();
    const actionableQuotes = openQuotes.filter((quote) => !["declined", "converted"].includes(quote.status));
    const pendingDeposits = actionableQuotes.filter((quote) => hasPendingDeposit(quote));
    const unpaidInvoices = openInvoices.filter((invoice) => invoice.status === "sent");
    const overdueInvoices = unpaidInvoices.filter(
      (invoice) => invoice.due_date && invoice.due_date < today
    );

    return {
      openQuotes: actionableQuotes.length,
      pendingDeposits: pendingDeposits.length,
      unpaidInvoices: unpaidInvoices.length,
      overdueInvoices: overdueInvoices.length,
    };
  }, [openQuotes, openInvoices]);

  const billingHealth = useMemo(() => {
    const now = Date.now();
    const staleDraftCutoff = now - (7 * 24 * 60 * 60 * 1000);
    const queuedStaleCutoff = now - (6 * 60 * 60 * 1000);
    const today = getTodayDateString();
    const overdueThirtyDayCutoff = getDatePlusDays(today, -30);

    const failedDeliveries = allCommunications.filter((item) => item.status === "failed").length;
    const queuedStale = allCommunications.filter(
      (item) => item.status === "queued" && toFiniteNumber(item.created_at, now) <= queuedStaleCutoff
    ).length;
    const staleDrafts = allInvoices.filter(
      (invoice) => invoice.status === "draft" && toFiniteNumber(invoice.created_at, now) <= staleDraftCutoff
    ).length;
    const sentMissingPayLink = allInvoices.filter(
      (invoice) => invoice.status === "sent" && !invoice.payment_url
    ).length;
    const unpaidThirtyPlus = allInvoices.filter(
      (invoice) => invoice.status === "sent" && invoice.due_date && invoice.due_date <= overdueThirtyDayCutoff
    ).length;

    return {
      failedDeliveries,
      queuedStale,
      staleDrafts,
      sentMissingPayLink,
      unpaidThirtyPlus,
      totalIssues: failedDeliveries + queuedStale + staleDrafts + sentMissingPayLink + unpaidThirtyPlus,
    };
  }, [allCommunications, allInvoices]);

  const filteredQuotes = useMemo(() => {
    return allQuotes
      .filter((quote) => {
        if (quoteStatusFilter === "active") return quote.status !== "declined";
        if (quoteStatusFilter === "all") return true;
        return quote.status === quoteStatusFilter;
      })
      .filter((quote) => {
        const customerName = customerById.get(String(quote.customer_id))?.full_name || "";
        return matchesSearch(`${quote.title} ${quote.description || ""} ${customerName}`, quoteSearchTerm);
      })
      .sort((a, b) => b.created_at - a.created_at);
  }, [allQuotes, quoteStatusFilter, quoteSearchTerm, customerById]);

  const filteredOpenInvoices = useMemo(() => {
    const allowDraft = ["all", "open", "draft"].includes(invoiceStatusFilter);
    const allowSent = ["all", "open", "sent"].includes(invoiceStatusFilter);
    return openInvoices.filter((invoice) => {
      const statusAllowed = (invoice.status === "draft" && allowDraft) || (invoice.status === "sent" && allowSent);
      if (!statusAllowed) return false;
      const customerName = customerById.get(String(invoice.customer_id))?.full_name || "";
      const lineSummary = Array.isArray(invoice.line_items)
        ? invoice.line_items.map((item) => item?.description || "").join(" ")
        : "";
      return matchesSearch(`${customerName} ${lineSummary} ${invoice.notes || ""}`, invoiceSearchTerm);
    });
  }, [openInvoices, invoiceStatusFilter, invoiceSearchTerm, customerById]);

  const filteredPaidInvoices = useMemo(() => {
    if (!["all", "paid"].includes(invoiceStatusFilter)) return [];
    return paidInvoices.filter((invoice) => {
      const customerName = customerById.get(String(invoice.customer_id))?.full_name || "";
      const lineSummary = Array.isArray(invoice.line_items)
        ? invoice.line_items.map((item) => item?.description || "").join(" ")
        : "";
      return matchesSearch(`${customerName} ${lineSummary} ${invoice.notes || ""}`, invoiceSearchTerm);
    });
  }, [paidInvoices, invoiceStatusFilter, invoiceSearchTerm, customerById]);

  const failedCommunications = useMemo(() => {
    return allCommunications
      .filter((item) => item.status === "failed")
      .sort((a, b) => (b.last_attempt_at || b.updated_at || b.created_at) - (a.last_attempt_at || a.updated_at || a.created_at));
  }, [allCommunications]);

  const monthCloseSummary = useMemo(() => {
    const targetMonth = monthCloseMonth || getMonthStringFromDate(getTodayDateString());
    const createdInMonth = allInvoices.filter(
      (invoice) => getMonthFromTimestamp(invoice.created_at) === targetMonth
    );
    const paidInMonth = allInvoices.filter(
      (invoice) => getMonthFromTimestamp(invoice.paid_at) === targetMonth
    );

    const billedTotal = roundCurrency(createdInMonth.reduce((sum, invoice) => sum + toFiniteNumber(invoice.total, 0), 0));
    const collectedTotal = roundCurrency(paidInMonth.reduce((sum, invoice) => sum + toFiniteNumber(invoice.total, 0), 0));
    const outstandingTotal = roundCurrency(
      createdInMonth
        .filter((invoice) => invoice.status !== "paid" && invoice.status !== "cancelled")
        .reduce((sum, invoice) => sum + toFiniteNumber(invoice.total, 0), 0)
    );
    const sentCount = createdInMonth.filter((invoice) => invoice.status === "sent").length;
    const paidCount = createdInMonth.filter((invoice) => invoice.status === "paid").length;
    const draftCount = createdInMonth.filter((invoice) => invoice.status === "draft").length;

    return {
      month: targetMonth,
      label: toMonthLabel(targetMonth),
      createdInMonth,
      paidInMonth,
      billedTotal,
      collectedTotal,
      outstandingTotal,
      sentCount,
      paidCount,
      draftCount,
    };
  }, [allInvoices, monthCloseMonth]);

  const invoiceFormErrors = useMemo(() => {
    const errors = {
      customer: "",
      description: "",
      quantity: "",
      unitPrice: "",
      dueDate: "",
    };

    const quantity = Number(invoiceForm.quantity);
    const unitPrice = Number(invoiceForm.unit_price);
    if (!invoiceForm.customer_id) errors.customer = "Select a customer.";
    if (!invoiceForm.description.trim()) errors.description = "Add a description.";
    if (!Number.isFinite(quantity) || quantity <= 0) errors.quantity = "Qty must be greater than 0.";
    if (!Number.isFinite(unitPrice) || unitPrice < 0) errors.unitPrice = "Unit price must be 0 or greater.";
    if (!invoiceForm.due_date) errors.dueDate = "Select a due date.";

    return errors;
  }, [invoiceForm]);

  const quoteFormErrors = useMemo(() => {
    const errors = {
      customer: "",
      title: "",
      quantity: "",
      unitPrice: "",
      deposit: "",
    };
    const quantity = Number(quoteForm.quantity);
    const unitPrice = Number(quoteForm.unit_price);
    const depositRequired = quoteForm.deposit_required === "" ? undefined : Number(quoteForm.deposit_required);

    if (!quoteForm.customer_id) errors.customer = "Select a customer.";
    if (!quoteForm.title.trim()) errors.title = "Add a quote title.";
    if (!Number.isFinite(quantity) || quantity <= 0) errors.quantity = "Qty must be greater than 0.";
    if (!Number.isFinite(unitPrice) || unitPrice < 0) errors.unitPrice = "Unit price must be 0 or greater.";
    if (depositRequired !== undefined && (!Number.isFinite(depositRequired) || depositRequired < 0)) {
      errors.deposit = "Deposit must be blank or 0 or greater.";
    }
    return errors;
  }, [quoteForm]);

  const batchInvoiceErrors = useMemo(() => {
    const errors = {
      dateRange: "",
      unitPrice: "",
      dueDays: "",
    };
    if (!batchInvoiceForm.from_date || !batchInvoiceForm.to_date) {
      errors.dateRange = "Select both from/to dates.";
    } else if (batchInvoiceForm.from_date > batchInvoiceForm.to_date) {
      errors.dateRange = "From date must be on or before To date.";
    }

    const unitPrice = Number(batchInvoiceForm.unit_price);
    const dueDays = Number(batchInvoiceForm.due_in_days);

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      errors.unitPrice = "Unit price must be 0 or greater.";
    }
    if (!Number.isFinite(dueDays) || dueDays < 0 || dueDays > 60) {
      errors.dueDays = "Due in days must be between 0 and 60.";
    }
    return errors;
  }, [batchInvoiceForm]);

  const queueLocalCommunication = (payload) => {
    setLocalCommunications((prev) => [
      {
        _id: makeLocalId("comm"),
        status: "queued",
        attempts: 0,
        provider: undefined,
        provider_message_id: undefined,
        sent_at: undefined,
        delivered_at: undefined,
        last_attempt_at: undefined,
        error: undefined,
        created_at: Date.now(),
        updated_at: Date.now(),
        ...payload,
      },
      ...prev,
    ]);
  };

  const handleFixCustomerContact = (customerId) => {
    if (!customerId) return;
    navigate(`${createPageUrl("EditClient")}?id=${customerId}`);
  };

  const makeAlternateRecipientKey = (kind, id) => `${kind}:${String(id)}`;

  const openAlternateRecipientEditor = (kind, entityId, customer) => {
    const email = isValidEmailForSend(customer?.email) ? customer.email.trim() : "";
    const phone = isValidPhoneForSend(customer?.phone) ? customer.phone.trim() : "";
    const channel = email ? "email" : phone ? "sms" : "email";
    const recipient = channel === "email" ? email : phone;

    setAlternateRecipientEditor({
      key: makeAlternateRecipientKey(kind, entityId),
      channel,
      recipient,
    });
  };

  const closeAlternateRecipientEditor = () => {
    setAlternateRecipientEditor({ key: null, channel: "email", recipient: "" });
  };

  const handleDownloadQuotePdf = (quote) => {
    if (!quote) return;
    const customer = customerById.get(String(quote.customer_id));
    const opened = downloadQuotePdf({
      quote,
      customer,
      businessName: currentBusiness?.name || "ChemCheck Pool Service",
    });
    if (!opened) {
      toast.error("Popup blocked. Allow popups to open quote PDF.");
    }
  };

  const handleDownloadInvoicePdf = (invoice) => {
    if (!invoice) return;
    const customer = customerById.get(String(invoice.customer_id));
    const opened = downloadInvoicePdf({
      invoice,
      customer,
      businessName: currentBusiness?.name || "ChemCheck Pool Service",
    });
    if (!opened) {
      toast.error("Popup blocked. Allow popups to open invoice PDF.");
    }
  };

  const handleDeliverQueued = async (limit) => {
    if (!cloudEnabled) {
      toast.message("Local mode simulates sends. Enable cloud mode for live delivery.");
      return null;
    }

    setIsDeliveringCommunications(true);
    try {
      const result = await deliverQueuedCommunications({
        limit: Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 25,
      });
      if (result?.processed > 0) {
        toast.success(`Processed ${result.processed} queued messages (${result.sent || 0} sent, ${result.failed || 0} failed).`);
      } else {
        toast.message("No queued messages were ready to send.");
      }
      return result;
    } catch (error) {
      toast.error(error?.message || "Failed to send queued communications.");
      return null;
    } finally {
      setIsDeliveringCommunications(false);
    }
  };

  const buildDraftPayloadFromWorkOrder = (order, defaults) => {
    const linkedQuote = quoteByWorkOrderId.get(String(order._id))
      || (order.source_quote_id ? quoteById.get(String(order.source_quote_id)) : undefined);

    const defaultUnitPrice = toFiniteNumber(defaults?.unitPrice, 120);
    const defaultTaxRate = normalizeTaxRateInput(toFiniteNumber(defaults?.taxRate, 0));
    const dueInDays = Math.max(0, Math.floor(toFiniteNumber(defaults?.dueInDays, 7)));
    const forceBatchPricing = Boolean(defaults?.forceBatchPricing);

    const lineItemsFromQuote = Array.isArray(linkedQuote?.line_items)
      && linkedQuote.line_items.length > 0
      ? linkedQuote.line_items.map((item) => ({
          description: item.description || order.title,
          quantity: toFiniteNumber(item.quantity, 1),
          unit_price: toFiniteNumber(item.unit_price, 0),
          amount: toFiniteNumber(item.amount, roundCurrency(toFiniteNumber(item.quantity, 1) * toFiniteNumber(item.unit_price, 0))),
        }))
      : null;

    const defaultLineItems = [
      {
        description: order.title,
        quantity: 1,
        unit_price: defaultUnitPrice,
        amount: roundCurrency(defaultUnitPrice),
      },
    ];

    const draftLineItems = forceBatchPricing ? defaultLineItems : (lineItemsFromQuote || defaultLineItems);

    return {
      customer_id: order.customer_id,
      work_order_id: order._id,
      source_quote_id: linkedQuote?._id || order.source_quote_id || undefined,
      line_items: draftLineItems,
      tax_rate: forceBatchPricing
        ? defaultTaxRate
        : linkedQuote?.subtotal > 0
          ? (toFiniteNumber(linkedQuote.tax, 0) / toFiniteNumber(linkedQuote.subtotal, 1))
          : defaultTaxRate,
      due_date: forceBatchPricing
        ? getDatePlusDays(order.scheduled_date || selectedDate, dueInDays)
        : (linkedQuote?.valid_until || getDatePlusDays(order.scheduled_date || selectedDate, dueInDays)),
      notes: resolveInvoiceNotes(linkedQuote?.description || order.description, draftLineItems, order.title),
      linked_quote: linkedQuote,
    };
  };

  const handleUseQuoteTemplate = (quote) => {
    if (!quote) return;
    const firstLine = Array.isArray(quote.line_items) && quote.line_items.length > 0
      ? quote.line_items[0]
      : undefined;
    setQuoteForm((prev) => ({
      ...prev,
      customer_id: String(quote.customer_id || ""),
      title: quote.title || "",
      description: quote.description || firstLine?.description || "",
      quantity: String(toFiniteNumber(firstLine?.quantity, 1)),
      unit_price: String(toFiniteNumber(firstLine?.unit_price, 0)),
      tax_rate: formatTaxRateForInput(quote.subtotal, quote.tax),
      deposit_required: quote.deposit_required !== undefined ? String(toFiniteNumber(quote.deposit_required, 0)) : "",
      valid_until: quote.valid_until || prev.valid_until,
    }));
    toast.success("Quote loaded as template.");
  };

  const handleDuplicateQuote = async (quote) => {
    if (!quote) return;
    setQuoteActionId(quote._id);
    try {
      const clonedLineItems = Array.isArray(quote.line_items)
        ? quote.line_items.map((item) => ({
            description: item.description || quote.title || "Service",
            quantity: toFiniteNumber(item.quantity, 1),
            unit_price: toFiniteNumber(item.unit_price, 0),
            amount: toFiniteNumber(item.amount, roundCurrency(toFiniteNumber(item.quantity, 1) * toFiniteNumber(item.unit_price, 0))),
          }))
        : [];
      const taxRate = quote.subtotal > 0 ? (toFiniteNumber(quote.tax, 0) / toFiniteNumber(quote.subtotal, 1)) : 0;

      if (cloudEnabled) {
        await createQuote({
          customer_id: quote.customer_id,
          title: `Copy - ${quote.title || "Quote"}`,
          description: quote.description || undefined,
          line_items: clonedLineItems,
          tax_rate: taxRate,
          deposit_required: quote.deposit_required,
          valid_until: quote.valid_until || undefined,
        });
      } else {
        const now = Date.now();
        const subtotal = roundCurrency(clonedLineItems.reduce((sum, item) => sum + toFiniteNumber(item.amount, 0), 0));
        const tax = roundCurrency(subtotal * normalizeTaxRateInput(taxRate));
        const total = roundCurrency(subtotal + tax);
        const localQuote = {
          _id: makeLocalId("quo"),
          customer_id: quote.customer_id,
          title: `Copy - ${quote.title || "Quote"}`,
          description: quote.description || undefined,
          status: "draft",
          line_items: clonedLineItems,
          subtotal,
          tax,
          total,
          deposit_required: quote.deposit_required,
          deposit_status: quote.deposit_required && quote.deposit_required > 0 ? "pending" : "not_required",
          deposit_payment_url: undefined,
          deposit_checkout_session_id: undefined,
          deposit_paid_at: undefined,
          deposit_paid_source: undefined,
          valid_until: quote.valid_until || undefined,
          converted_work_order_id: undefined,
          created_at: now,
          updated_at: now,
        };
        setLocalQuotes((prev) => [localQuote, ...prev]);
      }

      toast.success("Quote duplicated.");
    } catch (error) {
      toast.error(error?.message || "Failed to duplicate quote.");
    } finally {
      setQuoteActionId(null);
    }
  };

  const handleUseInvoiceTemplate = (invoice) => {
    if (!invoice) return;
    const firstLine = Array.isArray(invoice.line_items) && invoice.line_items.length > 0
      ? invoice.line_items[0]
      : undefined;
    setInvoiceForm((prev) => ({
      ...prev,
      customer_id: String(invoice.customer_id || ""),
      work_order_id: "",
      description: firstLine?.description || invoice.notes || "",
      quantity: String(toFiniteNumber(firstLine?.quantity, 1)),
      unit_price: String(toFiniteNumber(firstLine?.unit_price, 0)),
      tax_rate: formatTaxRateForInput(invoice.subtotal, invoice.tax),
      due_date: invoice.due_date || prev.due_date,
    }));
    toast.success("Invoice loaded as template.");
  };

  const handleDuplicateInvoice = async (invoice) => {
    if (!invoice) return;
    setInvoiceActionId(invoice._id);
    try {
      const clonedLineItems = Array.isArray(invoice.line_items)
        ? invoice.line_items.map((item) => ({
            description: item.description || "Service",
            quantity: toFiniteNumber(item.quantity, 1),
            unit_price: toFiniteNumber(item.unit_price, 0),
            amount: toFiniteNumber(item.amount, roundCurrency(toFiniteNumber(item.quantity, 1) * toFiniteNumber(item.unit_price, 0))),
          }))
        : [];
      const taxRate = invoice.subtotal > 0 ? (toFiniteNumber(invoice.tax, 0) / toFiniteNumber(invoice.subtotal, 1)) : 0;
      const duplicateNotes = resolveInvoiceNotes(invoice.notes, clonedLineItems);

      if (cloudEnabled) {
        await createInvoiceDraft({
          customer_id: invoice.customer_id,
          line_items: clonedLineItems,
          tax_rate: taxRate,
          due_date: invoice.due_date || getDatePlusDays(selectedDate, 7),
          notes: duplicateNotes,
        });
      } else {
        const now = Date.now();
        const totals = calculateDraftTotals({
          lineItems: clonedLineItems,
          taxRate,
          quote: undefined,
        });
        const localInvoice = {
          _id: makeLocalId("inv"),
          customer_id: invoice.customer_id,
          work_order_id: undefined,
          source_quote_id: undefined,
          status: totals.total <= 0 ? "paid" : "draft",
          line_items: clonedLineItems,
          subtotal: totals.subtotal,
          tax: totals.tax,
          total: totals.total,
          due_date: invoice.due_date || getDatePlusDays(selectedDate, 7),
          notes: duplicateNotes,
          paid_at: totals.total <= 0 ? now : undefined,
          sent_at: undefined,
          payment_url: undefined,
          stripe_checkout_session_id: undefined,
          stripe_payment_intent_id: undefined,
          created_at: now,
          updated_at: now,
        };
        setLocalInvoices((prev) => [localInvoice, ...prev]);
      }
      toast.success("Invoice duplicated as draft.");
    } catch (error) {
      toast.error(error?.message || "Failed to duplicate invoice.");
    } finally {
      setInvoiceActionId(null);
    }
  };

  const handleBatchCreateInvoices = async () => {
    if (batchInvoiceErrors.dateRange || batchInvoiceErrors.unitPrice || batchInvoiceErrors.dueDays) {
      toast.error(batchInvoiceErrors.dateRange || batchInvoiceErrors.unitPrice || batchInvoiceErrors.dueDays);
      return;
    }

    const fromDate = batchInvoiceForm.from_date;
    const toDate = batchInvoiceForm.to_date;
    const unitPrice = toFiniteNumber(batchInvoiceForm.unit_price, 120);
    const taxRate = normalizeTaxRateInput(toFiniteNumber(batchInvoiceForm.tax_rate, 0));
    const dueInDays = Math.max(0, Math.floor(toFiniteNumber(batchInvoiceForm.due_in_days, 7)));
    const autoSend = Boolean(batchInvoiceForm.auto_send);

    setIsBatchInvoicing(true);
    try {
      const summary = {
        created: 0,
        sent: 0,
        skippedExisting: 0,
        skippedDeposit: 0,
        failed: 0,
      };

      const localInvoicesToAdd = [];
      const localCommunicationsToAdd = [];
      const baseUrl = typeof window !== "undefined" ? window.location.origin : undefined;

      if (cloudEnabled) {
        const batchResult = await batchCreateFromCompletedWorkOrders({
          from_date: fromDate,
          to_date: toDate,
          unit_price: unitPrice,
          tax_rate: taxRate,
          due_in_days: dueInDays,
          limit: 100,
        });

        const processed = toFiniteNumber(batchResult?.processed, 0);
        summary.created += toFiniteNumber(batchResult?.created, 0);
        summary.skippedExisting += toFiniteNumber(batchResult?.skipped_existing, 0);
        summary.skippedDeposit += toFiniteNumber(batchResult?.skipped_deposit, 0);
        summary.failed += toFiniteNumber(batchResult?.failed, 0);

        if (processed === 0) {
          toast.message("No completed work orders found in this date range.");
          return;
        }

        if (autoSend && Array.isArray(batchResult?.created_invoice_ids)) {
          for (const invoiceId of batchResult.created_invoice_ids) {
            try {
              const sendResult = await sendInvoiceWithStripe({
                id: invoiceId,
                base_url: baseUrl,
              });
              const hadSendableResult = Boolean(sendResult?.payment_url || sendResult?.communication_id);
              if (!hadSendableResult) continue;

              if (sendResult?.communication_id) {
                const delivery = await deliverCommunication({ id: sendResult.communication_id });
                if (!delivery?.success) {
                  summary.failed += 1;
                  continue;
                }
              }
              summary.sent += 1;
            } catch {
              summary.failed += 1;
            }
          }
        }
      } else {
        const candidates = allWorkOrders
          .filter((order) =>
            order.status === "completed"
            && order.scheduled_date >= fromDate
            && order.scheduled_date <= toDate
          )
          .slice(0, 100);

        if (candidates.length === 0) {
          toast.message("No completed work orders found in this date range.");
          return;
        }

        const seenWorkOrderIds = new Set(Array.from(invoicedWorkOrderIds));
        const seenQuoteIds = new Set(Array.from(invoicedQuoteIds));

        for (const order of candidates) {
          const linkedQuote = quoteByWorkOrderId.get(String(order._id))
            || (order.source_quote_id ? quoteById.get(String(order.source_quote_id)) : undefined);

          const existingByWorkOrder = invoiceByWorkOrderId.has(String(order._id)) || seenWorkOrderIds.has(String(order._id));
          const existingByQuote = Boolean(
            (order.source_quote_id && (invoiceByQuoteId.has(String(order.source_quote_id)) || seenQuoteIds.has(String(order.source_quote_id))))
            || (linkedQuote?._id && (invoiceByQuoteId.has(String(linkedQuote._id)) || seenQuoteIds.has(String(linkedQuote._id))))
          );
          if (existingByWorkOrder || existingByQuote) {
            summary.skippedExisting += 1;
            continue;
          }
          if (linkedQuote && hasPendingDeposit(linkedQuote)) {
            summary.skippedDeposit += 1;
            continue;
          }

          const payload = buildDraftPayloadFromWorkOrder(order, {
            unitPrice,
            taxRate,
            dueInDays,
            forceBatchPricing: true,
          });
          const totals = calculateDraftTotals({
            lineItems: payload.line_items,
            taxRate: payload.tax_rate,
            quote: payload.linked_quote,
          });

          try {
            const now = Date.now();
            const simulatedPaymentUrl = `https://pay.chemcheck.app/invoice/${makeLocalId("invpay")}`;
            const localInvoice = {
              _id: makeLocalId("inv"),
              customer_id: payload.customer_id,
              work_order_id: payload.work_order_id,
              source_quote_id: payload.source_quote_id,
              status: totals.total <= 0 ? "paid" : autoSend ? "sent" : "draft",
              line_items: payload.line_items,
              subtotal: totals.subtotal,
              tax: totals.tax,
              deposit_applied: totals.depositApplied > 0 ? totals.depositApplied : undefined,
              total: totals.total,
              due_date: payload.due_date,
              notes: payload.notes,
              sent_at: autoSend && totals.total > 0 ? now : undefined,
              paid_at: totals.total <= 0 ? now : undefined,
              payment_url: autoSend && totals.total > 0 ? simulatedPaymentUrl : undefined,
              created_at: now,
              updated_at: now,
            };
            localInvoicesToAdd.push(localInvoice);
            seenWorkOrderIds.add(String(payload.work_order_id));
            if (payload.source_quote_id) {
              seenQuoteIds.add(String(payload.source_quote_id));
            }
            summary.created += 1;

            if (autoSend && totals.total > 0) {
              const customer = customerById.get(String(payload.customer_id));
              const destination = resolvePreferredSendDestination(customer);
              if (destination) {
                localCommunicationsToAdd.push({
                  type: "reminder",
                  channel: destination.channel,
                  recipient: destination.recipient,
                  customer_id: payload.customer_id,
                  work_order_id: payload.work_order_id,
                  invoice_id: localInvoice._id,
                  quote_id: payload.source_quote_id,
                  template_key: "invoice_sent",
                  message: `Invoice for $${totals.total.toFixed(2)} is ready. Pay here: ${simulatedPaymentUrl}`,
                });
                summary.sent += 1;
              }
            }
          } catch (error) {
            console.error("[BatchInvoice] Failed for work order", order._id, error);
            summary.failed += 1;
          }
        }

        if (localInvoicesToAdd.length > 0) {
          setLocalInvoices((prev) => [...localInvoicesToAdd, ...prev]);
        }
        if (localCommunicationsToAdd.length > 0) {
          for (const message of localCommunicationsToAdd) {
            queueLocalCommunication(message);
          }
        }
      }

      toast.success(
        `Batch complete: ${summary.created} drafted, ${summary.sent} sent, ${summary.skippedExisting} skipped (already invoiced), ${summary.skippedDeposit} skipped (deposit required).`
      );
      if (summary.failed > 0) {
        toast.warning(`${summary.failed} item${summary.failed === 1 ? "" : "s"} failed. Check communications/errors.`);
      }
    } catch (error) {
      toast.error(error?.message || "Failed to run batch invoice flow.");
    } finally {
      setIsBatchInvoicing(false);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!form.customer_id || !form.title.trim()) {
      toast.error("Choose a customer and enter a work-order title.");
      return;
    }

    setIsCreating(true);
    try {
      if (cloudEnabled) {
        const selectedCloudCustomer = customerById.get(String(form.customer_id));
        if (!selectedCloudCustomer) {
          throw new Error("Select a valid customer before creating a work order.");
        }

        await createWorkOrder({
          customer_id: selectedCloudCustomer._id,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          assignee_email: form.assignee_email || undefined,
          scheduled_date: selectedDate,
          is_recurring: form.is_recurring,
          recurrence_rule: form.is_recurring ? (form.recurrence_rule || "WEEKLY") : undefined,
          priority: form.priority,
        });
      } else {
        const now = Date.now();
        const localOrder = {
          _id: makeLocalId("wo"),
          customer_id: form.customer_id,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          status: "scheduled",
          assignee_email: form.assignee_email || undefined,
          scheduled_date: selectedDate,
          is_recurring: form.is_recurring,
          recurrence_rule: form.is_recurring ? (form.recurrence_rule || "WEEKLY") : undefined,
          priority: form.priority,
          created_at: now,
          updated_at: now,
        };
        setLocalWorkOrders((prev) => [...prev, localOrder]);
      }

      setForm((prev) => ({
        ...prev,
        title: "",
        description: "",
      }));
      toast.success("Work order created.");
    } catch (error) {
      toast.error(error?.message || "Failed to create work order.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      if (cloudEnabled) {
        await updateWorkOrder({ id, status });
      } else {
        setLocalWorkOrders((prev) =>
          prev.map((item) =>
            String(item._id) === String(id)
              ? {
                  ...item,
                  status,
                  completed_at: status === "completed" ? Date.now() : item.completed_at,
                  updated_at: Date.now(),
                }
              : item
          )
        );
      }
      toast.success("Status updated.");
    } catch (error) {
      toast.error(error?.message || "Failed to update status.");
    }
  };

  const handleAssigneeChange = async (id, assignee_email) => {
    try {
      if (cloudEnabled) {
        await updateWorkOrder({ id, assignee_email: assignee_email || undefined });
      } else {
        setLocalWorkOrders((prev) =>
          prev.map((item) =>
            String(item._id) === String(id)
              ? { ...item, assignee_email: assignee_email || undefined, updated_at: Date.now() }
              : item
          )
        );
      }
      toast.success("Assignee updated.");
    } catch (error) {
      toast.error(error?.message || "Failed to update assignee.");
    }
  };

  const handleComplete = async (id) => {
    try {
      if (cloudEnabled) {
        const result = await completeWorkOrder({ id });
        if (result?.invoice_blocked_reason === "deposit_pending") {
          toast.success("Marked complete. Deposit is still required before invoicing.");
        } else {
          toast.success(result?.invoice_id ? "Marked complete and drafted invoice." : "Marked complete.");
        }
      } else {
        const order = localWorkOrders.find((item) => String(item._id) === String(id));
        if (!order) throw new Error("Work order not found");

        setLocalWorkOrders((prev) =>
          prev.map((item) =>
            String(item._id) === String(id)
              ? { ...item, status: "completed", completed_at: Date.now(), updated_at: Date.now() }
              : item
          )
        );

        const customer = customerById.get(String(order.customer_id));
        const recipient = customer?.phone || customer?.email;
        const channel = customer?.phone ? "sms" : customer?.email ? "email" : undefined;
        if (recipient && channel) {
          queueLocalCommunication({
            type: "service_text",
            channel,
            recipient,
            customer_id: order.customer_id,
            work_order_id: order._id,
            template_key: "work_order_completed",
            message: `${order.title} completed on ${order.scheduled_date}.`,
          });
        }

        const alreadyInvoiced = localInvoices.some((invoice) => String(invoice.work_order_id) === String(id));
        const linkedQuote = order.source_quote_id ? quoteById.get(String(order.source_quote_id)) : undefined;
        const invoiceBlockedByDeposit = Boolean(linkedQuote && hasPendingDeposit(linkedQuote));
        if (!alreadyInvoiced && !invoiceBlockedByDeposit) {
          const amount = 120;
          const completedLineItems = [{ description: order.title, quantity: 1, unit_price: amount, amount }];
          const subtotal = roundCurrency(amount);
          const tax = 0;
          const grossTotal = roundCurrency(subtotal + tax);
          const depositApplied = getDepositAppliedAmount(linkedQuote, grossTotal);
          const total = roundCurrency(grossTotal - depositApplied);
          const status = total <= 0 ? "paid" : "draft";
          const now = Date.now();
          const newInvoice = {
            _id: makeLocalId("inv"),
            customer_id: order.customer_id,
            work_order_id: order._id,
            source_quote_id: order.source_quote_id || undefined,
            status,
            line_items: completedLineItems,
            subtotal,
            tax,
            deposit_applied: depositApplied > 0 ? depositApplied : undefined,
            total,
            due_date: getDatePlusDays(order.scheduled_date || selectedDate, 7),
            notes: resolveInvoiceNotes(linkedQuote?.description || order.description, completedLineItems, order.title),
            paid_at: status === "paid" ? now : undefined,
            created_at: now,
            updated_at: now,
          };
          setLocalInvoices((prev) => [newInvoice, ...prev]);
          toast.success(status === "paid" ? "Marked complete. Deposit covered invoice in full." : "Marked complete and drafted invoice.");
        } else if (invoiceBlockedByDeposit) {
          toast.success("Marked complete. Deposit is still required before invoicing.");
        } else {
          toast.success("Marked complete.");
        }
      }
    } catch (error) {
      toast.error(error?.message || "Failed to complete work order.");
    }
  };

  const handleRemove = async (id) => {
    try {
      if (cloudEnabled) {
        await removeWorkOrder({ id });
      } else {
        setLocalWorkOrders((prev) => prev.filter((item) => String(item._id) !== String(id)));
      }
      toast.success("Work order deleted.");
    } catch (error) {
      toast.error(error?.message || "Failed to delete work order.");
    }
  };

  const handleCreateInvoiceDraft = async (event) => {
    event.preventDefault();
    const firstError = Object.values(invoiceFormErrors).find(Boolean);
    if (firstError) {
      toast.error(firstError);
      return;
    }
    if (!invoiceForm.customer_id || !invoiceForm.description.trim()) {
      toast.error("Choose a customer and enter an invoice description.");
      return;
    }

    const quantity = Number(invoiceForm.quantity);
    const unitPrice = Number(invoiceForm.unit_price);
    const rawTaxRate = Number(invoiceForm.tax_rate || "0");
    const taxRate = normalizeTaxRateInput(rawTaxRate);

    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      toast.error("Quantity must be > 0 and unit price must be 0 or greater.");
      return;
    }

    const selectedWorkOrder = invoiceForm.work_order_id
      ? workOrderById.get(String(invoiceForm.work_order_id))
      : undefined;
    const linkedQuote = selectedWorkOrder
      ? quoteByWorkOrderId.get(String(selectedWorkOrder._id))
        || (selectedWorkOrder.source_quote_id ? quoteById.get(String(selectedWorkOrder.source_quote_id)) : undefined)
      : undefined;

    if (linkedQuote && hasPendingDeposit(linkedQuote)) {
      toast.error("Deposit must be marked paid before invoicing this work order.");
      return;
    }

    const trimmedDescription = invoiceForm.description.trim();
    setIsCreatingInvoice(true);
    try {
      if (cloudEnabled) {
        const selectedCloudCustomer = customerById.get(String(invoiceForm.customer_id));
        if (!selectedCloudCustomer) {
          throw new Error("Select a valid customer before creating an invoice.");
        }

        const draftLineItems = [
          {
            description: trimmedDescription,
            quantity,
            unit_price: unitPrice,
            amount: Number((quantity * unitPrice).toFixed(2)),
          },
        ];

        await createInvoiceDraft({
          customer_id: selectedCloudCustomer._id,
          work_order_id: invoiceForm.work_order_id || undefined,
          line_items: draftLineItems,
          tax_rate: taxRate,
          due_date: invoiceForm.due_date || undefined,
          notes: resolveInvoiceNotes(trimmedDescription, draftLineItems, trimmedDescription),
        });
      } else {
        const subtotal = Number((quantity * unitPrice).toFixed(2));
        const tax = roundCurrency(subtotal * taxRate);
        const grossTotal = roundCurrency(subtotal + tax);
        const depositApplied = getDepositAppliedAmount(linkedQuote, grossTotal);
        const total = roundCurrency(grossTotal - depositApplied);
        const status = total <= 0 ? "paid" : "draft";
        const now = Date.now();
        const draftLineItems = [
          {
            description: trimmedDescription,
            quantity,
            unit_price: unitPrice,
            amount: subtotal,
          },
        ];

        const localInvoice = {
          _id: makeLocalId("inv"),
          customer_id: invoiceForm.customer_id,
          work_order_id: invoiceForm.work_order_id || undefined,
          source_quote_id: selectedWorkOrder?.source_quote_id || undefined,
          status,
          line_items: draftLineItems,
          subtotal,
          tax,
          deposit_applied: depositApplied > 0 ? depositApplied : undefined,
          total,
          due_date: invoiceForm.due_date || undefined,
          notes: resolveInvoiceNotes(trimmedDescription, draftLineItems, trimmedDescription),
          paid_at: status === "paid" ? now : undefined,
          created_at: now,
          updated_at: now,
        };

        setLocalInvoices((prev) => [localInvoice, ...prev]);
      }

      setInvoiceForm((prev) => ({
        ...prev,
        work_order_id: "",
        description: "",
        quantity: "1",
      }));
      toast.success("Invoice draft created.");
    } catch (error) {
      toast.error(error?.message || "Failed to create invoice draft.");
    } finally {
      setIsCreatingInvoice(false);
    }
  };

  const handleCreateQuoteDraft = async (event) => {
    event.preventDefault();
    const firstError = Object.values(quoteFormErrors).find(Boolean);
    if (firstError) {
      toast.error(firstError);
      return;
    }
    if (!quoteForm.customer_id || !quoteForm.title.trim()) {
      toast.error("Choose a customer and enter a quote title.");
      return;
    }

    const quantity = Number(quoteForm.quantity);
    const unitPrice = Number(quoteForm.unit_price);
    const rawTaxRate = Number(quoteForm.tax_rate || "0");
    const taxRate = normalizeTaxRateInput(rawTaxRate);
    const depositRequired = quoteForm.deposit_required === "" ? undefined : Number(quoteForm.deposit_required);

    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      toast.error("Quantity must be > 0 and unit price must be 0 or greater.");
      return;
    }

    if (
      depositRequired !== undefined &&
      (!Number.isFinite(depositRequired) || depositRequired < 0)
    ) {
      toast.error("Deposit required must be blank or 0 or greater.");
      return;
    }

    setIsCreatingQuote(true);
    try {
      const lineAmount = Number((quantity * unitPrice).toFixed(2));
      if (cloudEnabled) {
        const selectedCloudCustomer = customerById.get(String(quoteForm.customer_id));
        if (!selectedCloudCustomer) {
          throw new Error("Select a valid customer before creating a quote.");
        }

        await createQuote({
          customer_id: selectedCloudCustomer._id,
          title: quoteForm.title.trim(),
          description: quoteForm.description.trim() || undefined,
          line_items: [
            {
              description: quoteForm.description.trim() || quoteForm.title.trim(),
              quantity,
              unit_price: unitPrice,
              amount: lineAmount,
            },
          ],
          tax_rate: taxRate,
          deposit_required: depositRequired,
          valid_until: quoteForm.valid_until || undefined,
        });
      } else {
        const subtotal = lineAmount;
        const tax = Number((subtotal * taxRate).toFixed(2));
        const total = Number((subtotal + tax).toFixed(2));
        const now = Date.now();

        const localQuote = {
          _id: makeLocalId("quo"),
          customer_id: quoteForm.customer_id,
          title: quoteForm.title.trim(),
          description: quoteForm.description.trim() || undefined,
          status: "draft",
          line_items: [
            {
              description: quoteForm.description.trim() || quoteForm.title.trim(),
              quantity,
              unit_price: unitPrice,
              amount: lineAmount,
            },
          ],
          subtotal,
          tax,
          total,
          deposit_required: depositRequired,
          deposit_status: depositRequired && depositRequired > 0 ? "pending" : "not_required",
          deposit_payment_url: undefined,
          deposit_checkout_session_id: undefined,
          deposit_paid_at: undefined,
          deposit_paid_source: undefined,
          valid_until: quoteForm.valid_until || undefined,
          converted_work_order_id: undefined,
          created_at: now,
          updated_at: now,
        };

        setLocalQuotes((prev) => [localQuote, ...prev]);
      }

      setQuoteForm((prev) => ({
        ...prev,
        title: "",
        description: "",
        quantity: "1",
      }));
      toast.success("Quote draft created.");
    } catch (error) {
      toast.error(error?.message || "Failed to create quote draft.");
    } finally {
      setIsCreatingQuote(false);
    }
  };

  const handleQuoteStatusChange = async (quote, status) => {
    if (!quote) return;

    const nextDepositStatus =
      status === "approved" && quote.deposit_required && quote.deposit_required > 0
        ? (quote.deposit_status === "paid" ? "paid" : "pending")
        : quote.deposit_status;

    setQuoteActionId(quote._id);
    try {
      if (cloudEnabled) {
        await updateQuoteStatus({
          id: quote._id,
          status,
          deposit_status: nextDepositStatus,
        });
      } else {
        setLocalQuotes((prev) =>
          prev.map((item) =>
            String(item._id) === String(quote._id)
              ? {
                  ...item,
                  status,
                  deposit_status: nextDepositStatus,
                  deposit_paid_at: nextDepositStatus === "paid" ? (item.deposit_paid_at || Date.now()) : undefined,
                  deposit_paid_source: nextDepositStatus === "paid" ? (item.deposit_paid_source || "manual") : undefined,
                  updated_at: Date.now(),
                }
              : item
          )
        );
      }
      toast.success("Quote status updated.");
    } catch (error) {
      toast.error(error?.message || "Failed to update quote status.");
    } finally {
      setQuoteActionId(null);
    }
  };

  const handleMarkDepositPaid = async (quote) => {
    if (!quote) return;
    setQuoteActionId(quote._id);
    try {
      if (cloudEnabled) {
        await updateQuoteStatus({
          id: quote._id,
          status: quote.status,
          deposit_status: "paid",
          deposit_paid_source: "manual",
        });
      } else {
        setLocalQuotes((prev) =>
          prev.map((item) =>
            String(item._id) === String(quote._id)
              ? {
                  ...item,
                  deposit_status: "paid",
                  deposit_paid_at: item.deposit_paid_at || Date.now(),
                  deposit_paid_source: "manual",
                  updated_at: Date.now(),
                }
              : item
          )
        );
      }
      toast.success("Deposit marked as paid.");
    } catch (error) {
      toast.error(error?.message || "Failed to mark deposit as paid.");
    } finally {
      setQuoteActionId(null);
    }
  };

  const handleCreateDepositLink = async (quote, destinationOverride) => {
    if (!quote) return;
    if (!quote.deposit_required || quote.deposit_required <= 0) {
      toast.error("This quote does not require a deposit.");
      return;
    }
    if (quote.deposit_status === "paid") {
      toast.message("Deposit is already paid.");
      return;
    }
    const customer = customerById.get(String(quote.customer_id));
    const hasOverride = Boolean(destinationOverride?.channel && destinationOverride?.recipient);
    if (hasOverride && !isValidRecipientForChannel(destinationOverride.channel, destinationOverride.recipient)) {
      toast.error(destinationOverride.channel === "sms" ? "Enter a valid phone number." : "Enter a valid email address.");
      return;
    }
    if (!hasValidSendDestination(customer) && !hasOverride) {
      toast.error("Customer needs a valid phone or email before sending a deposit link.");
      return;
    }

    setQuoteActionId(quote._id);
    try {
      if (cloudEnabled) {
        const baseUrl = typeof window !== "undefined" ? window.location.origin : undefined;
        const result = await createDepositPaymentLink({
          id: quote._id,
          base_url: baseUrl,
          channel_override: hasOverride ? destinationOverride.channel : undefined,
          recipient_override: hasOverride ? destinationOverride.recipient : undefined,
        });
        if (result?.communication_id) {
          const delivery = await deliverCommunication({ id: result.communication_id });
          if (delivery?.success) {
            toast.success("Deposit payment link created and sent.");
          } else {
            toast.warning(`Deposit link created, but delivery failed: ${delivery?.error || "Unknown error"}`);
          }
        } else if (result?.payment_url) {
          toast.success("Deposit payment link created.");
        } else {
          toast.success("Deposit payment link is ready.");
        }
      } else {
        const paymentUrl = `https://pay.chemcheck.app/deposit/${quote._id}`;

        setLocalQuotes((prev) =>
          prev.map((item) =>
            String(item._id) === String(quote._id)
              ? {
                  ...item,
                  status: item.status === "draft" ? "sent" : item.status,
                  deposit_status: "pending",
                  deposit_payment_url: paymentUrl,
                  deposit_paid_at: undefined,
                  deposit_paid_source: undefined,
                  updated_at: Date.now(),
                }
              : item
          )
        );

        const customerDestination = resolvePreferredSendDestination(customer);
        const recipient = hasOverride ? destinationOverride.recipient : customerDestination?.recipient;
        const channel = hasOverride ? destinationOverride.channel : customerDestination?.channel;
        if (recipient && channel) {
          queueLocalCommunication({
            type: "reminder",
            channel,
            recipient,
            customer_id: quote.customer_id,
            work_order_id: quote.converted_work_order_id,
            quote_id: quote._id,
            template_key: "quote_deposit_requested",
            message: `Deposit request for ${quote.title}: ${paymentUrl}`,
          });
        }
        toast.success("Deposit payment link created.");
      }
      if (hasOverride) {
        closeAlternateRecipientEditor();
      }
    } catch (error) {
      toast.error(error?.message || "Failed to create deposit payment link.");
    } finally {
      setQuoteActionId(null);
    }
  };

  const handleConvertQuote = async (quote) => {
    if (!quote) return;
    if (quote.converted_work_order_id) {
      toast.message("Quote is already converted.");
      return;
    }
    if (hasPendingDeposit(quote)) {
      toast.error("Deposit must be marked paid before converting this quote.");
      return;
    }

    setQuoteActionId(quote._id);
    try {
      if (cloudEnabled) {
        await convertQuoteToWorkOrder({
          id: quote._id,
          scheduled_date: selectedDate,
          priority: "medium",
        });
      } else {
        const now = Date.now();
        const workOrderId = makeLocalId("wo");
        const localOrder = {
          _id: workOrderId,
          customer_id: quote.customer_id,
          title: quote.title,
          description: quote.description || undefined,
          status: "scheduled",
          assignee_email: undefined,
          scheduled_date: selectedDate,
          is_recurring: false,
          recurrence_rule: undefined,
          source_quote_id: quote._id,
          priority: "medium",
          created_at: now,
          updated_at: now,
        };

        setLocalWorkOrders((prev) => [...prev, localOrder]);
        setLocalQuotes((prev) =>
          prev.map((item) =>
            String(item._id) === String(quote._id)
              ? {
                  ...item,
                  status: "converted",
                  converted_work_order_id: workOrderId,
                  updated_at: now,
                }
              : item
          )
        );
      }
      toast.success("Quote converted to work order.");
    } catch (error) {
      toast.error(error?.message || "Failed to convert quote.");
    } finally {
      setQuoteActionId(null);
    }
  };

  const handleCreateInvoiceFromQuote = async (quote) => {
    if (!quote) return;
    if (invoicedQuoteIds.has(String(quote._id))) {
      toast.error("An invoice already exists for this quote.");
      return;
    }
    if (hasPendingDeposit(quote)) {
      toast.error("Deposit must be marked paid before creating an invoice from this quote.");
      return;
    }

    setQuoteActionId(quote._id);
    try {
      const quoteInvoiceNotes = resolveInvoiceNotes(quote.description, quote.line_items, quote.title);
      if (cloudEnabled) {
        await createInvoiceDraft({
          customer_id: quote.customer_id,
          work_order_id: quote.converted_work_order_id || undefined,
          source_quote_id: quote._id,
          line_items: quote.line_items,
          tax_rate: quote.subtotal > 0 ? quote.tax / quote.subtotal : 0,
          due_date: quote.valid_until || getDatePlusDays(selectedDate, 7),
          notes: quoteInvoiceNotes,
        });
      } else {
        const now = Date.now();
        const grossTotal = roundCurrency((quote.subtotal || 0) + (quote.tax || 0));
        const depositApplied = getDepositAppliedAmount(quote, grossTotal);
        const total = roundCurrency(grossTotal - depositApplied);
        const status = total <= 0 ? "paid" : "draft";
        const localInvoice = {
          _id: makeLocalId("inv"),
          customer_id: quote.customer_id,
          work_order_id: quote.converted_work_order_id || undefined,
          source_quote_id: quote._id,
          status,
          line_items: quote.line_items,
          subtotal: quote.subtotal,
          tax: quote.tax,
          deposit_applied: depositApplied > 0 ? depositApplied : undefined,
          total,
          due_date: quote.valid_until || getDatePlusDays(selectedDate, 7),
          notes: quoteInvoiceNotes,
          paid_at: status === "paid" ? now : undefined,
          created_at: now,
          updated_at: now,
        };
        setLocalInvoices((prev) => [localInvoice, ...prev]);
      }
      toast.success("Invoice draft created from quote.");
    } catch (error) {
      toast.error(error?.message || "Failed to create invoice from quote.");
    } finally {
      setQuoteActionId(null);
    }
  };

  const handleQuickInvoiceFromWorkOrder = async (order) => {
    const linkedQuote = order.source_quote_id ? quoteById.get(String(order.source_quote_id)) : undefined;
    if (linkedQuote && hasPendingDeposit(linkedQuote)) {
      toast.error("Deposit must be marked paid before invoicing this work order.");
      return;
    }

    if (
      invoicedWorkOrderIds.has(String(order._id)) ||
      (order.source_quote_id && invoiceByQuoteId.has(String(order.source_quote_id)))
    ) {
      toast.error("An invoice already exists for this work order.");
      return;
    }

    try {
      const quickLineItems = [
        {
          description: order.title,
          quantity: 1,
          unit_price: 120,
          amount: 120,
        },
      ];
      const quickInvoiceNotes = resolveInvoiceNotes(order.description, quickLineItems, order.title);
      if (cloudEnabled) {
        await createInvoiceDraft({
          customer_id: order.customer_id,
          work_order_id: order._id,
          source_quote_id: order.source_quote_id || undefined,
          line_items: quickLineItems,
          tax_rate: 0,
          due_date: getDatePlusDays(order.scheduled_date || selectedDate, 7),
          notes: quickInvoiceNotes,
        });
      } else {
        const subtotal = 120;
        const tax = 0;
        const grossTotal = roundCurrency(subtotal + tax);
        const depositApplied = getDepositAppliedAmount(linkedQuote, grossTotal);
        const total = roundCurrency(grossTotal - depositApplied);
        const status = total <= 0 ? "paid" : "draft";
        const now = Date.now();
        const localInvoice = {
          _id: makeLocalId("inv"),
          customer_id: order.customer_id,
          work_order_id: order._id,
          source_quote_id: order.source_quote_id || undefined,
          status,
          line_items: quickLineItems,
          subtotal,
          tax,
          deposit_applied: depositApplied > 0 ? depositApplied : undefined,
          total,
          due_date: getDatePlusDays(order.scheduled_date || selectedDate, 7),
          notes: quickInvoiceNotes,
          paid_at: status === "paid" ? now : undefined,
          created_at: now,
          updated_at: now,
        };
        setLocalInvoices((prev) => [localInvoice, ...prev]);
      }
      toast.success("Invoice draft created from work order.");
    } catch (error) {
      toast.error(error?.message || "Failed to draft invoice.");
    }
  };

  const handleInvoiceWorkOrderSelect = (value) => {
    if (!value) {
      setInvoiceForm((prev) => ({ ...prev, work_order_id: "" }));
      return;
    }
    const order = workOrderById.get(String(value));
    if (!order) {
      setInvoiceForm((prev) => ({ ...prev, work_order_id: value }));
      return;
    }
    setInvoiceForm((prev) => ({
      ...prev,
      work_order_id: value,
      customer_id: String(order.customer_id),
      description: order.title,
    }));
  };

  const handleInvoiceCustomerSelect = (value) => {
    setInvoiceForm((prev) => {
      const next = { ...prev, customer_id: value };
      if (!prev.work_order_id) return next;

      const selectedOrder = workOrderById.get(String(prev.work_order_id));
      if (!selectedOrder || String(selectedOrder.customer_id) !== String(value)) {
        next.work_order_id = "";
      }

      return next;
    });
  };

  const handleSendInvoice = async (invoiceId, destinationOverride) => {
    setInvoiceActionId(invoiceId);
    try {
      const invoice = allInvoices.find((item) => String(item._id) === String(invoiceId));
      if (!invoice) {
        throw new Error("Invoice not found.");
      }
      if (!["draft", "sent"].includes(invoice.status)) {
        throw new Error("Only draft or sent invoices can be sent.");
      }
      const customer = invoice ? customerById.get(String(invoice.customer_id)) : undefined;
      const hasOverride = Boolean(destinationOverride?.channel && destinationOverride?.recipient);
      if (hasOverride && !isValidRecipientForChannel(destinationOverride.channel, destinationOverride.recipient)) {
        throw new Error(destinationOverride.channel === "sms" ? "Enter a valid phone number." : "Enter a valid email address.");
      }
      if (!hasValidSendDestination(customer) && !hasOverride) {
        throw new Error("Customer needs a valid phone or email before sending this invoice.");
      }

      if (cloudEnabled) {
        const baseUrl = typeof window !== "undefined" ? window.location.origin : undefined;
        const result = await sendInvoiceWithStripe({
          id: invoiceId,
          base_url: baseUrl,
          channel_override: hasOverride ? destinationOverride.channel : undefined,
          recipient_override: hasOverride ? destinationOverride.recipient : undefined,
        });
        if (result?.communication_id) {
          const delivery = await deliverCommunication({ id: result.communication_id });
          if (delivery?.success) {
            toast.success(result?.payment_url ? "Invoice sent with payment link." : "Invoice sent.");
          } else {
            toast.warning(`Invoice queued but delivery failed: ${delivery?.error || "Unknown error"}`);
          }
        } else {
          toast.success(result?.payment_url ? "Invoice marked as sent with payment link." : "Invoice is already paid in full.");
        }
      } else {
        const paymentUrl = `https://pay.chemcheck.app/invoice/${invoiceId}`;
        if (invoice && invoice.total <= 0) {
          setLocalInvoices((prev) =>
            prev.map((item) =>
              String(item._id) === String(invoiceId)
                ? {
                    ...item,
                    status: "paid",
                    paid_at: item.paid_at || Date.now(),
                    updated_at: Date.now(),
                  }
                : item
            )
          );
          toast.success("Invoice is already paid in full.");
          return;
        }
        setLocalInvoices((prev) =>
          prev.map((invoice) =>
            String(invoice._id) === String(invoiceId)
              ? {
                  ...invoice,
                  status: "sent",
                  sent_at: Date.now(),
                  payment_url: paymentUrl,
                  updated_at: Date.now(),
                }
              : invoice
          )
        );
        if (invoice) {
          const customerDestination = resolvePreferredSendDestination(customer);
          const recipient = hasOverride ? destinationOverride.recipient : customerDestination?.recipient;
          const channel = hasOverride ? destinationOverride.channel : customerDestination?.channel;
          if (recipient && channel) {
            queueLocalCommunication({
              type: "reminder",
              channel,
              recipient,
              customer_id: invoice.customer_id,
              work_order_id: invoice.work_order_id,
              invoice_id: invoice._id,
              quote_id: invoice.source_quote_id,
              template_key: "invoice_sent",
              message: `Invoice for $${invoice.total.toFixed(2)} is ready. Pay here: ${paymentUrl}`,
            });
          }
        }
        toast.success("Invoice marked as sent.");
      }
      if (hasOverride) {
        closeAlternateRecipientEditor();
      }
    } catch (error) {
      toast.error(error?.message || "Failed to send invoice.");
    } finally {
      setInvoiceActionId(null);
    }
  };

  const handleOpenPayLink = async (invoice) => {
    if (!invoice) return;

    if (cloudEnabled) {
      setInvoiceActionId(invoice._id);
      try {
        const baseUrl = typeof window !== "undefined" ? window.location.origin : undefined;
        const result = await sendInvoiceWithStripe({
          id: invoice._id,
          base_url: baseUrl,
          force_new_session: true,
        });
        if (!result?.payment_url) {
          toast.message("Invoice is already paid in full.");
          return;
        }
        window.open(result.payment_url, "_blank", "noopener,noreferrer");
      } catch (error) {
        toast.error(error?.message || "Failed to open payment link.");
      } finally {
        setInvoiceActionId(null);
      }
      return;
    }

    if (!invoice.payment_url) {
      toast.error("No payment link is available for this local invoice.");
      return;
    }
    if (/pay\.chemcheck\.app\/invoice\//i.test(invoice.payment_url)) {
      toast.message("Local mode uses simulated invoices. Switch to cloud mode for live Stripe pay links.");
      return;
    }

    window.open(invoice.payment_url, "_blank", "noopener,noreferrer");
  };

  const handleSendInvoiceWithAlternateRecipient = async (invoice) => {
    if (!invoice) return;
    await handleSendInvoice(invoice._id, {
      channel: alternateRecipientEditor.channel,
      recipient: alternateRecipientEditor.recipient.trim(),
    });
  };

  const handleSendDepositLinkWithAlternateRecipient = async (quote) => {
    if (!quote) return;
    await handleCreateDepositLink(quote, {
      channel: alternateRecipientEditor.channel,
      recipient: alternateRecipientEditor.recipient.trim(),
    });
  };

  const handleMarkPaid = async (invoiceId) => {
    const invoice = allInvoices.find((item) => String(item._id) === String(invoiceId));
    if (cloudEnabled && invoice?.status === "sent" && invoice?.stripe_checkout_session_id) {
      toast.error("Stripe-linked invoices are marked paid automatically after Stripe confirms payment.");
      return;
    }

    setInvoiceActionId(invoiceId);
    try {
      if (cloudEnabled) {
        await markInvoicePaid({ id: invoiceId });
      } else {
        setLocalInvoices((prev) =>
          prev.map((invoice) =>
            String(invoice._id) === String(invoiceId)
              ? { ...invoice, status: "paid", paid_at: Date.now(), updated_at: Date.now() }
              : invoice
          )
        );
      }
      toast.success("Invoice marked as paid.");
    } catch (error) {
      toast.error(error?.message || "Failed to mark invoice as paid.");
    } finally {
      setInvoiceActionId(null);
    }
  };

  const handleQueueReminders = async (options = {}) => {
    const silent = Boolean(options.silent);
    setIsQueueingReminders(true);
    try {
      if (cloudEnabled) {
        const result = await queueUnpaidReminders({});
        const queued = result?.queued || 0;
        if (!silent) {
          toast.success(`Queued ${queued} unpaid invoice reminder${queued === 1 ? "" : "s"}.`);
        }
        if (queued > 0) {
          await handleDeliverQueued(Math.min(queued, 50));
        } else if (!silent) {
          toast.message("No reminders were due right now.");
        }
      } else {
        const today = getTodayDateString();
        const dueOrPast = localInvoices.filter(
          (invoice) =>
            invoice.status === "sent" &&
            (!invoice.due_date || invoice.due_date <= today)
        );
        const latestReminderByInvoice = new Map();
        for (const item of localCommunications) {
          if (item.template_key !== "invoice_unpaid_reminder") continue;
          if (!item.invoice_id) continue;
          const key = String(item.invoice_id);
          const existing = latestReminderByInvoice.get(key);
          const timestamp = toFiniteNumber(item.updated_at || item.created_at, 0);
          if (!existing || timestamp >= existing.timestamp) {
            latestReminderByInvoice.set(key, { status: item.status, timestamp });
          }
        }

        let queuedCount = 0;
        for (const invoice of dueOrPast) {
          if (queuedCount >= 50) break;
          const latestReminder = latestReminderByInvoice.get(String(invoice._id));
          if (latestReminder?.status === "queued") continue;
          if (latestReminder && (Date.now() - latestReminder.timestamp) < REMINDER_COOLDOWN_MS) {
            continue;
          }

          const customer = customerById.get(String(invoice.customer_id));
          const destination = resolvePreferredSendDestination(customer);
          if (!destination) continue;
          const invoiceTotal = toFiniteNumber(invoice.total, 0);
          queueLocalCommunication({
            type: "reminder",
            channel: destination.channel,
            recipient: destination.recipient,
            customer_id: invoice.customer_id,
            work_order_id: invoice.work_order_id,
            invoice_id: invoice._id,
            quote_id: invoice.source_quote_id,
            template_key: "invoice_unpaid_reminder",
            message: `Friendly reminder: invoice for $${invoiceTotal.toFixed(2)} is still unpaid.${invoice.payment_url ? ` Pay here: ${invoice.payment_url}` : ""}`,
          });
          latestReminderByInvoice.set(String(invoice._id), { status: "queued", timestamp: Date.now() });
          queuedCount += 1;
        }
        if (!silent) {
          toast.success(`Queued ${queuedCount} unpaid invoice reminder${queuedCount === 1 ? "" : "s"}.`);
        }
      }
    } catch (error) {
      if (!silent) {
        toast.error(error?.message || "Failed to queue reminders.");
      }
    } finally {
      setIsQueueingReminders(false);
    }
  };

  queueRemindersRef.current = handleQueueReminders;

  const handleRetryFailedCommunications = async () => {
    setIsRetryingFailedCommunications(true);
    try {
      if (cloudEnabled) {
        const result = await requeueFailedCommunications({
          limit: 50,
          only_template_keys: ["invoice_sent", "invoice_unpaid_reminder", "quote_deposit_requested"],
        });
        const requeued = toFiniteNumber(result?.requeued, 0);
        if (requeued <= 0) {
          toast.message("No failed billing sends to retry.");
          return;
        }
        await handleDeliverQueued(Math.min(requeued, 50));
        toast.success(`Retried ${requeued} failed billing send${requeued === 1 ? "" : "s"}.`);
      } else {
        const now = Date.now();
        let requeued = 0;
        setLocalCommunications((prev) =>
          prev.map((item) => {
            if (item.status !== "failed") return item;
            if (!["invoice_sent", "invoice_unpaid_reminder", "quote_deposit_requested"].includes(item.template_key || "")) {
              return item;
            }
            requeued += 1;
            return {
              ...item,
              status: "queued",
              scheduled_for: now,
              error: undefined,
              updated_at: now,
            };
          })
        );
        if (requeued <= 0) {
          toast.message("No failed billing sends to retry.");
        } else {
          toast.success(`Requeued ${requeued} failed billing send${requeued === 1 ? "" : "s"}.`);
        }
      }
    } catch (error) {
      toast.error(error?.message || "Failed to retry failed sends.");
    } finally {
      setIsRetryingFailedCommunications(false);
    }
  };

  const handleExportMonthCloseCsv = () => {
    const rows = monthCloseSummary.createdInMonth.map((invoice) => {
      const customer = customerById.get(String(invoice.customer_id));
      return [
        String(invoice._id),
        customer?.full_name || "Unknown",
        invoice.status,
        formatTimestamp(invoice.created_at) || "",
        invoice.due_date || "",
        formatTimestamp(invoice.paid_at) || "",
        toFiniteNumber(invoice.subtotal, 0).toFixed(2),
        toFiniteNumber(invoice.tax, 0).toFixed(2),
        toFiniteNumber(invoice.deposit_applied, 0).toFixed(2),
        toFiniteNumber(invoice.total, 0).toFixed(2),
        invoice.payment_url || "",
      ];
    });

    const filename = `chemcheck-month-close-${monthCloseSummary.month || "month"}.csv`;
    const headers = [
      "invoice_id",
      "customer",
      "status",
      "created_at",
      "due_date",
      "paid_at",
      "subtotal",
      "tax",
      "deposit_applied",
      "total",
      "payment_url",
    ];
    downloadCsv(filename, headers, rows);
    toast.success(`Exported month close CSV for ${monthCloseSummary.label}.`);
  };

  useEffect(() => {
    if (!reminderAutopilotEnabled) {
      reminderAutopilotRunningRef.current = false;
      setIsReminderAutopilotRunning(false);
      return undefined;
    }

    const intervalMinutes = Math.max(15, Math.min(720, Math.floor(toFiniteNumber(reminderAutopilotIntervalMinutes, 60))));
    const intervalMs = intervalMinutes * 60 * 1000;

    if (!reminderAutopilotNextRunAt || reminderAutopilotNextRunAt <= Date.now()) {
      setReminderAutopilotNextRunAt(Date.now() + intervalMs);
    }

    let active = true;

    const checkAndRun = async () => {
      if (!active || reminderAutopilotRunningRef.current) return;
      const nextRun = reminderAutopilotNextRunAt || 0;
      if (Date.now() < nextRun) return;

      reminderAutopilotRunningRef.current = true;
      setIsReminderAutopilotRunning(true);
      try {
        const queueFn = queueRemindersRef.current;
        if (queueFn) {
          await queueFn({ silent: true });
        }
      } finally {
        if (active) {
          setReminderAutopilotNextRunAt(Date.now() + intervalMs);
          setIsReminderAutopilotRunning(false);
        }
        reminderAutopilotRunningRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void checkAndRun();
    }, 30000);

    void checkAndRun();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [reminderAutopilotEnabled, reminderAutopilotIntervalMinutes, reminderAutopilotNextRunAt]);

  const hideOverviewPanelsOnMobile = activeSection !== "dispatch";

  return (
    <div className={`w-full px-3 sm:px-6 lg:px-8 py-3 sm:py-6 ${isCompactView ? "space-y-3 sm:space-y-4" : "space-y-4 sm:space-y-6"}`}>
      <div className="flex flex-col gap-1.5 sm:gap-2">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ClipboardList className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-600" />
          Work Orders & Dispatch
        </h1>
        <p className="text-xs sm:text-sm text-slate-600">
          Build dispatch, quotes, and invoicing in one flow for solo operators and small teams.
        </p>
        {cloudEnabled ? (
          <p className="text-[11px] sm:text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1.5 sm:px-3 sm:py-2">
            Cloud mode active. Work orders, quotes, and invoices save to Convex.
          </p>
        ) : (
          <p className="text-[11px] sm:text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 sm:px-3 sm:py-2">
            Local mode active. Work orders, quotes, and invoices are saved locally on this device.
          </p>
        )}
      </div>

      <Card className="p-2.5 sm:p-4">
        <div className="flex flex-col gap-2.5 sm:gap-3 lg:flex-row lg:items-center lg:justify-between">
          {workOrdersSplitEnabled ? (
            <div className="inline-flex w-full lg:w-auto rounded-xl border border-slate-200 bg-slate-50 p-1 overflow-x-auto">
              {[
                { id: "dispatch", label: "Dispatch" },
                { id: "quotes", label: "Quotes" },
                { id: "invoices", label: "Invoices" },
                { id: "comms", label: "Comms" },
              ].map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => handleSectionChange(section.id)}
                  className={`flex-1 shrink-0 lg:flex-none px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all ${
                    activeSection === section.id
                      ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 self-start">
              Work Orders IA split is disabled. Showing dispatch view.
            </p>
          )}
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 self-start">
            <button
              type="button"
              onClick={() => handleViewModeChange("detailed")}
              className={`px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded-lg transition-colors ${
                viewMode === "detailed" ? "bg-cyan-50 text-cyan-700" : "text-slate-500"
              }`}
            >
              Detailed
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("compact")}
              className={`px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded-lg transition-colors ${
                viewMode === "compact" ? "bg-cyan-50 text-cyan-700" : "text-slate-500"
              }`}
            >
              Compact
            </button>
          </div>
        </div>
      </Card>

      {activeSection === "dispatch" && (
      <Card className="p-3 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-end gap-3 sm:gap-4">
          <div>
            <Label htmlFor="dispatch-date" className="text-xs sm:text-sm">Dispatch Date</Label>
            <Input
              id="dispatch-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full sm:w-[220px]"
            />
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-600">
            <CalendarClock className="w-4 h-4 text-cyan-600" />
            {workOrders.length} work order{workOrders.length === 1 ? "" : "s"} on {selectedDate}
          </div>
        </div>
      </Card>
      )}

      <div className={`${hideOverviewPanelsOnMobile ? "hidden sm:grid" : "grid"} grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3`}>
        <Card className="p-2.5 sm:p-3">
          <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-slate-500">Open Quotes</p>
          <p className="text-xl sm:text-2xl font-semibold text-slate-900">{dashboardMetrics.openQuotes}</p>
        </Card>
        <Card className="p-2.5 sm:p-3">
          <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-slate-500">Pending Deposits</p>
          <p className={`text-xl sm:text-2xl font-semibold ${dashboardMetrics.pendingDeposits > 0 ? "text-amber-700" : "text-slate-900"}`}>
            {dashboardMetrics.pendingDeposits}
          </p>
        </Card>
        <Card className="p-2.5 sm:p-3">
          <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-slate-500">Unpaid Invoices</p>
          <p className={`text-xl sm:text-2xl font-semibold ${dashboardMetrics.unpaidInvoices > 0 ? "text-blue-700" : "text-slate-900"}`}>
            {dashboardMetrics.unpaidInvoices}
          </p>
        </Card>
        <Card className="p-2.5 sm:p-3">
          <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-slate-500">Overdue Invoices</p>
          <p className={`text-xl sm:text-2xl font-semibold ${dashboardMetrics.overdueInvoices > 0 ? "text-rose-700" : "text-slate-900"}`}>
            {dashboardMetrics.overdueInvoices}
          </p>
        </Card>
      </div>

      <Card className={`${hideOverviewPanelsOnMobile ? "hidden sm:block" : "block"} p-3 sm:p-5`}>
        <div className="flex items-center justify-between gap-2 sm:gap-3 mb-2 sm:mb-3">
          <h2 className="text-xs sm:text-base font-bold tracking-tight text-slate-950">Billing Reliability</h2>
          <span
            className={`text-[10px] sm:text-xs px-2 py-1 rounded-full font-medium ${
              billingHealth.totalIssues > 0
                ? "bg-amber-100 text-amber-800"
                : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {billingHealth.totalIssues > 0 ? `${billingHealth.totalIssues} issue${billingHealth.totalIssues === 1 ? "" : "s"}` : "Healthy"}
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <div className="rounded-md border border-slate-200 p-2">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-slate-500">Failed Sends</p>
            <p className={`text-base sm:text-lg font-semibold ${billingHealth.failedDeliveries > 0 ? "text-rose-700" : "text-slate-900"}`}>
              {billingHealth.failedDeliveries}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 p-2">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-slate-500">Stuck Queue</p>
            <p className={`text-base sm:text-lg font-semibold ${billingHealth.queuedStale > 0 ? "text-amber-700" : "text-slate-900"}`}>
              {billingHealth.queuedStale}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 p-2">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-slate-500">Old Drafts</p>
            <p className={`text-base sm:text-lg font-semibold ${billingHealth.staleDrafts > 0 ? "text-blue-700" : "text-slate-900"}`}>
              {billingHealth.staleDrafts}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 p-2">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-slate-500">Missing Pay Link</p>
            <p className={`text-base sm:text-lg font-semibold ${billingHealth.sentMissingPayLink > 0 ? "text-rose-700" : "text-slate-900"}`}>
              {billingHealth.sentMissingPayLink}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 p-2">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-slate-500">30+ Days Unpaid</p>
            <p className={`text-base sm:text-lg font-semibold ${billingHealth.unpaidThirtyPlus > 0 ? "text-rose-700" : "text-slate-900"}`}>
              {billingHealth.unpaidThirtyPlus}
            </p>
          </div>
        </div>
      </Card>

      <div className={isCompactView ? "space-y-4" : "space-y-6"}>
        {activeSection === "dispatch" && (
        <Card className="p-4 sm:p-5">
          <div className="mb-4 border-b border-slate-200 pb-2">
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-950">Create Work Order</h2>
          </div>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="wo-customer">Customer</Label>
                <select
                  id="wo-customer"
                  value={form.customer_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, customer_id: e.target.value }))}
                  className="w-full h-10 border border-slate-300 rounded-md px-3 bg-white"
                >
                  <option value="">Select customer...</option>
                  {customers.map((customer) => (
                    <option key={customer._id} value={String(customer._id)}>{customer.full_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="wo-assignee">Assignee</Label>
                <select
                  id="wo-assignee"
                  value={form.assignee_email}
                  onChange={(e) => setForm((prev) => ({ ...prev, assignee_email: e.target.value }))}
                  className="w-full h-10 border border-slate-300 rounded-md px-3 bg-white"
                >
                  <option value="">Unassigned</option>
                  {teamMembers.map((member) => (
                    <option key={member._id} value={member.user_email}>{member.name} ({member.user_email})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="wo-title">Title</Label>
                <Input
                  id="wo-title"
                  value={form.title}
                  placeholder="Filter clean / equipment repair / green-to-clean"
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="wo-priority">Priority</Label>
                <select
                  id="wo-priority"
                  value={form.priority}
                  onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                  className="w-full h-10 border border-slate-300 rounded-md px-3 bg-white"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="wo-description">Description</Label>
              <textarea
                id="wo-description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full border border-slate-300 rounded-md px-3 py-2"
                placeholder="Add context, parts needed, and customer requests"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="wo-recurring"
                  checked={form.is_recurring}
                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, is_recurring: !!checked }))}
                />
                <Label htmlFor="wo-recurring">Recurring</Label>
              </div>

              {form.is_recurring && (
                <select
                  value={form.recurrence_rule}
                  onChange={(e) => setForm((prev) => ({ ...prev, recurrence_rule: e.target.value }))}
                  className="h-10 border border-slate-300 rounded-md px-3 bg-white"
                >
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Every 2 weeks</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              )}
            </div>

            <Button type="submit" disabled={isCreating}>
              {isCreating ? "Creating..." : "Create Work Order"}
            </Button>
          </form>
        </Card>
        )}

        {activeSection === "quotes" && (
        <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-4 border-b border-slate-200 pb-2">
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-950 flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-700" />
                Quotes
              </h2>
            </div>

            <form className="space-y-3 mb-4 pb-4 border-b border-slate-200" onSubmit={handleCreateQuoteDraft}>
              <div>
                <Label htmlFor="quote-customer">Customer</Label>
                <select
                  id="quote-customer"
                  value={quoteForm.customer_id}
                  onChange={(e) => setQuoteForm((prev) => ({ ...prev, customer_id: e.target.value }))}
                  className="w-full h-9 border border-slate-300 rounded-md px-2 text-xs bg-white"
                >
                  <option value="">Select customer...</option>
                  {customers.map((customer) => (
                    <option key={customer._id} value={String(customer._id)}>{customer.full_name}</option>
                  ))}
                </select>
                {quoteFormErrors.customer && (
                  <p className="mt-1 text-[11px] text-rose-600">{quoteFormErrors.customer}</p>
                )}
              </div>

              <div>
                <Label htmlFor="quote-title">Title</Label>
                <Input
                  id="quote-title"
                  value={quoteForm.title}
                  onChange={(e) => setQuoteForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="h-9 text-xs"
                  placeholder="Green-to-clean package / pump replacement"
                />
                {quoteFormErrors.title && (
                  <p className="mt-1 text-[11px] text-rose-600">{quoteFormErrors.title}</p>
                )}
              </div>

              <div>
                <Label htmlFor="quote-description">Description</Label>
                <Input
                  id="quote-description"
                  value={quoteForm.description}
                  onChange={(e) => setQuoteForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="h-9 text-xs"
                  placeholder="Scope details and line-item summary"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="quote-qty">Qty</Label>
                  <Input
                    id="quote-qty"
                    value={quoteForm.quantity}
                    onChange={(e) => setQuoteForm((prev) => ({ ...prev, quantity: e.target.value }))}
                    className="h-9 text-xs"
                  />
                  {quoteFormErrors.quantity && (
                    <p className="mt-1 text-[11px] text-rose-600">{quoteFormErrors.quantity}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="quote-price">Unit $</Label>
                  <Input
                    id="quote-price"
                    value={quoteForm.unit_price}
                    onChange={(e) => setQuoteForm((prev) => ({ ...prev, unit_price: e.target.value }))}
                    className="h-9 text-xs"
                  />
                  {quoteFormErrors.unitPrice && (
                    <p className="mt-1 text-[11px] text-rose-600">{quoteFormErrors.unitPrice}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="quote-tax">Tax Rate</Label>
                  <Input
                    id="quote-tax"
                    value={quoteForm.tax_rate}
                    onChange={(e) => setQuoteForm((prev) => ({ ...prev, tax_rate: e.target.value }))}
                    className="h-9 text-xs"
                    placeholder="8.25 or 0.0825"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">Enter 8.25 for 8.25% tax.</p>
                </div>
                <div>
                  <Label htmlFor="quote-deposit">Deposit $</Label>
                  <Input
                    id="quote-deposit"
                    value={quoteForm.deposit_required}
                    onChange={(e) => setQuoteForm((prev) => ({ ...prev, deposit_required: e.target.value }))}
                    className="h-9 text-xs"
                    placeholder="Optional"
                  />
                  {quoteFormErrors.deposit && (
                    <p className="mt-1 text-[11px] text-rose-600">{quoteFormErrors.deposit}</p>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="quote-valid-until">Valid Until</Label>
                <Input
                  id="quote-valid-until"
                  type="date"
                  value={quoteForm.valid_until}
                  onChange={(e) => setQuoteForm((prev) => ({ ...prev, valid_until: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>

              <Button
                type="submit"
                size="sm"
                className="w-full h-8 text-xs"
                disabled={isCreatingQuote || Object.values(quoteFormErrors).some(Boolean)}
              >
                {isCreatingQuote ? "Creating..." : "Create Quote Draft"}
              </Button>
            </form>

            <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <Input
                value={quoteSearchTerm}
                onChange={(e) => setQuoteSearchTerm(e.target.value)}
                className="h-8 text-xs"
                placeholder="Search quotes by title, customer, or notes"
              />
              <select
                value={quoteStatusFilter}
                onChange={(e) => setQuoteStatusFilter(e.target.value)}
                className="h-8 border border-slate-300 rounded-md px-2 text-xs bg-white sm:w-[170px]"
              >
                <option value="active">Active</option>
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="approved">Approved</option>
                <option value="converted">Converted</option>
                <option value="declined">Declined</option>
              </select>
            </div>

            <div className="space-y-3 max-h-[360px] overflow-auto pr-1">
              {filteredQuotes.length === 0 && (
                <p className="text-sm text-slate-500">No quotes match your filters.</p>
              )}
              {filteredQuotes.slice(0, 20).map((quote) => {
                const customer = customerById.get(String(quote.customer_id));
                const quoteIsBusy = quoteActionId === quote._id;
                const depositPending = hasPendingDeposit(quote);
                const canSendToCustomer = hasValidSendDestination(customer);
                const hasDepositLink = Boolean(quote.deposit_payment_url);
                const canConvert = canConvertQuote(quote);
                const linkedInvoice = invoiceByQuoteId.get(String(quote._id))
                  || (quote.converted_work_order_id ? invoiceByWorkOrderId.get(String(quote.converted_work_order_id)) : undefined);
                const canDraftInvoice = canDraftInvoiceFromQuote(quote, Boolean(linkedInvoice));
                const canCreateDepositLink = quote.deposit_required > 0 && quote.deposit_status !== "paid" && !hasDepositLink;
                const quoteAlternateKey = makeAlternateRecipientKey("quote", quote._id);
                const isQuoteAlternateOpen = alternateRecipientEditor.key === quoteAlternateKey;
                return (
                  <div key={quote._id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm text-slate-900">{quote.title}</p>
                        <p className="text-xs text-slate-600">{customer?.full_name || "Customer"}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${quoteStatusBadgeClass(quote.status)}`}>
                        {quote.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">Total: ${quote.total.toFixed(2)}</p>
                    {quote.deposit_required && quote.deposit_required > 0 && (
                      <p className="text-xs text-slate-500">
                        Deposit: ${quote.deposit_required.toFixed(2)} ({quote.deposit_status || "pending"})
                      </p>
                    )}
                    {quote.deposit_status === "paid" && (
                      <p className="text-xs text-emerald-700">
                        Paid via {formatDepositSource(quote.deposit_paid_source) || "Recorded payment"}
                        {quote.deposit_paid_at ? ` on ${formatTimestamp(quote.deposit_paid_at)}` : ""}
                      </p>
                    )}
                    {quote.deposit_payment_url && (
                      <p className="text-[11px] text-blue-700 truncate">Deposit URL: {quote.deposit_payment_url}</p>
                    )}
                    {!canSendToCustomer && (
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className="text-xs text-rose-600">Add a valid customer phone or email to send deposit links.</p>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            onClick={() => openAlternateRecipientEditor("quote", quote._id, customer)}
                          >
                            Use Alternate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            onClick={() => handleFixCustomerContact(quote.customer_id)}
                          >
                            Fix Contact
                          </Button>
                        </div>
                      </div>
                    )}
                    {isQuoteAlternateOpen && (
                      <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
                        <p className="text-[11px] text-slate-600">Send to alternate recipient</p>
                        <div className="flex items-center gap-2">
                          <select
                            value={alternateRecipientEditor.channel}
                            onChange={(e) => setAlternateRecipientEditor((prev) => ({ ...prev, channel: e.target.value }))}
                            className="h-8 border border-slate-300 rounded-md px-2 text-xs bg-white"
                          >
                            <option value="email">Email</option>
                            <option value="sms">SMS</option>
                          </select>
                          <Input
                            value={alternateRecipientEditor.recipient}
                            onChange={(e) => setAlternateRecipientEditor((prev) => ({ ...prev, recipient: e.target.value }))}
                            placeholder={alternateRecipientEditor.channel === "sms" ? "(555) 123-4567" : "name@example.com"}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled={
                              quoteIsBusy
                              || !isValidRecipientForChannel(alternateRecipientEditor.channel, alternateRecipientEditor.recipient.trim())
                            }
                            onClick={() => handleSendDepositLinkWithAlternateRecipient(quote)}
                          >
                            {quoteIsBusy ? "Sending..." : "Send Deposit Link"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            onClick={closeAlternateRecipientEditor}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    {depositPending && (
                      <p className="text-xs text-amber-700">Deposit required before convert or invoice.</p>
                    )}
                    {quote.valid_until && (
                      <p className="text-xs text-slate-500">Valid until: {quote.valid_until}</p>
                    )}
                    {quote.converted_work_order_id && (
                      <p className="text-xs text-emerald-700">Converted to work order.</p>
                    )}
                    {linkedInvoice && (
                      <p className="text-xs text-blue-700">
                        Invoice: {linkedInvoice.status}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {quote.status === "draft" && (
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={quoteIsBusy}
                          onClick={() => handleQuoteStatusChange(quote, "sent")}
                        >
                          {quoteIsBusy ? "Saving..." : "Send"}
                        </Button>
                      )}
                      {quote.status === "sent" && (
                        <>
                          <Button
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled={quoteIsBusy}
                            onClick={() => handleQuoteStatusChange(quote, "approved")}
                          >
                            {quoteIsBusy ? "Saving..." : "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={quoteIsBusy}
                            onClick={() => handleQuoteStatusChange(quote, "declined")}
                          >
                            {quoteIsBusy ? "Saving..." : "Decline"}
                          </Button>
                        </>
                      )}
                      {quote.status !== "declined" && quote.deposit_required > 0 && quote.deposit_status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          disabled={quoteIsBusy}
                          onClick={() => handleMarkDepositPaid(quote)}
                        >
                          {quoteIsBusy ? "Saving..." : "Mark Deposit Paid"}
                        </Button>
                      )}
                      {canCreateDepositLink && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          disabled={quoteIsBusy || !canSendToCustomer}
                          onClick={() => handleCreateDepositLink(quote)}
                        >
                          {quoteIsBusy ? "Creating..." : "Create Deposit Link"}
                        </Button>
                      )}
                      {hasDepositLink && quote.deposit_status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() => window.open(quote.deposit_payment_url, "_blank", "noopener,noreferrer")}
                        >
                          Open Deposit Link
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        type="button"
                        onClick={() => handleDownloadQuotePdf(quote)}
                      >
                        <FileDown className="w-3.5 h-3.5 mr-1" />
                        PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        type="button"
                        onClick={() => handleUseQuoteTemplate(quote)}
                      >
                        Use Template
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        disabled={quoteIsBusy}
                        onClick={() => handleDuplicateQuote(quote)}
                      >
                        {quoteIsBusy ? "Copying..." : "Duplicate"}
                      </Button>
                      {canConvert && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          disabled={quoteIsBusy}
                          onClick={() => handleConvertQuote(quote)}
                        >
                          {quoteIsBusy ? "Converting..." : "Convert"}
                        </Button>
                      )}
                      {canDraftInvoice && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          disabled={quoteIsBusy}
                          onClick={() => handleCreateInvoiceFromQuote(quote)}
                        >
                          {quoteIsBusy ? "Creating..." : "Draft Invoice"}
                        </Button>
                      )}
                      {depositPending && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          disabled
                        >
                          Deposit Needed
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
        </Card>
        )}

        {activeSection === "invoices" && (
        <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-4 border-b border-slate-200 pb-2">
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-950 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-700" />
                Invoices
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={handleQueueReminders}
                  disabled={isQueueingReminders}
                >
                  {isQueueingReminders ? "Queueing..." : "Queue Reminders"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={handleRetryFailedCommunications}
                  disabled={isRetryingFailedCommunications || failedCommunications.length === 0}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  {isRetryingFailedCommunications
                    ? "Retrying..."
                    : `Retry Failed${failedCommunications.length > 0 ? ` (${failedCommunications.length})` : ""}`}
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleBatchCreateInvoices}
                  disabled={isBatchInvoicing || Object.values(batchInvoiceErrors).some(Boolean)}
                >
                  {isBatchInvoicing ? "Processing..." : "Run Batch"}
                </Button>
              </div>
            </div>

            <form className="space-y-3 mb-4 pb-4 border-b border-slate-200" onSubmit={handleCreateInvoiceDraft}>
              <div>
                <Label htmlFor="inv-customer">Customer</Label>
                <select
                  id="inv-customer"
                  value={invoiceForm.customer_id}
                  onChange={(e) => handleInvoiceCustomerSelect(e.target.value)}
                  className="w-full h-9 border border-slate-300 rounded-md px-2 text-xs bg-white"
                >
                  <option value="">Select customer...</option>
                  {customers.map((customer) => (
                    <option key={customer._id} value={String(customer._id)}>{customer.full_name}</option>
                  ))}
                </select>
                {invoiceFormErrors.customer && (
                  <p className="mt-1 text-[11px] text-rose-600">{invoiceFormErrors.customer}</p>
                )}
              </div>

              <div>
                <Label htmlFor="inv-work-order">Work Order (optional)</Label>
                <select
                  id="inv-work-order"
                  value={invoiceForm.work_order_id}
                  onChange={(e) => handleInvoiceWorkOrderSelect(e.target.value)}
                  className="w-full h-9 border border-slate-300 rounded-md px-2 text-xs bg-white"
                >
                  <option value="">No linked work order</option>
                  {invoiceWorkOrderOptions.map((order) => (
                    <option key={order._id} value={String(order._id)}>
                      {order.title} ({order.status.replace("_", " ")})
                    </option>
                  ))}
                </select>
                {invoiceForm.customer_id && invoiceWorkOrderOptions.length === 0 && (
                  <p className="mt-1 text-[11px] text-slate-500">No work orders found for this customer yet.</p>
                )}
              </div>

              <div>
                <Label htmlFor="inv-description">Description</Label>
                <Input
                  id="inv-description"
                  value={invoiceForm.description}
                  onChange={(e) => setInvoiceForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="h-9 text-xs"
                  placeholder="Monthly service / repair / clean-up"
                />
                {invoiceFormErrors.description && (
                  <p className="mt-1 text-[11px] text-rose-600">{invoiceFormErrors.description}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="inv-qty">Qty</Label>
                  <Input
                    id="inv-qty"
                    value={invoiceForm.quantity}
                    onChange={(e) => setInvoiceForm((prev) => ({ ...prev, quantity: e.target.value }))}
                    className="h-9 text-xs"
                  />
                  {invoiceFormErrors.quantity && (
                    <p className="mt-1 text-[11px] text-rose-600">{invoiceFormErrors.quantity}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="inv-price">Unit $</Label>
                  <Input
                    id="inv-price"
                    value={invoiceForm.unit_price}
                    onChange={(e) => setInvoiceForm((prev) => ({ ...prev, unit_price: e.target.value }))}
                    className="h-9 text-xs"
                  />
                  {invoiceFormErrors.unitPrice && (
                    <p className="mt-1 text-[11px] text-rose-600">{invoiceFormErrors.unitPrice}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="inv-tax">Tax Rate</Label>
                  <Input
                    id="inv-tax"
                    value={invoiceForm.tax_rate}
                    onChange={(e) => setInvoiceForm((prev) => ({ ...prev, tax_rate: e.target.value }))}
                    className="h-9 text-xs"
                    placeholder="8.25 or 0.0825"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">Enter 8.25 for 8.25% tax.</p>
                </div>
                <div>
                  <Label htmlFor="inv-due">Due Date</Label>
                  <Input
                    id="inv-due"
                    type="date"
                    value={invoiceForm.due_date}
                    onChange={(e) => setInvoiceForm((prev) => ({ ...prev, due_date: e.target.value }))}
                    className="h-9 text-xs"
                  />
                  {invoiceFormErrors.dueDate && (
                    <p className="mt-1 text-[11px] text-rose-600">{invoiceFormErrors.dueDate}</p>
                  )}
                </div>
              </div>

              <Button
                type="submit"
                size="sm"
                className="w-full h-8 text-xs"
                disabled={isCreatingInvoice || Object.values(invoiceFormErrors).some(Boolean)}
              >
                {isCreatingInvoice ? "Creating..." : "Create Invoice Draft"}
              </Button>
            </form>

            <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Batch Invoicing</p>
              <p className="text-[11px] text-slate-600">
                Batch run always uses the Unit $, Tax Rate, and Due In Days values below.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <div>
                  <Label htmlFor="batch-from" className="text-xs">From</Label>
                  <Input
                    id="batch-from"
                    type="date"
                    value={batchInvoiceForm.from_date}
                    onChange={(e) => setBatchInvoiceForm((prev) => ({ ...prev, from_date: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label htmlFor="batch-to" className="text-xs">To</Label>
                  <Input
                    id="batch-to"
                    type="date"
                    value={batchInvoiceForm.to_date}
                    onChange={(e) => setBatchInvoiceForm((prev) => ({ ...prev, to_date: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label htmlFor="batch-unit" className="text-xs">Unit $</Label>
                  <Input
                    id="batch-unit"
                    value={batchInvoiceForm.unit_price}
                    onChange={(e) => setBatchInvoiceForm((prev) => ({ ...prev, unit_price: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label htmlFor="batch-tax" className="text-xs">Tax Rate</Label>
                  <Input
                    id="batch-tax"
                    value={batchInvoiceForm.tax_rate}
                    onChange={(e) => setBatchInvoiceForm((prev) => ({ ...prev, tax_rate: e.target.value }))}
                    className="h-8 text-xs"
                    placeholder="8.25 or 0.0825"
                  />
                </div>
                <div>
                  <Label htmlFor="batch-due" className="text-xs">Due In Days</Label>
                  <Input
                    id="batch-due"
                    value={batchInvoiceForm.due_in_days}
                    onChange={(e) => setBatchInvoiceForm((prev) => ({ ...prev, due_in_days: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <Checkbox
                      checked={batchInvoiceForm.auto_send}
                      onCheckedChange={(checked) => setBatchInvoiceForm((prev) => ({ ...prev, auto_send: !!checked }))}
                    />
                    Auto-send after draft
                  </label>
                </div>
              </div>
              {batchInvoiceErrors.dateRange && (
                <p className="text-[11px] text-rose-600">{batchInvoiceErrors.dateRange}</p>
              )}
              {batchInvoiceErrors.unitPrice && (
                <p className="text-[11px] text-rose-600">{batchInvoiceErrors.unitPrice}</p>
              )}
              {batchInvoiceErrors.dueDays && (
                <p className="text-[11px] text-rose-600">{batchInvoiceErrors.dueDays}</p>
              )}
            </div>

            <div className="mb-4 grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Reminder Autopilot</p>
                    <p className="text-[11px] text-slate-600">
                      Auto-queues unpaid reminders on a fixed interval.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <Checkbox
                      checked={reminderAutopilotEnabled}
                      onCheckedChange={(checked) => {
                        const enabled = !!checked;
                        setReminderAutopilotEnabled(enabled);
                        if (!enabled) {
                          setReminderAutopilotNextRunAt(null);
                          return;
                        }
                        const minutes = Math.max(
                          15,
                          Math.min(720, Math.floor(toFiniteNumber(reminderAutopilotIntervalMinutes, 60)))
                        );
                        setReminderAutopilotNextRunAt(Date.now() + (minutes * 60 * 1000));
                      }}
                    />
                    Enabled
                  </label>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                  <div className="sm:w-40">
                    <Label htmlFor="autopilot-interval" className="text-xs">Interval (minutes)</Label>
                    <Input
                      id="autopilot-interval"
                      value={reminderAutopilotIntervalMinutes}
                      onChange={(e) => setReminderAutopilotIntervalMinutes(e.target.value)}
                      onBlur={() => {
                        const minutes = Math.max(
                          15,
                          Math.min(720, Math.floor(toFiniteNumber(reminderAutopilotIntervalMinutes, 60)))
                        );
                        setReminderAutopilotIntervalMinutes(String(minutes));
                        if (reminderAutopilotEnabled) {
                          setReminderAutopilotNextRunAt(Date.now() + (minutes * 60 * 1000));
                        }
                      }}
                      className="h-8 text-xs"
                      inputMode="numeric"
                      disabled={!reminderAutopilotEnabled}
                    />
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Next run: {reminderAutopilotEnabled
                      ? (formatTimestamp(reminderAutopilotNextRunAt) || "Scheduling...")
                      : "Autopilot disabled"}
                    {isReminderAutopilotRunning ? " (running now)" : ""}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Month-End Close</p>
                    <p className="text-[11px] text-slate-600">
                      Quick close summary for invoices created in the selected month.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    type="button"
                    onClick={handleExportMonthCloseCsv}
                    disabled={monthCloseSummary.createdInMonth.length === 0}
                  >
                    <FileDown className="w-3.5 h-3.5 mr-1" />
                    Export CSV
                  </Button>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <Label htmlFor="month-close-month" className="text-xs sm:w-24">Month</Label>
                  <Input
                    id="month-close-month"
                    type="month"
                    value={monthCloseMonth}
                    onChange={(e) => setMonthCloseMonth(e.target.value)}
                    className="h-8 text-xs sm:w-44"
                  />
                  <p className="text-[11px] text-slate-600">{monthCloseSummary.label}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-slate-200 bg-white p-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Billed</p>
                    <p className="text-sm font-semibold text-slate-900">${monthCloseSummary.billedTotal.toFixed(2)}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white p-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Collected</p>
                    <p className="text-sm font-semibold text-emerald-700">${monthCloseSummary.collectedTotal.toFixed(2)}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white p-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Outstanding</p>
                    <p className={`text-sm font-semibold ${monthCloseSummary.outstandingTotal > 0 ? "text-rose-700" : "text-slate-900"}`}>
                      ${monthCloseSummary.outstandingTotal.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white p-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Invoices</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {monthCloseSummary.createdInMonth.length} total / {monthCloseSummary.paidInMonth.length} paid
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <Input
                value={invoiceSearchTerm}
                onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                className="h-8 text-xs"
                placeholder="Search invoices by customer, notes, or line item"
              />
              <select
                value={invoiceStatusFilter}
                onChange={(e) => setInvoiceStatusFilter(e.target.value)}
                className="h-8 border border-slate-300 rounded-md px-2 text-xs bg-white sm:w-[160px]"
              >
                <option value="open">Open</option>
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
              </select>
            </div>

            <div className="space-y-3 max-h-[360px] overflow-auto pr-1">
              {filteredOpenInvoices.length === 0 && (
                <p className="text-sm text-slate-500">No open invoices match your filters.</p>
              )}
              {filteredOpenInvoices.slice(0, 20).map((invoice) => {
                const customer = customerById.get(String(invoice.customer_id));
                const canSendToCustomer = hasValidSendDestination(customer);
                const invoiceAlternateKey = makeAlternateRecipientKey("invoice", invoice._id);
                const isInvoiceAlternateOpen = alternateRecipientEditor.key === invoiceAlternateKey;
                const relatedQuote = invoice.source_quote_id
                  ? quoteById.get(String(invoice.source_quote_id))
                  : invoice.work_order_id
                    ? quoteByWorkOrderId.get(String(invoice.work_order_id))
                    : undefined;
                const stripeManaged = cloudEnabled && invoice.status === "sent" && Boolean(invoice.stripe_checkout_session_id);
                const primaryDescription = getInvoicePrimaryDescription(invoice);
                const noteText = String(invoice.notes || "").trim();
                const secondaryNotes = noteText && noteText !== primaryDescription ? noteText : "";
                return (
                  <div key={invoice._id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm text-slate-900">{customer?.full_name || "Customer"}</p>
                      <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${invoiceStatusBadgeClass(invoice.status)}`}>
                        {invoice.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">Total: ${invoice.total.toFixed(2)}</p>
                    {primaryDescription && (
                      <p className="text-xs text-slate-500 truncate">Description: {primaryDescription}</p>
                    )}
                    {secondaryNotes && (
                      <p className="text-[11px] text-slate-500 truncate">Notes: {secondaryNotes}</p>
                    )}
                    {invoice.deposit_applied > 0 && (
                      <p className="text-xs text-emerald-700">Deposit Applied: -${invoice.deposit_applied.toFixed(2)}</p>
                    )}
                    <p className="text-xs text-slate-500">Due: {invoice.due_date || "Not set"}</p>
                    {invoice.payment_url && (
                      <p className="text-[11px] text-blue-700 truncate">Pay URL: {invoice.payment_url}</p>
                    )}
                    {!canSendToCustomer && (
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className="text-xs text-rose-600">Add a valid customer phone or email before sending this invoice.</p>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            onClick={() => openAlternateRecipientEditor("invoice", invoice._id, customer)}
                          >
                            Use Alternate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            onClick={() => handleFixCustomerContact(invoice.customer_id)}
                          >
                            Fix Contact
                          </Button>
                        </div>
                      </div>
                    )}
                    {isInvoiceAlternateOpen && (
                      <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
                        <p className="text-[11px] text-slate-600">Send to alternate recipient</p>
                        <div className="flex items-center gap-2">
                          <select
                            value={alternateRecipientEditor.channel}
                            onChange={(e) => setAlternateRecipientEditor((prev) => ({ ...prev, channel: e.target.value }))}
                            className="h-8 border border-slate-300 rounded-md px-2 text-xs bg-white"
                          >
                            <option value="email">Email</option>
                            <option value="sms">SMS</option>
                          </select>
                          <Input
                            value={alternateRecipientEditor.recipient}
                            onChange={(e) => setAlternateRecipientEditor((prev) => ({ ...prev, recipient: e.target.value }))}
                            placeholder={alternateRecipientEditor.channel === "sms" ? "(555) 123-4567" : "name@example.com"}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled={
                              invoiceActionId === invoice._id
                              || !isValidRecipientForChannel(alternateRecipientEditor.channel, alternateRecipientEditor.recipient.trim())
                            }
                            onClick={() => handleSendInvoiceWithAlternateRecipient(invoice)}
                          >
                            {invoiceActionId === invoice._id ? "Sending..." : "Send Invoice"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            onClick={closeAlternateRecipientEditor}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    {(invoice.sent_at || invoice.paid_at || relatedQuote?.deposit_paid_at) && (
                      <div className="mt-1 space-y-0.5">
                        {relatedQuote?.deposit_paid_at && (
                          <p className="text-[11px] text-slate-500">
                            Deposit Paid: {formatTimestamp(relatedQuote.deposit_paid_at)}
                            {relatedQuote.deposit_paid_source ? ` (${formatDepositSource(relatedQuote.deposit_paid_source) || relatedQuote.deposit_paid_source})` : ""}
                          </p>
                        )}
                        {invoice.sent_at && (
                          <p className="text-[11px] text-slate-500">Sent: {formatTimestamp(invoice.sent_at)}</p>
                        )}
                        {invoice.paid_at && (
                          <p className="text-[11px] text-slate-500">Paid: {formatTimestamp(invoice.paid_at)}</p>
                        )}
                      </div>
                    )}
                    {stripeManaged && (
                      <p className="text-[11px] text-slate-500 mt-1">Awaiting Stripe payment confirmation.</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {invoice.status === "draft" && (
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={invoiceActionId === invoice._id || !canSendToCustomer}
                          onClick={() => handleSendInvoice(invoice._id)}
                        >
                          {invoiceActionId === invoice._id ? "Sending..." : "Send"}
                        </Button>
                      )}
                      {invoice.status === "sent" && !stripeManaged && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          disabled={invoiceActionId === invoice._id}
                          onClick={() => handleMarkPaid(invoice._id)}
                        >
                          {invoiceActionId === invoice._id ? "Saving..." : "Mark Paid"}
                        </Button>
                      )}
                      {invoice.status === "sent" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          disabled={invoiceActionId === invoice._id}
                          onClick={() => handleOpenPayLink(invoice)}
                        >
                          {invoiceActionId === invoice._id ? "Opening..." : "Open Pay Link"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        type="button"
                        onClick={() => handleDownloadInvoicePdf(invoice)}
                      >
                        <FileDown className="w-3.5 h-3.5 mr-1" />
                        PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        type="button"
                        onClick={() => handleUseInvoiceTemplate(invoice)}
                      >
                        Use Template
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        disabled={invoiceActionId === invoice._id}
                        onClick={() => handleDuplicateInvoice(invoice)}
                      >
                        {invoiceActionId === invoice._id ? "Copying..." : "Duplicate"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Paid / Completed
              </p>
              <div className="space-y-3 max-h-[220px] overflow-auto pr-1">
                {filteredPaidInvoices.length === 0 && (
                  <p className="text-sm text-slate-500">No paid invoices match your filters.</p>
                )}
                {filteredPaidInvoices.slice(0, 20).map((invoice) => {
                  const customer = customerById.get(String(invoice.customer_id));
                  const relatedQuote = invoice.source_quote_id
                    ? quoteById.get(String(invoice.source_quote_id))
                    : invoice.work_order_id
                      ? quoteByWorkOrderId.get(String(invoice.work_order_id))
                      : undefined;
                  const primaryDescription = getInvoicePrimaryDescription(invoice);
                  const noteText = String(invoice.notes || "").trim();
                  const secondaryNotes = noteText && noteText !== primaryDescription ? noteText : "";
                  return (
                    <div key={invoice._id} className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm text-slate-900">{customer?.full_name || "Customer"}</p>
                        <span className="text-[10px] px-2 py-1 rounded-full font-medium bg-emerald-100 text-emerald-700">
                          paid
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">Total: ${invoice.total.toFixed(2)}</p>
                      {primaryDescription && (
                        <p className="text-xs text-slate-500 truncate">Description: {primaryDescription}</p>
                      )}
                      {secondaryNotes && (
                        <p className="text-[11px] text-slate-500 truncate">Notes: {secondaryNotes}</p>
                      )}
                      {invoice.deposit_applied > 0 && (
                        <p className="text-xs text-emerald-700">Deposit Applied: -${invoice.deposit_applied.toFixed(2)}</p>
                      )}
                      {relatedQuote?.deposit_paid_at && (
                        <p className="text-[11px] text-slate-500">
                          Deposit Paid: {formatTimestamp(relatedQuote.deposit_paid_at)}
                          {relatedQuote.deposit_paid_source ? ` (${formatDepositSource(relatedQuote.deposit_paid_source) || relatedQuote.deposit_paid_source})` : ""}
                        </p>
                      )}
                      {invoice.paid_at && (
                        <p className="text-[11px] text-slate-500">Paid: {formatTimestamp(invoice.paid_at)}</p>
                      )}
                      <div className="mt-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            type="button"
                            onClick={() => handleDownloadInvoicePdf(invoice)}
                          >
                            <FileDown className="w-3.5 h-3.5 mr-1" />
                            PDF
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            type="button"
                            onClick={() => handleUseInvoiceTemplate(invoice)}
                          >
                            Use Template
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={invoiceActionId === invoice._id}
                            onClick={() => handleDuplicateInvoice(invoice)}
                          >
                            {invoiceActionId === invoice._id ? "Copying..." : "Duplicate"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

          {activeSection === "comms" && (
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-4 border-b border-slate-200 pb-2">
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-950">Communications</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {queuedCommunications.length} queued
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  type="button"
                  disabled={!cloudEnabled || isDeliveringCommunications || queuedCommunications.length === 0}
                  onClick={() => handleDeliverQueued(25)}
                >
                  <Send className="w-3.5 h-3.5 mr-1" />
                  {isDeliveringCommunications ? "Sending..." : "Send Queued"}
                </Button>
              </div>
            </div>

            <div className="space-y-3 max-h-[260px] overflow-auto pr-1">
              {allCommunications.length === 0 && (
                <p className="text-sm text-slate-500">No communication events yet.</p>
              )}
              {allCommunications.slice(0, 20).map((item) => (
                <div key={item._id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm text-slate-900">
                      {(item.template_key || item.type || "event").replaceAll("_", " ")}
                    </p>
                    <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${communicationStatusBadgeClass(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    {item.channel?.toUpperCase?.() || item.channel || "CHANNEL"} to {item.recipient}
                  </p>
                  <p className="text-xs text-slate-500">{item.message}</p>
                  <div className="mt-1 space-y-0.5">
                    {item.provider && (
                      <p className="text-[11px] text-slate-500">
                        Provider: {item.provider}
                        {item.provider_message_id ? ` (${item.provider_message_id})` : ""}
                      </p>
                    )}
                    {Number.isFinite(item.attempts) && (
                      <p className="text-[11px] text-slate-500">Attempts: {item.attempts}</p>
                    )}
                    {item.last_attempt_at && (
                      <p className="text-[11px] text-slate-500">Last Attempt: {formatTimestamp(item.last_attempt_at)}</p>
                    )}
                    {item.sent_at && (
                      <p className="text-[11px] text-slate-500">Sent: {formatTimestamp(item.sent_at)}</p>
                    )}
                    {item.delivered_at && (
                      <p className="text-[11px] text-cyan-700">Delivered: {formatTimestamp(item.delivered_at)}</p>
                    )}
                    {item.error && (
                      <p className="text-[11px] text-rose-700">Error: {item.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
        </Card>
          )}
      </div>

      {activeSection === "dispatch" && (
      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-4 border-b border-slate-200 pb-2">
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-950 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-cyan-700" />
            Work Orders
          </h2>
          <span className="text-xs text-slate-500">{workOrders.length} total</span>
        </div>

        <div className="space-y-3">
          {workOrders.length === 0 && (
            <p className="text-sm text-slate-500">No jobs on this dispatch date yet.</p>
          )}

          {workOrders.map((order) => {
            const customer = customerById.get(String(order.customer_id));
            const linkedQuote = quoteByWorkOrderId.get(String(order._id))
              || (order.source_quote_id ? quoteById.get(String(order.source_quote_id)) : undefined);
            const linkedInvoice = invoiceByWorkOrderId.get(String(order._id))
              || (linkedQuote ? invoiceByQuoteId.get(String(linkedQuote._id)) : undefined);
            const quoteDepositPending = Boolean(linkedQuote && hasPendingDeposit(linkedQuote));
            const hasInvoice = Boolean(linkedInvoice || invoicedWorkOrderIds.has(String(order._id)));

            return (
              <div key={order._id} className="border border-slate-200 rounded-lg p-3 space-y-3 bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900 text-sm">{order.title}</p>
                    <p className="text-xs text-slate-600">{customer?.full_name || "Unknown customer"}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${statusBadgeClass(order.status)}`}>
                    {order.status.replace("_", " ")}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <UserRound className="w-3.5 h-3.5" />
                  {order.assignee_email || "Unassigned"}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {linkedQuote && (
                    <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${quoteStatusBadgeClass(linkedQuote.status)}`}>
                      Quote {linkedQuote.status}
                    </span>
                  )}
                  {linkedQuote && linkedQuote.deposit_required > 0 && (
                    <span
                      className={`text-[10px] px-2 py-1 rounded-full font-medium ${
                        linkedQuote.deposit_status === "paid"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      Deposit {linkedQuote.deposit_status === "paid" ? "paid" : "pending"}
                    </span>
                  )}
                  {linkedInvoice && (
                    <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${invoiceStatusBadgeClass(linkedInvoice.status)}`}>
                      Invoice {linkedInvoice.status}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <select
                    value={order.assignee_email || ""}
                    onChange={(e) => handleAssigneeChange(order._id, e.target.value)}
                    className="h-9 border border-slate-300 rounded-md px-2 text-xs bg-white"
                  >
                    <option value="">Unassigned</option>
                    {teamMembers.map((member) => (
                      <option key={member._id} value={member.user_email}>{member.name}</option>
                    ))}
                  </select>

                  <select
                    value={order.status}
                    onChange={(e) => handleStatusChange(order._id, e.target.value)}
                    className="h-9 border border-slate-300 rounded-md px-2 text-xs bg-white"
                  >
                    <option value="scheduled">Scheduled</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {!isWorkOrderCompleted(order.status) && (
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => handleComplete(order._id)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Complete
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={hasInvoice || quoteDepositPending}
                    onClick={() => handleQuickInvoiceFromWorkOrder(order)}
                  >
                    <DollarSign className="w-3.5 h-3.5 mr-1" />
                    {hasInvoice ? "Invoiced" : quoteDepositPending ? "Deposit Needed" : "Draft Invoice"}
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs text-rose-600 border-rose-200 hover:bg-rose-50"
                    onClick={() => handleRemove(order._id)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      )}
    </div>
  );
}
