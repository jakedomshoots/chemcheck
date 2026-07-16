import { Component, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { createPageUrl } from "@/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CalendarClock,
  UserRound,
  DollarSign,
  CheckCircle2,
  FileText,
  FileDown,
  Send,
  Trash2,
  RotateCcw,
  Plus,
} from "lucide-react";
import { PoolIcon, IconBadge } from "@/components/ui/iconography";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
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
import { getWorkOrdersCloudState, requireWorkOrdersCloud } from "@/lib/workOrdersCloud";

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

function statusBadgeClass(status) {
  switch (status) {
    case "completed":
      return "bg-[var(--status-ok-soft)] text-ok";
    case "in_progress":
      return "bg-[var(--status-watch-soft)] text-watch";
    case "cancelled":
      return "bg-[var(--status-critical-soft)] text-critical";
    default:
      return "bg-brand-soft text-brand-ink";
  }
}

function invoiceStatusBadgeClass(status) {
  switch (status) {
    case "paid":
      return "bg-[var(--status-ok-soft)] text-ok";
    case "sent":
      return "bg-[var(--status-info-soft)] text-info";
    case "cancelled":
      return "bg-[var(--status-critical-soft)] text-critical";
    default:
      return "bg-surface-2 text-ink-secondary";
  }
}

