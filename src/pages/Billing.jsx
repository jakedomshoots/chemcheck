import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { createPageUrl } from "@/utils";
import { useCurrentUser, useCustomersFilter } from "@/api/convexHooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatBlock } from "@/components/ui/stat-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { IconBadge, PoolIcon } from "@/components/ui/iconography";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, FileDown, Plus, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { downloadInvoicePdf } from "@/lib/workOrderDocuments";

const INVOICE_FILTERS = Object.freeze([
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "draft", label: "Drafts" },
  { value: "all", label: "All" },
]);

function formatMoney(amount) {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function datePlusDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isInvoiceOverdue(invoice, today) {
  return invoice.status === "sent" && Boolean(invoice.due_date) && invoice.due_date < today;
}

function daysOverdue(invoice, today) {
  if (!invoice.due_date) return 0;
  const diff = new Date(`${today}T00:00:00Z`) - new Date(`${invoice.due_date}T00:00:00Z`);
  return Math.max(0, Math.round(diff / (24 * 60 * 60 * 1000)));
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function invoicePrimaryDescription(invoice) {
  const lineDescription = (Array.isArray(invoice?.line_items) ? invoice.line_items : [])
    .map((item) => String(item?.description || "").trim())
    .find(Boolean);
  return lineDescription || String(invoice?.notes || "").trim() || "Invoice";
}

function ordinalDay(day) {
  const d = Number(day) || 1;
  if (d >= 11 && d <= 13) return `${d}th`;
  switch (d % 10) {
    case 1: return `${d}st`;
    case 2: return `${d}nd`;
    case 3: return `${d}rd`;
    default: return `${d}th`;
  }
}

function InvoiceStatusChip({ invoice, today }) {
  if (invoice.status === "paid") {
    return <StatusBadge tone="ok" label="Paid" dot size="sm" />;
  }
  if (invoice.status === "cancelled") {
    return <StatusBadge tone="neutral" label="Cancelled" size="sm" />;
  }
  if (invoice.status === "draft") {
    return <StatusBadge tone="neutral" label="Draft" dot size="sm" />;
  }
  if (isInvoiceOverdue(invoice, today)) {
    return <StatusBadge tone="critical" label={`Overdue ${daysOverdue(invoice, today)}d`} dot size="sm" />;
  }
  return <StatusBadge tone="info" label="Sent" dot size="sm" />;
}

export function StandingChip({ standing, overdueDays }) {
  if (standing === "overdue") {
    return <StatusBadge tone="critical" label={overdueDays > 0 ? `Overdue ${overdueDays}d` : "Overdue"} dot size="sm" />;
  }
  if (standing === "due_soon") {
    return <StatusBadge tone="watch" label="Due soon" dot size="sm" />;
  }
  return <StatusBadge tone="ok" label="Up to date" dot size="sm" />;
}

function EmptyState({ title, body, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface-1 px-6 py-10 text-center">
      <IconBadge name="billing" size="lg" tone="slate" className="mx-auto mb-4" iconClassName="h-7 w-7" />
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm font-medium leading-6 text-ink-secondary">{body}</p>
      {action}
    </div>
  );
}

export default function Billing() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const today = useMemo(() => todayString(), []);

  const overview = useQuery(api.invoices.getBillingOverview);
  const invoicePage = useQuery(api.invoices.list, { numItems: 200 });
  const plans = useQuery(api.servicePlans.list);
  const providerStatus = useQuery(api.providerConfig.getStatus);
  const customers = useCustomersFilter(user?.email ? { created_by: user.email } : undefined) ?? [];

  const createInvoiceDraft = useMutation(api.invoices.createDraft);
  const updateInvoiceStatus = useMutation(api.invoices.updateStatus);
  const markInvoicePaid = useMutation(api.invoices.markPaid);
  const sendInvoiceWithStripe = useAction(api.payments.sendInvoiceWithStripe);
  const syncCheckoutSessionStatus = useAction(api.payments.syncCheckoutSessionStatus);
  const createPlan = useMutation(api.servicePlans.create);
  const setPlanStatus = useMutation(api.servicePlans.setStatus);
  const removePlan = useMutation(api.servicePlans.remove);

  const [activeTab, setActiveTab] = useState("invoices");
  const [invoiceFilter, setInvoiceFilter] = useState("open");
  const [customerSearch, setCustomerSearch] = useState("");
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planPendingDelete, setPlanPendingDelete] = useState(null);
  const [busyAction, setBusyAction] = useState(null);

  // Handle the return from Stripe Checkout (payment link success/cancel).
  useEffect(() => {
    let cancelled = false;

    const handleStripeReturn = async () => {
      const url = new URL(window.location.href);
      const paymentStatus = url.searchParams.get("stripe_payment");
      const sessionId = url.searchParams.get("session_id");
      if (!paymentStatus) return;

      if (paymentStatus === "invoice_success") {
        if (sessionId) {
          try {
            const result = await syncCheckoutSessionStatus({ session_id: sessionId });
            if (cancelled) return;
            if (result?.success && result?.synced) {
              toast.success("Payment received and synced.");
            } else {
              toast.message("Payment received. Final confirmation may take a minute.");
            }
          } catch {
            if (!cancelled) {
              toast.message("Payment received. Final confirmation may take a minute.");
            }
          }
        } else {
          toast.success("Invoice payment received.");
        }
      } else if (paymentStatus === "invoice_cancel") {
        toast.message("Payment was cancelled.");
      }

      url.searchParams.delete("stripe_payment");
      url.searchParams.delete("invoice_id");
      url.searchParams.delete("session_id");
      const newQuery = url.searchParams.toString();
      window.history.replaceState({}, "", `${url.pathname}${newQuery ? `?${newQuery}` : ""}${url.hash}`);
    };

    void handleStripeReturn();
    return () => {
      cancelled = true;
    };
  }, [syncCheckoutSessionStatus]);

  const invoices = useMemo(() => invoicePage?.page ?? [], [invoicePage]);
  const customerNameById = useMemo(() => {
    const map = new Map();
    for (const customer of customers) {
      map.set(String(customer._id ?? customer.id), customer.full_name);
    }
    return map;
  }, [customers]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      switch (invoiceFilter) {
        case "open":
          return invoice.status === "sent";
        case "overdue":
          return isInvoiceOverdue(invoice, today);
        case "paid":
          return invoice.status === "paid";
        case "draft":
          return invoice.status === "draft";
        default:
          return invoice.status !== "cancelled";
      }
    });
  }, [invoices, invoiceFilter, today]);

  const filteredStandings = useMemo(() => {
    const standings = overview?.standings ?? [];
    const term = customerSearch.trim().toLowerCase();
    if (!term) return standings;
    return standings.filter((row) => row.customer_name.toLowerCase().includes(term));
  }, [overview, customerSearch]);

  const stats = overview?.stats;
  const billingReady = Boolean(providerStatus?.stripe?.ready && providerStatus?.mailersend?.ready);

  const handleCreateInvoice = async ({ customerId, description, amount, dueDate, send }) => {
    setBusyAction("create-invoice");
    try {
      const rounded = Number(amount.toFixed(2));
      const invoiceId = await createInvoiceDraft({
        customer_id: customerId,
        line_items: [{ description: description.trim(), quantity: 1, unit_price: rounded, amount: rounded }],
        due_date: dueDate || undefined,
        notes: description.trim(),
      });
      setInvoiceDialogOpen(false);

      if (send) {
        const result = await sendInvoiceWithStripe({ id: invoiceId });
        if (result?.payment_url) {
          toast.success("Invoice sent with a Stripe payment link.");
        } else {
          toast.success("Invoice sent.");
        }
      } else {
        toast.success("Draft invoice saved.");
      }
    } catch (error) {
      toast.error(error?.message || "Could not create the invoice.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendInvoice = async (invoice) => {
    setBusyAction(`send-${invoice._id}`);
    try {
      const result = await sendInvoiceWithStripe({ id: invoice._id });
      if (result?.payment_url) {
        await navigator.clipboard?.writeText(result.payment_url).catch(() => {});
        toast.success(result?.reused ? "Payment link copied." : "Invoice sent — payment link copied.");
      } else {
        toast.success("Invoice sent.");
      }
    } catch (error) {
      toast.error(error?.message || "Could not send the invoice.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyLink = async (invoice) => {
    if (!invoice.payment_url) return;
    try {
      await navigator.clipboard.writeText(invoice.payment_url);
      toast.success("Payment link copied.");
    } catch {
      toast.error("Could not copy the link.");
    }
  };

  const handleRecordPayment = async (invoice) => {
    setBusyAction(`paid-${invoice._id}`);
    try {
      await markInvoicePaid({ id: invoice._id });
      toast.success("Marked as paid.");
    } catch (error) {
      toast.error(error?.message || "Could not record payment.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancelInvoice = async (invoice) => {
    setBusyAction(`cancel-${invoice._id}`);
    try {
      await updateInvoiceStatus({ id: invoice._id, status: "cancelled" });
      toast.success("Invoice cancelled.");
    } catch (error) {
      toast.error(error?.message || "Could not cancel the invoice.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadPdf = (invoice) => {
    const customer = customers.find((entry) => String(entry._id ?? entry.id) === String(invoice.customer_id));
    const opened = downloadInvoicePdf({ invoice, customer });
    if (!opened) toast.error("Could not open the invoice PDF.");
  };

  const handleCreatePlan = async ({ customerId, label, amount, dayOfMonth, autoSend }) => {
    setBusyAction("create-plan");
    try {
      await createPlan({
        customer_id: customerId,
        label: label.trim(),
        amount,
        day_of_month: dayOfMonth,
        auto_send: autoSend,
      });
      setPlanDialogOpen(false);
      toast.success("Recurring plan created.");
    } catch (error) {
      toast.error(error?.message || "Could not create the plan.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleTogglePlan = async (plan) => {
    setBusyAction(`plan-${plan._id}`);
    try {
      await setPlanStatus({ id: plan._id, status: plan.status === "active" ? "paused" : "active" });
      toast.success(plan.status === "active" ? "Plan paused." : "Plan resumed.");
    } catch (error) {
      toast.error(error?.message || "Could not update the plan.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeletePlan = async () => {
    if (!planPendingDelete) return;
    setBusyAction(`plan-${planPendingDelete._id}`);
    try {
      await removePlan({ id: planPendingDelete._id });
      toast.success("Plan deleted.");
      setPlanPendingDelete(null);
    } catch (error) {
      toast.error(error?.message || "Could not delete the plan.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Billing">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Billing</h1>
          <p className="mt-1 text-sm font-medium text-ink-secondary">
            Invoices and recurring plans, collected through your Stripe account.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setPlanDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New plan
          </Button>
          <Button onClick={() => setInvoiceDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New invoice
          </Button>
        </div>
      </div>

      {providerStatus && !billingReady && (
        <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950" role="status">
          <p className="text-sm font-semibold">Billing setup needs attention</p>
          <p className="mt-1 text-xs font-medium leading-5">
            Drafts are available, but sending and auto-send stay off until Stripe and invoice email are configured.
            {providerStatus.stripe?.missing?.length ? ` Missing: ${providerStatus.stripe.missing.join(", ")}.` : ""}
          </p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
        <div className="rounded-2xl border border-line bg-surface-1">
          <StatBlock label="Outstanding" value={stats ? formatMoney(stats.outstanding_total) : "—"} icon="pending" tone="brand" />
        </div>
        <div className="rounded-2xl border border-line bg-surface-1">
          <StatBlock
            label="Overdue"
            value={stats ? formatMoney(stats.overdue_total) : "—"}
            icon="warning"
            tone={stats && stats.overdue_total > 0 ? "critical" : "neutral"}
          />
        </div>
        <div className="rounded-2xl border border-line bg-surface-1">
          <StatBlock label="Collected · 30 days" value={stats ? formatMoney(stats.collected_last_30_days) : "—"} icon="done" tone="ok" />
        </div>
        <div className="rounded-2xl border border-line bg-surface-1">
          <StatBlock label="Active plans" value={stats ? String(stats.active_plans) : "—"} icon="billing" tone="neutral" />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 grid w-full grid-cols-3 sm:max-w-md">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="recurring">Recurring</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Invoice filter">
            {INVOICE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setInvoiceFilter(filter.value)}
                aria-pressed={invoiceFilter === filter.value}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  invoiceFilter === filter.value
                    ? "bg-brand text-white"
                    : "bg-surface-2 text-ink-secondary hover:text-ink"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {filteredInvoices.length === 0 ? (
            <EmptyState
              title="No invoices here yet"
              body="Create a one-off invoice for a customer, or set up a recurring plan and let ChemCheck bill them every month."
              action={(
                <Button className="mt-4" onClick={() => setInvoiceDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  New invoice
                </Button>
              )}
            />
          ) : (
            <ul className="space-y-2">
              {filteredInvoices.map((invoice) => {
                const customerName = customerNameById.get(String(invoice.customer_id)) || "Customer";
                const canRecordPayment = invoice.status === "sent" && !invoice.stripe_checkout_session_id && !invoice.stripe_invoice_id;
                const canSend = invoice.status === "draft" || invoice.status === "sent";
                return (
                  <li
                    key={invoice._id}
                    className="rounded-2xl border border-line bg-surface-1 px-3 py-3 sm:px-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{customerName}</p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {invoicePrimaryDescription(invoice)}
                          {invoice.due_date ? ` · Due ${formatDate(invoice.due_date)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-data text-sm font-bold text-ink">{formatMoney(invoice.total)}</span>
                        <InvoiceStatusChip invoice={invoice} today={today} />
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {invoice.status === "draft" && (
                        <Button size="sm" onClick={() => handleSendInvoice(invoice)} disabled={busyAction !== null || !billingReady}>
                          <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          Send
                        </Button>
                      )}
                      {invoice.status === "sent" && invoice.payment_url && (
                        <Button size="sm" variant="outline" onClick={() => handleCopyLink(invoice)}>
                          <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          Copy link
                        </Button>
                      )}
                      {invoice.status === "sent" && !invoice.payment_url?.includes("stripe") && canSend && (
                        <Button size="sm" variant="outline" onClick={() => handleSendInvoice(invoice)} disabled={busyAction !== null || !billingReady}>
                          <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          Get Stripe link
                        </Button>
                      )}
                      {canRecordPayment && (
                        <Button size="sm" variant="outline" onClick={() => handleRecordPayment(invoice)} disabled={busyAction !== null}>
                          Record payment
                        </Button>
                      )}
                      {(invoice.status === "draft" || invoice.status === "sent") && (
                        <Button size="sm" variant="ghost" className="text-critical" onClick={() => handleCancelInvoice(invoice)} disabled={busyAction !== null}>
                          Cancel
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => handleDownloadPdf(invoice)}>
                        <FileDown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        PDF
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="recurring">
          {(plans ?? []).length === 0 ? (
            <EmptyState
              title="No recurring plans yet"
              body="Add a monthly plan for each service customer and ChemCheck will generate — and optionally send — their invoice automatically on the billing day."
              action={(
                <Button className="mt-4" onClick={() => setPlanDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  New plan
                </Button>
              )}
            />
          ) : (
            <ul className="space-y-2">
              {(plans ?? []).map((plan) => (
                <li
                  key={plan._id}
                  className="rounded-2xl border border-line bg-surface-1 px-3 py-3 sm:px-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{plan.customer_name}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        {plan.label} · Bills on the {ordinalDay(plan.day_of_month)}
                        {plan.status === "active" ? ` · Next ${formatDate(plan.next_run_date)}` : ""}
                      </p>
                      {plan.last_run_status === "failed" && (
                        <p className="mt-1 text-xs font-semibold text-critical">
                          Last run failed{plan.last_error ? `: ${plan.last_error}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-data text-sm font-bold text-ink">
                        {formatMoney(plan.amount)}
                        <span className="ml-0.5 text-xs font-medium text-ink-muted">/mo</span>
                      </span>
                      <StatusBadge
                        tone={plan.status === "active" ? "ok" : "neutral"}
                        label={plan.status === "active" ? (plan.auto_send ? "Active · auto-send" : "Active") : "Paused"}
                        dot
                        size="sm"
                      />
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => handleTogglePlan(plan)} disabled={busyAction !== null}>
                      {plan.status === "active" ? "Pause" : "Resume"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-critical"
                      onClick={() => setPlanPendingDelete(plan)}
                      disabled={busyAction !== null}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="customers">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <Input
              className="pl-9"
              placeholder="Search customers"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
              aria-label="Search customers"
            />
          </div>

          {filteredStandings.length === 0 ? (
            <EmptyState
              title="No customers to show"
              body={customerSearch ? "No customers match that search." : "Add customers from the Clients page, then their payment standing shows up here."}
            />
          ) : (
            <ul className="space-y-2">
              {filteredStandings.map((row) => (
                <li key={row.customer_id}>
                  <button
                    type="button"
                    onClick={() => navigate(createPageUrl("CustomerDetail") + `?id=${row.customer_id}`)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-1 px-3 py-3 text-left transition-colors hover:bg-surface-2 sm:px-4"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{row.customer_name}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {row.open_balance > 0 ? `${formatMoney(row.open_balance)} open` : "No open balance"}
                      </span>
                    </span>
                    <StandingChip standing={row.standing} overdueDays={row.overdue_days} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <NewInvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        customers={customers}
        onCreate={handleCreateInvoice}
        busy={busyAction !== null}
        billingReady={billingReady}
      />
      <NewPlanDialog
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        customers={customers}
        onCreate={handleCreatePlan}
        busy={busyAction !== null}
        billingReady={billingReady}
      />
      <AlertDialog open={Boolean(planPendingDelete)} onOpenChange={(open) => { if (!open) setPlanPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete recurring plan?</AlertDialogTitle>
            <AlertDialogDescription>
              {planPendingDelete
                ? `${planPendingDelete.customer_name} will stop being billed for "${planPendingDelete.label}". Invoices already sent are not affected.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep plan</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePlan}>Delete plan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function NewInvoiceDialog({ open, onOpenChange, customers, onCreate, busy, billingReady }) {
  const [customerId, setCustomerId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (open) {
      setCustomerId("");
      setDescription("");
      setAmount("");
      setDueDate(datePlusDays(14));
    }
  }, [open]);

  const parsedAmount = Number(amount);
  const canSubmit = Boolean(customerId) && description.trim().length > 0
    && Number.isFinite(parsedAmount) && parsedAmount > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>
            Bill a customer for one-off work. Send it with a Stripe payment link or save it as a draft.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invoice-customer">Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger id="invoice-customer">
                <SelectValue placeholder="Choose a customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer._id} value={String(customer._id)}>
                    {customer.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-description">Description</Label>
            <Input
              id="invoice-description"
              placeholder="Filter replacement, green-to-clean, heater repair…"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-amount">Amount</Label>
              <Input
                id="invoice-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="150.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-due">Due date</Label>
              <Input
                id="invoice-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" disabled={!canSubmit} onClick={() => onCreate({ customerId, description, amount: parsedAmount, dueDate, send: false })}>
            Save draft
          </Button>
          <Button disabled={!canSubmit || !billingReady} onClick={() => onCreate({ customerId, description, amount: parsedAmount, dueDate, send: true })}>
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            Create & send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewPlanDialog({ open, onOpenChange, customers, onCreate, busy, billingReady }) {
  const [customerId, setCustomerId] = useState("");
  const [label, setLabel] = useState("Monthly pool service");
  const [amount, setAmount] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [autoSend, setAutoSend] = useState(true);

  useEffect(() => {
    if (open) {
      setCustomerId("");
      setLabel("Monthly pool service");
      setAmount("");
      setDayOfMonth("1");
      setAutoSend(billingReady);
    }
  }, [open, billingReady]);

  const parsedAmount = Number(amount);
  const parsedDay = Number(dayOfMonth);
  const canSubmit = Boolean(customerId) && label.trim().length > 0
    && Number.isFinite(parsedAmount) && parsedAmount > 0
    && Number.isInteger(parsedDay) && parsedDay >= 1 && parsedDay <= 28 && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New recurring plan</DialogTitle>
          <DialogDescription>
            ChemCheck creates the invoice every month on the billing day and, with auto-send on,
            emails the customer a secure Stripe-hosted invoice.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="plan-customer">Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger id="plan-customer">
                <SelectValue placeholder="Choose a customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer._id} value={String(customer._id)}>
                    {customer.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-label">Description</Label>
            <Input
              id="plan-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-amount">Monthly amount</Label>
              <Input
                id="plan-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="150.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-day">Billing day (1–28)</Label>
              <Input
                id="plan-day"
                type="number"
                min="1"
                max="28"
                step="1"
                inputMode="numeric"
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(event.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface-2 px-3 py-2.5">
            <span className="text-sm font-medium text-ink">Auto-send invoice with payment link</span>
            <Switch checked={autoSend} onCheckedChange={setAutoSend} disabled={!billingReady} aria-label="Auto-send invoice" />
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={!canSubmit}
            onClick={() => onCreate({
              customerId,
              label,
              amount: parsedAmount,
              dayOfMonth: parsedDay,
              autoSend,
            })}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Create plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