function quoteStatusBadgeClass(status) {
  switch (status) {
    case "approved":
      return "bg-[var(--status-ok-soft)] text-ok";
    case "sent":
      return "bg-[var(--status-info-soft)] text-info";
    case "declined":
      return "bg-[var(--status-critical-soft)] text-critical";
    case "converted":
      return "bg-brand-soft text-brand-ink";
    default:
      return "bg-surface-2 text-ink-secondary";
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

function communicationStatusBadgeClass(status) {
  switch (status) {
    case "delivered":
      return "bg-brand-soft text-brand-ink";
    case "sent":
      return "bg-[var(--status-ok-soft)] text-ok";
    case "failed":
      return "bg-[var(--status-critical-soft)] text-critical";
    default:
      return "bg-[var(--status-info-soft)] text-info";
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

function WorkOrdersContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
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
  const [mobileCreateDrawerOpen, setMobileCreateDrawerOpen] = useState(false);
  const [mobileBillingExpanded, setMobileBillingExpanded] = useState(false);
  const woTitleRef = useRef(null);
  const reminderAutopilotRunningRef = useRef(false);
  const queueRemindersRef = useRef(null);

  const activeSection = useMemo(() => {
    const pathname = location.pathname.toLowerCase();
    const pathParts = pathname.split("/").filter(Boolean);
    const routeSection = pathParts.length >= 2 ? pathParts[1] : defaultSection;
    const resolvedSection = normalizeWorkOrdersSection(routeSection, defaultSection);
    return workOrdersSplitEnabled ? resolvedSection : "dispatch";
  }, [defaultSection, location.pathname, workOrdersSplitEnabled]);


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

  const currentBusiness = useQuery(api.businesses.getCurrent, {});
  const workOrdersCloudState = getWorkOrdersCloudState(currentBusiness);
  const cloudEnabled = workOrdersCloudState === "ready";

  const cloudCustomersData = useQuery(api.customers.list, cloudEnabled ? {} : "skip");
  const teamMembersData = useQuery(api.businesses.getTeamMembers, cloudEnabled ? {} : "skip");
  const workOrdersData = useQuery(
    api.workOrders.list,
    cloudEnabled ? { scheduled_date: selectedDate, numItems: 1000 } : "skip"
  );
  const allWorkOrdersData = useQuery(
    api.workOrders.list,
    cloudEnabled ? { numItems: 1000 } : "skip"
  );
  const allInvoicesData = useQuery(
    api.invoices.list,
    cloudEnabled ? { numItems: 1000 } : "skip"
  );
  const allQuotesData = useQuery(api.quotes.list, cloudEnabled ? {} : "skip");
  const communicationsData = useQuery(
    api.communications.list,
    cloudEnabled ? { numItems: 1000 } : "skip"
  );

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
  const customers = cloudCustomers;

  const teamMembers = useMemo(() => teamMembersData ?? [], [teamMembersData]);

  const workOrders = useMemo(() => workOrdersData?.page ?? [], [workOrdersData]);

  const allWorkOrders = useMemo(() => allWorkOrdersData?.page ?? [], [allWorkOrdersData]);

  const allInvoices = useMemo(
    () => (allInvoicesData?.page ?? []).map((invoice) => normalizeInvoiceRecord(invoice)),
    [allInvoicesData]
  );

  const allQuotes = useMemo(
    () => (allQuotesData ?? []).map((quote) => normalizeQuoteRecord(quote)),
    [allQuotesData]
  );

  const allCommunications = useMemo(() => communicationsData?.page ?? [], [communicationsData]);

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
    requireWorkOrdersCloud(workOrdersCloudState);

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
    requireWorkOrdersCloud(workOrdersCloudState);
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

      await createQuote({
        customer_id: quote.customer_id,
        title: `Copy - ${quote.title || "Quote"}`,
        description: quote.description || undefined,
        line_items: clonedLineItems,
        tax_rate: taxRate,
        deposit_required: quote.deposit_required,
        valid_until: quote.valid_until || undefined,
      });

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
    requireWorkOrdersCloud(workOrdersCloudState);
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

      await createInvoiceDraft({
        customer_id: invoice.customer_id,
        line_items: clonedLineItems,
        tax_rate: taxRate,
        due_date: invoice.due_date || getDatePlusDays(selectedDate, 7),
        notes: duplicateNotes,
      });
      toast.success("Invoice duplicated as draft.");
    } catch (error) {
      toast.error(error?.message || "Failed to duplicate invoice.");
    } finally {
      setInvoiceActionId(null);
    }
  };

  const handleBatchCreateInvoices = async () => {
    requireWorkOrdersCloud(workOrdersCloudState);
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

      const baseUrl = typeof window !== "undefined" ? window.location.origin : undefined;

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
            const sendResult = await sendInvoiceWithStripe({ id: invoiceId, base_url: baseUrl });
            if (!sendResult?.payment_url && !sendResult?.communication_id) continue;
            if (sendResult.communication_id) {
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
    requireWorkOrdersCloud(workOrdersCloudState);
    if (!form.customer_id || !form.title.trim()) {
      toast.error("Choose a customer and enter a work-order title.");
      return;
    }

    setIsCreating(true);
    try {
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
    requireWorkOrdersCloud(workOrdersCloudState);
    try {
      await updateWorkOrder({ id, status });
      toast.success("Status updated.");
    } catch (error) {
      toast.error(error?.message || "Failed to update status.");
    }
  };

  const handleAssigneeChange = async (id, assignee_email) => {
    requireWorkOrdersCloud(workOrdersCloudState);
    try {
      await updateWorkOrder({ id, assignee_email: assignee_email || undefined });
      toast.success("Assignee updated.");
    } catch (error) {
      toast.error(error?.message || "Failed to update assignee.");
    }
  };

  const handleComplete = async (id) => {
    requireWorkOrdersCloud(workOrdersCloudState);
    try {
      const result = await completeWorkOrder({ id });
      if (result?.invoice_blocked_reason === "deposit_pending") {
        toast.success("Marked complete. Deposit is still required before invoicing.");
      } else {
        toast.success(result?.invoice_id ? "Marked complete and drafted invoice." : "Marked complete.");
      }
    } catch (error) {
      toast.error(error?.message || "Failed to complete work order.");
    }
  };

  const handleRemove = async (id) => {
    requireWorkOrdersCloud(workOrdersCloudState);
    try {
      await removeWorkOrder({ id });
      toast.success("Work order deleted.");
    } catch (error) {
      toast.error(error?.message || "Failed to delete work order.");
    }
  };

  const handleCreateInvoiceDraft = async (event) => {
    event.preventDefault();
    requireWorkOrdersCloud(workOrdersCloudState);
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
      const selectedCloudCustomer = customerById.get(String(invoiceForm.customer_id));
      if (!selectedCloudCustomer) {
        throw new Error("Select a valid customer before creating an invoice.");
      }
      const draftLineItems = [{
        description: trimmedDescription,
        quantity,
        unit_price: unitPrice,
        amount: Number((quantity * unitPrice).toFixed(2)),
      }];
      await createInvoiceDraft({
        customer_id: selectedCloudCustomer._id,
        work_order_id: invoiceForm.work_order_id || undefined,
        line_items: draftLineItems,
        tax_rate: taxRate,
        due_date: invoiceForm.due_date || undefined,
        notes: resolveInvoiceNotes(trimmedDescription, draftLineItems, trimmedDescription),
      });

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
    requireWorkOrdersCloud(workOrdersCloudState);
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
      const selectedCloudCustomer = customerById.get(String(quoteForm.customer_id));
      if (!selectedCloudCustomer) {
        throw new Error("Select a valid customer before creating a quote.");
      }
      await createQuote({
        customer_id: selectedCloudCustomer._id,
        title: quoteForm.title.trim(),
        description: quoteForm.description.trim() || undefined,
        line_items: [{
          description: quoteForm.description.trim() || quoteForm.title.trim(),
          quantity,
          unit_price: unitPrice,
          amount: lineAmount,
        }],
        tax_rate: taxRate,
        deposit_required: depositRequired,
        valid_until: quoteForm.valid_until || undefined,
      });

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
    requireWorkOrdersCloud(workOrdersCloudState);

    const nextDepositStatus =
      status === "approved" && quote.deposit_required && quote.deposit_required > 0
        ? (quote.deposit_status === "paid" ? "paid" : "pending")
        : quote.deposit_status;

    setQuoteActionId(quote._id);
    try {
      await updateQuoteStatus({ id: quote._id, status, deposit_status: nextDepositStatus });
      toast.success("Quote status updated.");
    } catch (error) {
      toast.error(error?.message || "Failed to update quote status.");
    } finally {
      setQuoteActionId(null);
    }
  };

  const handleMarkDepositPaid = async (quote) => {
    if (!quote) return;
    requireWorkOrdersCloud(workOrdersCloudState);
    setQuoteActionId(quote._id);
    try {
      await updateQuoteStatus({
        id: quote._id,
        status: quote.status,
        deposit_status: "paid",
        deposit_paid_source: "manual",
      });
      toast.success("Deposit marked as paid.");
    } catch (error) {
      toast.error(error?.message || "Failed to mark deposit as paid.");
    } finally {
      setQuoteActionId(null);
    }
  };

  const handleCreateDepositLink = async (quote, destinationOverride) => {
    if (!quote) return;
    requireWorkOrdersCloud(workOrdersCloudState);
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
    requireWorkOrdersCloud(workOrdersCloudState);
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
      await convertQuoteToWorkOrder({ id: quote._id, scheduled_date: selectedDate, priority: "medium" });
      toast.success("Quote converted to work order.");
    } catch (error) {
      toast.error(error?.message || "Failed to convert quote.");
    } finally {
      setQuoteActionId(null);
    }
  };

  const handleCreateInvoiceFromQuote = async (quote) => {
    if (!quote) return;
    requireWorkOrdersCloud(workOrdersCloudState);
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
      await createInvoiceDraft({
        customer_id: quote.customer_id,
        work_order_id: quote.converted_work_order_id || undefined,
        source_quote_id: quote._id,
        line_items: quote.line_items,
        tax_rate: quote.subtotal > 0 ? quote.tax / quote.subtotal : 0,
        due_date: quote.valid_until || getDatePlusDays(selectedDate, 7),
        notes: quoteInvoiceNotes,
      });
      toast.success("Invoice draft created from quote.");
    } catch (error) {
      toast.error(error?.message || "Failed to create invoice from quote.");
    } finally {
      setQuoteActionId(null);
    }
  };

  const handleQuickInvoiceFromWorkOrder = async (order) => {
    requireWorkOrdersCloud(workOrdersCloudState);
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
      await createInvoiceDraft({
        customer_id: order.customer_id,
        work_order_id: order._id,
        source_quote_id: order.source_quote_id || undefined,
        line_items: quickLineItems,
        tax_rate: 0,
        due_date: getDatePlusDays(order.scheduled_date || selectedDate, 7),
        notes: quickInvoiceNotes,
      });
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
    requireWorkOrdersCloud(workOrdersCloudState);
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
    requireWorkOrdersCloud(workOrdersCloudState);
    setInvoiceActionId(invoice._id);
    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : undefined;
      const result = await sendInvoiceWithStripe({ id: invoice._id, base_url: baseUrl, force_new_session: true });
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
    requireWorkOrdersCloud(workOrdersCloudState);
    const invoice = allInvoices.find((item) => String(item._id) === String(invoiceId));
    if (invoice?.status === "sent" && invoice?.stripe_checkout_session_id) {
      toast.error("Stripe-linked invoices are marked paid automatically after Stripe confirms payment.");
      return;
    }

    setInvoiceActionId(invoiceId);
    try {
      await markInvoicePaid({ id: invoiceId });
      toast.success("Invoice marked as paid.");
    } catch (error) {
      toast.error(error?.message || "Failed to mark invoice as paid.");
    } finally {
      setInvoiceActionId(null);
    }
  };

  const handleQueueReminders = async (options = {}) => {
    requireWorkOrdersCloud(workOrdersCloudState);
    const silent = Boolean(options.silent);
    setIsQueueingReminders(true);
    try {
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
    requireWorkOrdersCloud(workOrdersCloudState);
    setIsRetryingFailedCommunications(true);
    try {
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

const workOrderCreateForm = (
    <div className="space-y-4">
      <div className="mb-4 border-b border-line pb-2">
        <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink">Create Work Order</h2>
      </div>
      <form className="space-y-4" onSubmit={handleCreate}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="wo-customer">Customer</Label>
            <select
              id="wo-customer"
              value={form.customer_id}
              onChange={(e) => setForm((prev) => ({ ...prev, customer_id: e.target.value }))}
              className="w-full h-10 border border-line rounded-md px-3 bg-white"
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
              className="w-full h-10 border border-line rounded-md px-3 bg-white"
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
              ref={woTitleRef}
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
              className="w-full h-10 border border-line rounded-md px-3 bg-white"
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
            className="w-full border border-line rounded-md px-3 py-2"
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
              className="h-10 border border-line rounded-md px-3 bg-white"
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
    </div>
  );

  const quoteCreateForm = (
    <form className="space-y-3" onSubmit={handleCreateQuoteDraft}>
      <div>
        <Label htmlFor="quote-customer">Customer</Label>
        <select
          id="quote-customer"
          value={quoteForm.customer_id}
          onChange={(e) => setQuoteForm((prev) => ({ ...prev, customer_id: e.target.value }))}
          className="w-full h-10 lg:h-9 border border-line rounded-md px-3 lg:px-2 bg-white text-sm lg:text-xs"
        >
          <option value="">Select customer...</option>
          {customers.map((customer) => (
            <option key={customer._id} value={String(customer._id)}>{customer.full_name}</option>
          ))}
        </select>
        {quoteFormErrors.customer && (
          <p className="mt-1 text-xs text-critical">{quoteFormErrors.customer}</p>
        )}
      </div>

      <div>
        <Label htmlFor="quote-title">Title</Label>
        <Input
          id="quote-title"
          value={quoteForm.title}
          onChange={(e) => setQuoteForm((prev) => ({ ...prev, title: e.target.value }))}
          className="h-10 lg:h-9 text-sm lg:text-xs"
          placeholder="Green-to-clean package / pump replacement"
        />
        {quoteFormErrors.title && (
          <p className="mt-1 text-xs text-critical">{quoteFormErrors.title}</p>
        )}
      </div>

      <div>
        <Label htmlFor="quote-description">Description</Label>
        <Input
          id="quote-description"
          value={quoteForm.description}
          onChange={(e) => setQuoteForm((prev) => ({ ...prev, description: e.target.value }))}
          className="h-10 lg:h-9 text-sm lg:text-xs"
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
            className="h-10 lg:h-9 text-sm lg:text-xs"
          />
          {quoteFormErrors.quantity && (
            <p className="mt-1 text-xs text-critical">{quoteFormErrors.quantity}</p>
          )}
        </div>
        <div>
          <Label htmlFor="quote-price">Unit $</Label>
          <Input
            id="quote-price"
            value={quoteForm.unit_price}
            onChange={(e) => setQuoteForm((prev) => ({ ...prev, unit_price: e.target.value }))}
            className="h-10 lg:h-9 text-sm lg:text-xs"
          />
          {quoteFormErrors.unitPrice && (
            <p className="mt-1 text-xs text-critical">{quoteFormErrors.unitPrice}</p>
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
            className="h-10 lg:h-9 text-sm lg:text-xs"
            placeholder="8.25 or 0.0825"
          />
          <p className="mt-1 text-xs text-ink-muted">Enter 8.25 for 8.25% tax.</p>
        </div>
        <div>
          <Label htmlFor="quote-deposit">Deposit $</Label>
          <Input
            id="quote-deposit"
            value={quoteForm.deposit_required}
            onChange={(e) => setQuoteForm((prev) => ({ ...prev, deposit_required: e.target.value }))}
            className="h-10 lg:h-9 text-sm lg:text-xs"
            placeholder="Optional"
          />
          {quoteFormErrors.deposit && (
            <p className="mt-1 text-xs text-critical">{quoteFormErrors.deposit}</p>
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
          className="h-10 lg:h-9 text-sm lg:text-xs"
        />
      </div>

      <Button
        type="submit"
        className="w-full h-11 lg:h-8 text-sm lg:text-xs"
        disabled={isCreatingQuote || Object.values(quoteFormErrors).some(Boolean)}
      >
        {isCreatingQuote ? "Creating..." : "Create Quote Draft"}
      </Button>
    </form>
  );

  const invoiceCreatePanel = (
    <div className="space-y-4">
      <form className="space-y-3 mb-4 pb-4 border-b border-line" onSubmit={handleCreateInvoiceDraft}>
        <div>
          <Label htmlFor="inv-customer">Customer</Label>
          <select
            id="inv-customer"
            value={invoiceForm.customer_id}
            onChange={(e) => handleInvoiceCustomerSelect(e.target.value)}
            className="w-full h-10 lg:h-9 border border-line rounded-md px-3 lg:px-2 bg-white text-sm lg:text-xs"
          >
            <option value="">Select customer...</option>
            {customers.map((customer) => (
              <option key={customer._id} value={String(customer._id)}>{customer.full_name}</option>
            ))}
          </select>
          {invoiceFormErrors.customer && (
            <p className="mt-1 text-xs text-critical">{invoiceFormErrors.customer}</p>
          )}
        </div>

        <div>
          <Label htmlFor="inv-work-order">Work Order (optional)</Label>
          <select
            id="inv-work-order"
            value={invoiceForm.work_order_id}
            onChange={(e) => handleInvoiceWorkOrderSelect(e.target.value)}
            className="w-full h-10 lg:h-9 border border-line rounded-md px-3 lg:px-2 bg-white text-sm lg:text-xs"
          >
            <option value="">No linked work order</option>
            {invoiceWorkOrderOptions.map((order) => (
              <option key={order._id} value={String(order._id)}>
                {order.title} ({order.status.replace("_", " ")})
              </option>
            ))}
          </select>
          {invoiceForm.customer_id && invoiceWorkOrderOptions.length === 0 && (
            <p className="mt-1 text-xs text-ink-muted">No work orders found for this customer yet.</p>
          )}
        </div>

        <div>
          <Label htmlFor="inv-description">Description</Label>
          <Input
            id="inv-description"
            value={invoiceForm.description}
            onChange={(e) => setInvoiceForm((prev) => ({ ...prev, description: e.target.value }))}
            className="h-10 lg:h-9 text-sm lg:text-xs"
            placeholder="Monthly service / repair / clean-up"
          />
          {invoiceFormErrors.description && (
            <p className="mt-1 text-xs text-critical">{invoiceFormErrors.description}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="inv-qty">Qty</Label>
            <Input
              id="inv-qty"
              value={invoiceForm.quantity}
              onChange={(e) => setInvoiceForm((prev) => ({ ...prev, quantity: e.target.value }))}
              className="h-10 lg:h-9 text-sm lg:text-xs"
            />
            {invoiceFormErrors.quantity && (
              <p className="mt-1 text-xs text-critical">{invoiceFormErrors.quantity}</p>
            )}
          </div>
          <div>
            <Label htmlFor="inv-price">Unit $</Label>
            <Input
              id="inv-price"
              value={invoiceForm.unit_price}
              onChange={(e) => setInvoiceForm((prev) => ({ ...prev, unit_price: e.target.value }))}
              className="h-10 lg:h-9 text-sm lg:text-xs"
            />
            {invoiceFormErrors.unitPrice && (
              <p className="mt-1 text-xs text-critical">{invoiceFormErrors.unitPrice}</p>
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
              className="h-10 lg:h-9 text-sm lg:text-xs"
              placeholder="8.25 or 0.0825"
            />
            <p className="mt-1 text-xs text-ink-muted">Enter 8.25 for 8.25% tax.</p>
          </div>
          <div>
            <Label htmlFor="inv-due">Due Date</Label>
            <Input
              id="inv-due"
              type="date"
              value={invoiceForm.due_date}
              onChange={(e) => setInvoiceForm((prev) => ({ ...prev, due_date: e.target.value }))}
              className="h-10 lg:h-9 text-sm lg:text-xs"
            />
            {invoiceFormErrors.dueDate && (
              <p className="mt-1 text-xs text-critical">{invoiceFormErrors.dueDate}</p>
            )}
          </div>
        </div>

        <Button
          type="submit"
          className="w-full h-11 lg:h-8 text-sm lg:text-xs"
          disabled={isCreatingInvoice || Object.values(invoiceFormErrors).some(Boolean)}
        >
          {isCreatingInvoice ? "Creating..." : "Create Invoice Draft"}
        </Button>
      </form>

      <div className="mb-4 rounded-md border border-line bg-surface-2 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Batch Invoicing</p>
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={handleBatchCreateInvoices}
            disabled={isBatchInvoicing || Object.values(batchInvoiceErrors).some(Boolean)}
          >
            {isBatchInvoicing ? "Processing..." : "Run Batch"}
          </Button>
        </div>
        <p className="text-xs text-ink-secondary">
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
              className="h-10 lg:h-8 text-sm lg:text-xs"
            />
          </div>
          <div>
            <Label htmlFor="batch-to" className="text-xs">To</Label>
            <Input
              id="batch-to"
              type="date"
              value={batchInvoiceForm.to_date}
              onChange={(e) => setBatchInvoiceForm((prev) => ({ ...prev, to_date: e.target.value }))}
              className="h-10 lg:h-8 text-sm lg:text-xs"
            />
          </div>
          <div>
            <Label htmlFor="batch-unit" className="text-xs">Unit $</Label>
            <Input
              id="batch-unit"
              value={batchInvoiceForm.unit_price}
              onChange={(e) => setBatchInvoiceForm((prev) => ({ ...prev, unit_price: e.target.value }))}
              className="h-10 lg:h-8 text-sm lg:text-xs"
            />
          </div>
          <div>
            <Label htmlFor="batch-tax" className="text-xs">Tax Rate</Label>
            <Input
              id="batch-tax"
              value={batchInvoiceForm.tax_rate}
              onChange={(e) => setBatchInvoiceForm((prev) => ({ ...prev, tax_rate: e.target.value }))}
              className="h-10 lg:h-8 text-sm lg:text-xs"
              placeholder="8.25 or 0.0825"
            />
          </div>
          <div>
            <Label htmlFor="batch-due" className="text-xs">Due In Days</Label>
            <Input
              id="batch-due"
              value={batchInvoiceForm.due_in_days}
              onChange={(e) => setBatchInvoiceForm((prev) => ({ ...prev, due_in_days: e.target.value }))}
              className="h-10 lg:h-8 text-sm lg:text-xs"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <Checkbox
                checked={batchInvoiceForm.auto_send}
                onCheckedChange={(checked) => setBatchInvoiceForm((prev) => ({ ...prev, auto_send: !!checked }))}
              />
              Auto-send after draft
            </label>
          </div>
        </div>
        {batchInvoiceErrors.dateRange && (
          <p className="text-xs text-critical">{batchInvoiceErrors.dateRange}</p>
        )}
        {batchInvoiceErrors.unitPrice && (
          <p className="text-xs text-critical">{batchInvoiceErrors.unitPrice}</p>
        )}
        {batchInvoiceErrors.dueDays && (
          <p className="text-xs text-critical">{batchInvoiceErrors.dueDays}</p>
        )}
      </div>

      <div className="rounded-md border border-line bg-surface-2 p-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Reminder Autopilot</p>
            <p className="text-xs text-ink-secondary">
              Auto-queues unpaid reminders on a fixed interval.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-secondary">
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
              className="h-10 lg:h-8 text-sm lg:text-xs"
              inputMode="numeric"
              disabled={!reminderAutopilotEnabled}
            />
          </div>
          <div className="text-xs text-ink-secondary">
            Next run: {reminderAutopilotEnabled
              ? (formatTimestamp(reminderAutopilotNextRunAt) || "Scheduling...")
              : "Autopilot disabled"}
            {isReminderAutopilotRunning ? " (running now)" : ""}
          </div>
        </div>
      </div>
    </div>
  );

  const mobileCreateDrawerTitle = useMemo(() => {
    switch (activeSection) {
      case "dispatch": return "Create Work Order";
      case "quotes": return "Create Quote";
      case "invoices": return "Create Invoice";
      default: return "Create";
    }
  }, [activeSection]);

  const handleEmptyStateCreate = () => {
    if (window.innerWidth < 1024) {
      setMobileCreateDrawerOpen(true);
    } else {
      woTitleRef.current?.focus();
    }
  };

  const hideOverviewPanelsOnMobile = activeSection !== "dispatch";

  if (workOrdersCloudState !== "ready") {
    return <WorkOrdersAvailability state={workOrdersCloudState} />;
  }

  return (
    <div className="relative mx-auto w-full max-w-7xl px-3 pb-28 pt-4 font-sans space-y-4 sm:px-6 sm:space-y-6 lg:px-8">
      <div className="overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card ">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">Dispatch board</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-semibold leading-tight tracking-[-0.045em] text-ink sm:text-4xl">
              <PoolIcon name="workOrders" className="h-7 w-7 text-brand-ink" />
              Work Orders & Dispatch
            </h1>
            <p className="mt-1 max-w-2xl text-sm font-medium text-ink-muted">
              Build dispatch, quotes, and invoicing in one flow for solo operators and small teams.
            </p>
          </div>
          {cloudEnabled ? (
            <p className="rounded-full border border-[var(--status-ok-line)] bg-[var(--status-ok-soft)] px-3 py-1.5 text-xs font-semibold text-ok">
              Cloud mode active
            </p>
          ) : (
            <p className="rounded-full border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-3 py-1.5 text-xs font-semibold text-watch">
              Local mode active
            </p>
          )}
        </div>
      </div>

      <Card className="rounded-sheet border border-line bg-surface-1 p-2.5 shadow-card sm:p-4">
        <div className="flex flex-col gap-2.5 sm:gap-3 lg:flex-row lg:items-center lg:justify-between">
          {workOrdersSplitEnabled ? (
            <div className="inline-flex w-full overflow-x-auto rounded-full border border-line bg-surface-1 p-1 lg:w-auto">
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
                  className={`flex-1 shrink-0 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-all sm:px-3 sm:text-sm lg:flex-none ${
                    activeSection === section.id
                      ? "bg-brand text-white shadow-cta"
                      : "text-ink-secondary hover:bg-brand-softer hover:text-ink"
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-secondary bg-surface-2 border border-line rounded-lg px-3 py-2 self-start">
              Work Orders IA split is disabled. Showing dispatch view.
            </p>
          )}
        </div>
      </Card>

      {activeSection === "dispatch" && (
      <Card className="rounded-sheet border border-line bg-surface-1 p-3 shadow-card sm:p-6">
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
          <div className="flex items-center gap-2 text-xs sm:text-sm text-ink-secondary">
            <CalendarClock className="w-4 h-4 text-brand-ink" />
            {workOrders.length} work order{workOrders.length === 1 ? "" : "s"} on {selectedDate}
          </div>
        </div>
      </Card>
      )}

      <div className={`${hideOverviewPanelsOnMobile ? "hidden sm:grid" : "grid"} grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3`}>
        <Card className="p-2.5 sm:p-3">
          <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Open Quotes</p>
          <p className="text-xl sm:text-2xl font-semibold text-ink">{dashboardMetrics.openQuotes}</p>
        </Card>
        <Card className="p-2.5 sm:p-3">
          <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Pending Deposits</p>
          <p className={`text-xl sm:text-2xl font-semibold ${dashboardMetrics.pendingDeposits > 0 ? "text-watch" : "text-ink"}`}>
            {dashboardMetrics.pendingDeposits}
          </p>
        </Card>
        <Card className="p-2.5 sm:p-3">
          <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Unpaid Invoices</p>
          <p className={`text-xl sm:text-2xl font-semibold ${dashboardMetrics.unpaidInvoices > 0 ? "text-info" : "text-ink"}`}>
            {dashboardMetrics.unpaidInvoices}
          </p>
        </Card>
        <Card className="p-2.5 sm:p-3">
          <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Overdue Invoices</p>
          <p className={`text-xl sm:text-2xl font-semibold ${dashboardMetrics.overdueInvoices > 0 ? "text-critical" : "text-ink"}`}>
            {dashboardMetrics.overdueInvoices}
          </p>
        </Card>
      </div>

      <Card className={`${hideOverviewPanelsOnMobile ? "hidden sm:block" : "block"} p-3 sm:p-5`}>
        <div
          className="flex items-center justify-between gap-2 sm:gap-3 mb-0 sm:mb-3 cursor-pointer sm:cursor-default"
          onClick={() => setMobileBillingExpanded((prev) => !prev)}
        >
          <h2 className="text-xs sm:text-base font-bold tracking-tight text-ink">Billing Reliability</h2>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs sm:text-xs px-2 py-1 rounded-full font-medium ${
                billingHealth.totalIssues > 0
                  ? "bg-[var(--status-watch-soft)] text-watch"
                  : "bg-[var(--status-ok-soft)] text-ok"
              }`}
            >
              {billingHealth.totalIssues > 0 ? `${billingHealth.totalIssues} issue${billingHealth.totalIssues === 1 ? "" : "s"}` : "Healthy"}
            </span>
            <span className="sm:hidden text-xs text-ink-muted">
              {mobileBillingExpanded ? "▲" : "▼"}
            </span>
          </div>
        </div>
        <div className="hidden sm:grid grid-cols-5 gap-2">
          <div className="rounded-md border border-line p-2">
            <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Failed Sends</p>
            <p className={`text-base sm:text-lg font-semibold ${billingHealth.failedDeliveries > 0 ? "text-critical" : "text-ink"}`}>
              {billingHealth.failedDeliveries}
            </p>
          </div>
          <div className="rounded-md border border-line p-2">
            <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Stuck Queue</p>
            <p className={`text-base sm:text-lg font-semibold ${billingHealth.queuedStale > 0 ? "text-watch" : "text-ink"}`}>
              {billingHealth.queuedStale}
            </p>
          </div>
          <div className="rounded-md border border-line p-2">
            <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Old Drafts</p>
            <p className={`text-base sm:text-lg font-semibold ${billingHealth.staleDrafts > 0 ? "text-info" : "text-ink"}`}>
              {billingHealth.staleDrafts}
            </p>
          </div>
          <div className="rounded-md border border-line p-2">
            <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Missing Pay Link</p>
            <p className={`text-base sm:text-lg font-semibold ${billingHealth.sentMissingPayLink > 0 ? "text-critical" : "text-ink"}`}>
              {billingHealth.sentMissingPayLink}
            </p>
          </div>
          <div className="rounded-md border border-line p-2">
            <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">30+ Days Unpaid</p>
            <p className={`text-base sm:text-lg font-semibold ${billingHealth.unpaidThirtyPlus > 0 ? "text-critical" : "text-ink"}`}>
              {billingHealth.unpaidThirtyPlus}
            </p>
          </div>
        </div>
        <div className="sm:hidden">
          {!mobileBillingExpanded ? (
            <p className="text-xs text-ink-secondary">
              {billingHealth.totalIssues > 0
                ? `${billingHealth.totalIssues} issue${billingHealth.totalIssues === 1 ? "" : "s"} - tap to expand`
                : "All billing health checks are clear."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-line p-2">
                <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Failed Sends</p>
                <p className={`text-base sm:text-lg font-semibold ${billingHealth.failedDeliveries > 0 ? "text-critical" : "text-ink"}`}>
                  {billingHealth.failedDeliveries}
                </p>
              </div>
              <div className="rounded-md border border-line p-2">
                <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Stuck Queue</p>
                <p className={`text-base sm:text-lg font-semibold ${billingHealth.queuedStale > 0 ? "text-watch" : "text-ink"}`}>
                  {billingHealth.queuedStale}
                </p>
              </div>
              <div className="rounded-md border border-line p-2">
                <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Old Drafts</p>
                <p className={`text-base sm:text-lg font-semibold ${billingHealth.staleDrafts > 0 ? "text-info" : "text-ink"}`}>
                  {billingHealth.staleDrafts}
                </p>
              </div>
              <div className="rounded-md border border-line p-2">
                <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">Missing Pay Link</p>
                <p className={`text-base sm:text-lg font-semibold ${billingHealth.sentMissingPayLink > 0 ? "text-critical" : "text-ink"}`}>
                  {billingHealth.sentMissingPayLink}
                </p>
              </div>
              <div className="rounded-md border border-line p-2">
                <p className="text-xs sm:text-xs uppercase tracking-wide text-ink-muted">30+ Days Unpaid</p>
                <p className={`text-base sm:text-lg font-semibold ${billingHealth.unpaidThirtyPlus > 0 ? "text-critical" : "text-ink"}`}>
                  {billingHealth.unpaidThirtyPlus}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-6">
        {activeSection === "dispatch" && (
        <div className="hidden lg:block">
          <Card className="p-4 sm:p-5">
            {workOrderCreateForm}
          </Card>
        </div>
        )}

        {activeSection === "quotes" && (
        <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-4 border-b border-line pb-2">
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-ink" />
                Quotes
              </h2>
            </div>

            <div className="hidden lg:block mb-4 pb-4 border-b border-line">
              {quoteCreateForm}
            </div>

            <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <Input
                value={quoteSearchTerm}
                onChange={(e) => setQuoteSearchTerm(e.target.value)}
                className="h-10 sm:h-8 text-sm sm:text-xs"
                placeholder="Search quotes by title, customer, or notes"
              />
              <select
                value={quoteStatusFilter}
                onChange={(e) => setQuoteStatusFilter(e.target.value)}
                className="h-10 sm:h-8 border border-line rounded-md px-3 sm:px-2 text-sm sm:text-xs bg-white sm:w-[170px]"
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
                <p className="text-sm text-ink-muted">No quotes match your filters.</p>
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
                  <div key={quote._id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm text-ink">{quote.title}</p>
                        <p className="text-xs text-ink-secondary">{customer?.full_name || "Customer"}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${quoteStatusBadgeClass(quote.status)}`}>
                        {quote.status}
                      </span>
                    </div>
                    <p className="text-xs text-ink-secondary">Total: ${quote.total.toFixed(2)}</p>
                    {quote.deposit_required && quote.deposit_required > 0 && (
                      <p className="text-xs text-ink-muted">
                        Deposit: ${quote.deposit_required.toFixed(2)} ({quote.deposit_status || "pending"})
                      </p>
                    )}
                    {quote.deposit_status === "paid" && (
                      <p className="text-xs text-ok">
                        Paid via {formatDepositSource(quote.deposit_paid_source) || "Recorded payment"}
                        {quote.deposit_paid_at ? ` on ${formatTimestamp(quote.deposit_paid_at)}` : ""}
                      </p>
                    )}
                    {quote.deposit_payment_url && (
                      <p className="text-xs text-info truncate">Deposit URL: {quote.deposit_payment_url}</p>
                    )}
                    {!canSendToCustomer && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-1">
                        <p className="text-xs text-critical">Add a valid customer phone or email to send deposit links.</p>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1">
                          <Button
                            variant="outline"
                            className="h-11 sm:h-6 text-sm sm:text-xs px-2 w-full sm:w-auto"
                            onClick={() => openAlternateRecipientEditor("quote", quote._id, customer)}
                          >
                            Use Alternate
                          </Button>
                          <Button
                            variant="outline"
                            className="h-11 sm:h-6 text-sm sm:text-xs px-2 w-full sm:w-auto"
                            onClick={() => handleFixCustomerContact(quote.customer_id)}
                          >
                            Fix Contact
                          </Button>
                        </div>
                      </div>
                    )}
                    {isQuoteAlternateOpen && (
                      <div className="mt-2 rounded-md border border-line bg-surface-2 p-2 space-y-2">
                        <p className="text-xs text-ink-secondary">Send to alternate recipient</p>
                        <div className="flex items-center gap-2">
                          <select
                            value={alternateRecipientEditor.channel}
                            onChange={(e) => setAlternateRecipientEditor((prev) => ({ ...prev, channel: e.target.value }))}
                            className="h-10 sm:h-8 border border-line rounded-md px-3 sm:px-2 text-sm sm:text-xs bg-white"
                          >
                            <option value="email">Email</option>
                            <option value="sms">SMS</option>
                          </select>
                          <Input
                            value={alternateRecipientEditor.recipient}
                            onChange={(e) => setAlternateRecipientEditor((prev) => ({ ...prev, recipient: e.target.value }))}
                            placeholder={alternateRecipientEditor.channel === "sms" ? "(555) 123-4567" : "name@example.com"}
                            className="h-10 sm:h-8 text-sm sm:text-xs"
                          />
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <Button
                            className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                            disabled={
                              quoteIsBusy
                              || !isValidRecipientForChannel(alternateRecipientEditor.channel, alternateRecipientEditor.recipient.trim())
                            }
                            onClick={() => handleSendDepositLinkWithAlternateRecipient(quote)}
                          >
                            {quoteIsBusy ? "Sending..." : "Send Deposit Link"}
                          </Button>
                          <Button
                            variant="outline"
                            className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                            onClick={closeAlternateRecipientEditor}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    {depositPending && (
                      <p className="text-xs text-watch">Deposit required before convert or invoice.</p>
                    )}
                    {quote.valid_until && (
                      <p className="text-xs text-ink-muted">Valid until: {quote.valid_until}</p>
                    )}
                    {quote.converted_work_order_id && (
                      <p className="text-xs text-ok">Converted to work order.</p>
                    )}
                    {linkedInvoice && (
                      <p className="text-xs text-info">
                        Invoice: {linkedInvoice.status}
                      </p>
                    )}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-2">
                      {quote.status === "draft" && (
                        <Button
                          className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                          disabled={quoteIsBusy}
                          onClick={() => handleQuoteStatusChange(quote, "sent")}
                        >
                          {quoteIsBusy ? "Saving..." : "Send"}
                        </Button>
                      )}
                      {quote.status === "sent" && (
                        <>
                          <Button
                            className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                            disabled={quoteIsBusy}
                            onClick={() => handleQuoteStatusChange(quote, "approved")}
                          >
                            {quoteIsBusy ? "Saving..." : "Approve"}
                          </Button>
                          <Button
                            variant="outline"
                            className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                            disabled={quoteIsBusy}
                            onClick={() => handleQuoteStatusChange(quote, "declined")}
                          >
                            {quoteIsBusy ? "Saving..." : "Decline"}
                          </Button>
                        </>
                      )}
                      {quote.status !== "declined" && quote.deposit_required > 0 && quote.deposit_status !== "paid" && (
                        <Button
                          variant="outline"
                          className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                          disabled={quoteIsBusy}
                          onClick={() => handleMarkDepositPaid(quote)}
                        >
                          {quoteIsBusy ? "Saving..." : "Mark Deposit Paid"}
                        </Button>
                      )}
                      {canCreateDepositLink && (
                        <Button
                          variant="outline"
                          className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                          disabled={quoteIsBusy || !canSendToCustomer}
                          onClick={() => handleCreateDepositLink(quote)}
                        >
                          {quoteIsBusy ? "Creating..." : "Create Deposit Link"}
                        </Button>
                      )}
                      {hasDepositLink && quote.deposit_status !== "paid" && (
                        <Button
                          variant="outline"
                          className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                          onClick={() => window.open(quote.deposit_payment_url, "_blank", "noopener,noreferrer")}
                        >
                          Open Deposit Link
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                        type="button"
                        onClick={() => handleDownloadQuotePdf(quote)}
                      >
                        <FileDown className="w-3.5 h-3.5 mr-1" />
                        PDF
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                        type="button"
                        onClick={() => handleUseQuoteTemplate(quote)}
                      >
                        Use Template
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                        disabled={quoteIsBusy}
                        onClick={() => handleDuplicateQuote(quote)}
                      >
                        {quoteIsBusy ? "Copying..." : "Duplicate"}
                      </Button>
                      {canConvert && (
                        <Button
                          variant="outline"
                          className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                          disabled={quoteIsBusy}
                          onClick={() => handleConvertQuote(quote)}
                        >
                          {quoteIsBusy ? "Converting..." : "Convert"}
                        </Button>
                      )}
                      {canDraftInvoice && (
                        <Button
                          variant="outline"
                          className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                          disabled={quoteIsBusy}
                          onClick={() => handleCreateInvoiceFromQuote(quote)}
                        >
                          {quoteIsBusy ? "Creating..." : "Draft Invoice"}
                        </Button>
                      )}
                      {depositPending && (
                        <Button
                          variant="outline"
                          className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 border-b border-line pb-2">
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-ok" />
                Invoices
              </h2>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 sm:h-8 text-sm sm:text-xs"
                  onClick={handleQueueReminders}
                  disabled={isQueueingReminders}
                >
                  {isQueueingReminders ? "Queueing..." : "Queue Reminders"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 sm:h-8 text-sm sm:text-xs"
                  onClick={handleRetryFailedCommunications}
                  disabled={isRetryingFailedCommunications || failedCommunications.length === 0}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  {isRetryingFailedCommunications
                    ? "Retrying..."
                    : `Retry Failed${failedCommunications.length > 0 ? ` (${failedCommunications.length})` : ""}`}
                </Button>
              </div>
            </div>

            <div className="hidden lg:block">
              {invoiceCreatePanel}
            </div>

            <div className="mb-4 rounded-md border border-line bg-surface-2 p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Month-End Close</p>
                  <p className="text-xs text-ink-secondary">
                    Quick close summary for invoices created in the selected month.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
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
                <p className="text-xs text-ink-secondary">{monthCloseSummary.label}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-line bg-white p-2">
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Billed</p>
                  <p className="text-sm font-semibold text-ink">${monthCloseSummary.billedTotal.toFixed(2)}</p>
                </div>
                <div className="rounded-md border border-line bg-white p-2">
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Collected</p>
                  <p className="text-sm font-semibold text-ok">${monthCloseSummary.collectedTotal.toFixed(2)}</p>
                </div>
                <div className="rounded-md border border-line bg-white p-2">
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Outstanding</p>
                  <p className={`text-sm font-semibold ${monthCloseSummary.outstandingTotal > 0 ? "text-critical" : "text-ink"}`}>
                    ${monthCloseSummary.outstandingTotal.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-md border border-line bg-white p-2">
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Invoices</p>
                  <p className="text-sm font-semibold text-ink">
                    {monthCloseSummary.createdInMonth.length} total / {monthCloseSummary.paidInMonth.length} paid
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <Input
                value={invoiceSearchTerm}
                onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                className="h-10 sm:h-8 text-sm sm:text-xs"
                placeholder="Search invoices by customer, notes, or line item"
              />
              <select
                value={invoiceStatusFilter}
                onChange={(e) => setInvoiceStatusFilter(e.target.value)}
                className="h-10 sm:h-8 border border-line rounded-md px-3 sm:px-2 text-sm sm:text-xs bg-white sm:w-[160px]"
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
                <p className="text-sm text-ink-muted">No open invoices match your filters.</p>
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
                  <div key={invoice._id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm text-ink">{customer?.full_name || "Customer"}</p>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${invoiceStatusBadgeClass(invoice.status)}`}>
                        {invoice.status}
                      </span>
                    </div>
                    <p className="text-xs text-ink-secondary">Total: ${invoice.total.toFixed(2)}</p>
                    {primaryDescription && (
                      <p className="text-xs text-ink-muted truncate">Description: {primaryDescription}</p>
                    )}
                    {secondaryNotes && (
                      <p className="text-xs text-ink-muted truncate">Notes: {secondaryNotes}</p>
                    )}
                    {invoice.deposit_applied > 0 && (
                      <p className="text-xs text-ok">Deposit Applied: -${invoice.deposit_applied.toFixed(2)}</p>
                    )}
                    <p className="text-xs text-ink-muted">Due: {invoice.due_date || "Not set"}</p>
                    {invoice.payment_url && (
                      <p className="text-xs text-info truncate">Pay URL: {invoice.payment_url}</p>
                    )}
                    {!canSendToCustomer && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-1">
                        <p className="text-xs text-critical">Add a valid customer phone or email before sending this invoice.</p>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-11 sm:h-6 text-sm sm:text-xs px-2"
                            onClick={() => openAlternateRecipientEditor("invoice", invoice._id, customer)}
                          >
                            Use Alternate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-11 sm:h-6 text-sm sm:text-xs px-2"
                            onClick={() => handleFixCustomerContact(invoice.customer_id)}
                          >
                            Fix Contact
                          </Button>
                        </div>
                      </div>
                    )}
                    {isInvoiceAlternateOpen && (
                      <div className="mt-2 rounded-md border border-line bg-surface-2 p-2 space-y-2">
                        <p className="text-xs text-ink-secondary">Send to alternate recipient</p>
                        <div className="flex items-center gap-2">
                          <select
                            value={alternateRecipientEditor.channel}
                            onChange={(e) => setAlternateRecipientEditor((prev) => ({ ...prev, channel: e.target.value }))}
                            className="h-10 sm:h-8 border border-line rounded-md px-3 sm:px-2 text-sm sm:text-xs bg-white"
                          >
                            <option value="email">Email</option>
                            <option value="sms">SMS</option>
                          </select>
                          <Input
                            value={alternateRecipientEditor.recipient}
                            onChange={(e) => setAlternateRecipientEditor((prev) => ({ ...prev, recipient: e.target.value }))}
                            placeholder={alternateRecipientEditor.channel === "sms" ? "(555) 123-4567" : "name@example.com"}
                            className="h-10 sm:h-8 text-sm sm:text-xs"
                          />
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <Button
                            size="sm"
                            className="h-11 sm:h-7 text-sm sm:text-xs"
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
                            className="h-11 sm:h-7 text-sm sm:text-xs"
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
                          <p className="text-xs text-ink-muted">
                            Deposit Paid: {formatTimestamp(relatedQuote.deposit_paid_at)}
                            {relatedQuote.deposit_paid_source ? ` (${formatDepositSource(relatedQuote.deposit_paid_source) || relatedQuote.deposit_paid_source})` : ""}
                          </p>
                        )}
                        {invoice.sent_at && (
                          <p className="text-xs text-ink-muted">Sent: {formatTimestamp(invoice.sent_at)}</p>
                        )}
                        {invoice.paid_at && (
                          <p className="text-xs text-ink-muted">Paid: {formatTimestamp(invoice.paid_at)}</p>
                        )}
                      </div>
                    )}
                    {stripeManaged && (
                      <p className="text-xs text-ink-muted mt-1">Awaiting Stripe payment confirmation.</p>
                    )}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-2">
                      {invoice.status === "draft" && (
                        <Button
                          className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                          disabled={invoiceActionId === invoice._id || !canSendToCustomer}
                          onClick={() => handleSendInvoice(invoice._id)}
                        >
                          {invoiceActionId === invoice._id ? "Sending..." : "Send"}
                        </Button>
                      )}
                      {invoice.status === "sent" && !stripeManaged && (
                        <Button
                          variant="outline"
                          className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                          disabled={invoiceActionId === invoice._id}
                          onClick={() => handleMarkPaid(invoice._id)}
                        >
                          {invoiceActionId === invoice._id ? "Saving..." : "Mark Paid"}
                        </Button>
                      )}
                      {invoice.status === "sent" && (
                        <Button
                          variant="outline"
                          className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                          disabled={invoiceActionId === invoice._id}
                          onClick={() => handleOpenPayLink(invoice)}
                        >
                          {invoiceActionId === invoice._id ? "Opening..." : "Open Pay Link"}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                        type="button"
                        onClick={() => handleDownloadInvoicePdf(invoice)}
                      >
                        <FileDown className="w-3.5 h-3.5 mr-1" />
                        PDF
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                        type="button"
                        onClick={() => handleUseInvoiceTemplate(invoice)}
                      >
                        Use Template
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
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

            <div className="mt-4 pt-4 border-t border-line">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">
                Paid / Completed
              </p>
              <div className="space-y-3 max-h-[220px] overflow-auto pr-1">
                {filteredPaidInvoices.length === 0 && (
                  <p className="text-sm text-ink-muted">No paid invoices match your filters.</p>
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
                    <div key={invoice._id} className="rounded-lg border border-[var(--status-ok-line)] bg-[var(--status-ok-soft)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm text-ink">{customer?.full_name || "Customer"}</p>
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-[var(--status-ok-soft)] text-ok">
                          paid
                        </span>
                      </div>
                      <p className="text-xs text-ink-secondary">Total: ${invoice.total.toFixed(2)}</p>
                      {primaryDescription && (
                        <p className="text-xs text-ink-muted truncate">Description: {primaryDescription}</p>
                      )}
                      {secondaryNotes && (
                        <p className="text-xs text-ink-muted truncate">Notes: {secondaryNotes}</p>
                      )}
                      {invoice.deposit_applied > 0 && (
                        <p className="text-xs text-ok">Deposit Applied: -${invoice.deposit_applied.toFixed(2)}</p>
                      )}
                      {relatedQuote?.deposit_paid_at && (
                        <p className="text-xs text-ink-muted">
                          Deposit Paid: {formatTimestamp(relatedQuote.deposit_paid_at)}
                          {relatedQuote.deposit_paid_source ? ` (${formatDepositSource(relatedQuote.deposit_paid_source) || relatedQuote.deposit_paid_source})` : ""}
                        </p>
                      )}
                      {invoice.paid_at && (
                        <p className="text-xs text-ink-muted">Paid: {formatTimestamp(invoice.paid_at)}</p>
                      )}
                      <div className="mt-2">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <Button
                            variant="outline"
                            className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                            type="button"
                            onClick={() => handleDownloadInvoicePdf(invoice)}
                          >
                            <FileDown className="w-3.5 h-3.5 mr-1" />
                            PDF
                          </Button>
                          <Button
                            variant="outline"
                            className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
                            type="button"
                            onClick={() => handleUseInvoiceTemplate(invoice)}
                          >
                            Use Template
                          </Button>
                          <Button
                            variant="outline"
                            className="h-11 sm:h-7 text-sm sm:text-xs w-full sm:w-auto"
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
            <div className="flex items-center justify-between gap-3 mb-4 border-b border-line pb-2">
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink">Communications</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-muted">
                  {queuedCommunications.length} queued
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
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
                <p className="text-sm text-ink-muted">No communication events yet.</p>
              )}
              {allCommunications.slice(0, 20).map((item) => (
                <div key={item._id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm text-ink">
                      {(item.template_key || item.type || "event").replaceAll("_", " ")}
                    </p>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${communicationStatusBadgeClass(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="text-xs text-ink-secondary">
                    {item.channel?.toUpperCase?.() || item.channel || "CHANNEL"} to {item.recipient}
                  </p>
                  <p className="text-xs text-ink-muted">{item.message}</p>
                  <div className="mt-1 space-y-0.5">
                    {item.provider && (
                      <p className="text-xs text-ink-muted">
                        Provider: {item.provider}
                        {item.provider_message_id ? ` (${item.provider_message_id})` : ""}
                      </p>
                    )}
                    {Number.isFinite(item.attempts) && (
                      <p className="text-xs text-ink-muted">Attempts: {item.attempts}</p>
                    )}
                    {item.last_attempt_at && (
                      <p className="text-xs text-ink-muted">Last Attempt: {formatTimestamp(item.last_attempt_at)}</p>
                    )}
                    {item.sent_at && (
                      <p className="text-xs text-ink-muted">Sent: {formatTimestamp(item.sent_at)}</p>
                    )}
                    {item.delivered_at && (
                      <p className="text-xs text-brand-ink">Delivered: {formatTimestamp(item.delivered_at)}</p>
                    )}
                    {item.error && (
                      <p className="text-xs text-critical">Error: {item.error}</p>
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
        <div className="flex items-center justify-between gap-3 mb-4 border-b border-line pb-2">
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink flex items-center gap-2">
            <PoolIcon name="workOrders" className="h-4 w-4 text-brand-ink" />
            Work Orders
          </h2>
          <span className="text-xs text-ink-muted">{workOrders.length} total</span>
        </div>

        <div className="space-y-3">
          {workOrders.length === 0 && (
            <div className="rounded-lg border border-dashed border-line bg-surface-2 p-8 text-center">
              <IconBadge name="workOrders" size="lg" className="mx-auto mb-4" iconClassName="h-6 w-6" />
              <h3 className="text-base font-semibold text-ink">No jobs scheduled</h3>
              <p className="mt-1 text-sm text-ink-secondary">
                Add your first work order for {selectedDate} to start dispatching.
              </p>
              <Button
                className="mt-4 h-11 sm:h-9 text-sm sm:text-xs"
                onClick={handleEmptyStateCreate}
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Work Order
              </Button>
            </div>
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
              <div key={order._id} className="border border-line rounded-lg p-3 space-y-3 bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink text-sm">{order.title}</p>
                    <p className="text-xs text-ink-secondary">{customer?.full_name || "Unknown customer"}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusBadgeClass(order.status)}`}>
                    {order.status.replace("_", " ")}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs text-ink-secondary">
                  <UserRound className="w-3.5 h-3.5" />
                  {order.assignee_email || "Unassigned"}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {linkedQuote && (
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${quoteStatusBadgeClass(linkedQuote.status)}`}>
                      Quote {linkedQuote.status}
                    </span>
                  )}
                  {linkedQuote && linkedQuote.deposit_required > 0 && (
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-medium ${
                        linkedQuote.deposit_status === "paid"
                          ? "bg-[var(--status-ok-soft)] text-ok"
                          : "bg-[var(--status-watch-soft)] text-watch"
                      }`}
                    >
                      Deposit {linkedQuote.deposit_status === "paid" ? "paid" : "pending"}
                    </span>
                  )}
                  {linkedInvoice && (
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${invoiceStatusBadgeClass(linkedInvoice.status)}`}>
                      Invoice {linkedInvoice.status}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <Select
                    value={order.assignee_email || ""}
                    onValueChange={(value) => handleAssigneeChange(order._id, value)}
                  >
                    <SelectTrigger aria-label={`Assignee for ${order.title || 'work order'}`} className="h-12 lg:h-9 text-sm lg:text-xs">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Unassigned</SelectItem>
                      {teamMembers.map((member) => (
                        <SelectItem key={member._id} value={member.user_email}>{member.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={order.status}
                    onValueChange={(value) => handleStatusChange(order._id, value)}
                  >
                    <SelectTrigger aria-label={`Status for ${order.title || 'work order'}`} className="h-12 lg:h-9 text-sm lg:text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  {!isWorkOrderCompleted(order.status) && (
                    <Button
                      className="h-11 sm:h-8 text-sm sm:text-xs w-full sm:w-auto"
                      onClick={() => handleComplete(order._id)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Complete
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    className="h-11 sm:h-8 text-sm sm:text-xs w-full sm:w-auto"
                    disabled={hasInvoice || quoteDepositPending}
                    onClick={() => handleQuickInvoiceFromWorkOrder(order)}
                  >
                    <DollarSign className="w-3.5 h-3.5 mr-1" />
                    {hasInvoice ? "Invoiced" : quoteDepositPending ? "Deposit Needed" : "Draft Invoice"}
                  </Button>

                  <Button
                    variant="outline"
                    className="h-11 sm:h-8 text-sm sm:text-xs w-full sm:w-auto text-critical border-[var(--status-critical-line)] hover:bg-[var(--status-critical-soft)]"
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

      {activeSection !== "comms" && !(activeSection === "dispatch" && workOrders.length === 0) && (
        <button
          type="button"
          onClick={() => setMobileCreateDrawerOpen(true)}
          className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-6 z-40 lg:hidden h-14 w-14 rounded-full bg-brand text-white shadow-cta hover:bg-brand-strong focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 flex items-center justify-center"
          aria-label={mobileCreateDrawerTitle}
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      <Drawer open={mobileCreateDrawerOpen} onOpenChange={setMobileCreateDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{mobileCreateDrawerTitle}</DrawerTitle>
            <DrawerDescription>
              {activeSection === "dispatch" && "Add a new work order for the selected dispatch date."}
              {activeSection === "quotes" && "Create a new quote draft for a customer."}
              {activeSection === "invoices" && "Create an invoice, run a batch, or configure autopilot."}
            </DrawerDescription>
          </DrawerHeader>
          <div className="p-4 max-h-[70vh] overflow-auto">
            {activeSection === "dispatch" && workOrderCreateForm}
            {activeSection === "quotes" && quoteCreateForm}
            {activeSection === "invoices" && invoiceCreatePanel}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function WorkOrdersAvailability({ state, error }) {
  const loading = state === "loading";
  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-2xl items-center px-4 sm:px-6">
      <Card className="w-full rounded-sheet border border-line bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-ink">{loading ? "Loading Work Orders" : "Work Orders is unavailable"}</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          {loading
            ? "Confirming your cloud business before loading financial records."
            : error || "Connect to a cloud business to view or change work orders, invoices, quotes, communications, reminders, and payment links."}
        </p>
      </Card>
    </div>
  );
}

class WorkOrdersErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <WorkOrdersAvailability state="unavailable" error="We could not load your cloud business. Work Orders is read-only until the connection is restored." />;
    }
    return this.props.children;
  }
}

export default function WorkOrders() {
  return (
    <WorkOrdersErrorBoundary>
      <WorkOrdersContent />
    </WorkOrdersErrorBoundary>
  );
}
