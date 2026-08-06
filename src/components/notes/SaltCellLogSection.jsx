import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, Droplets, Plus, Trash2, Zap } from "lucide-react";
import { db, getTodayDate } from "@/db/chemcheck-db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { toast } from "sonner";

const SERVICE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const conditionConfig = {
  good: {
    label: "Light Buildup",
    color: "text-ok",
    bg: "bg-[var(--status-ok-soft)]",
  },
  moderate: {
    label: "Moderate Buildup",
    color: "text-watch",
    bg: "bg-[var(--status-watch-soft)]",
  },
  heavy: {
    label: "Heavy Buildup",
    color: "text-critical",
    bg: "bg-[var(--status-critical-soft)]",
  },
};

const getCustomerId = (customer) => String(customer?.id ?? customer?._id ?? "");

const getServiceDay = (customer) => (
  SERVICE_DAYS.find((day) => day.toLowerCase() === customer?.service_day?.trim().toLowerCase()) || "Unscheduled"
);

const formatCleaningDate = (date) => {
  if (!date) return "Date unavailable";
  try {
    return format(parseISO(date), "MMM d, yyyy");
  } catch {
    return date;
  }
};

export function SaltCellLogSection({ customers = [] }) {
  const [expanded, setExpanded] = useState(false);
  const [activeDay, setActiveDay] = useState("Monday");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteLog, setDeleteLog] = useState(null);
  const [expandedCustomers, setExpandedCustomers] = useState(new Set());
  const [formData, setFormData] = useState({
    customer_id: "",
    cleaning_date: getTodayDate(),
    condition: "good",
    notes: "",
  });

  const saltCellLogs = useLiveQuery(
    () => db.saltCellLogs.orderBy("cleaning_date").reverse().toArray(),
    [],
    []
  );

  const saltPoolCustomers = useMemo(
    () => customers.filter((customer) => customer.pool_type?.toLowerCase() === "salt"),
    [customers]
  );

  const saltCustomerIds = useMemo(
    () => new Set(saltPoolCustomers.map(getCustomerId).filter(Boolean)),
    [saltPoolCustomers]
  );

  const visibleLogs = useMemo(
    () => saltCellLogs.filter((log) => saltCustomerIds.has(String(log.customer_id))),
    [saltCellLogs, saltCustomerIds]
  );

  const logsByCustomer = useMemo(() => {
    const grouped = new Map();
    visibleLogs.forEach((log) => {
      const customerId = String(log.customer_id);
      if (!grouped.has(customerId)) grouped.set(customerId, []);
      grouped.get(customerId).push(log);
    });
    return grouped;
  }, [visibleLogs]);

  const customersByDay = useMemo(() => {
    const grouped = new Map();
    saltPoolCustomers.forEach((customer) => {
      const day = getServiceDay(customer);
      if (!grouped.has(day)) grouped.set(day, []);
      grouped.get(day).push(customer);
    });
    return grouped;
  }, [saltPoolCustomers]);

  const availableDays = useMemo(
    () => [...SERVICE_DAYS, "Unscheduled"].filter((day) => customersByDay.has(day)),
    [customersByDay]
  );

  useEffect(() => {
    if (availableDays.length > 0 && !availableDays.includes(activeDay)) {
      setActiveDay(availableDays[0]);
    }
  }, [activeDay, availableDays]);

  const resetForm = () => {
    setFormData({
      customer_id: "",
      cleaning_date: getTodayDate(),
      condition: "good",
      notes: "",
    });
  };

  const openCleaningForm = (customer) => {
    setFormData({
      customer_id: getCustomerId(customer),
      cleaning_date: getTodayDate(),
      condition: "good",
      notes: "",
    });
    setShowForm(true);
  };

  const handleFormOpenChange = (open) => {
    setShowForm(open);
    if (!open && !saving) resetForm();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData.customer_id) return;
    setSaving(true);

    try {
      await db.saltCellLogs.add({
        customer_id: formData.customer_id,
        cleaning_date: formData.cleaning_date,
        condition: formData.condition,
        notes: formData.notes.trim() || undefined,
        sync_status: "pending",
        local_updated_at: Date.now(),
        createdAt: new Date().toISOString(),
      });

      setExpandedCustomers((current) => new Set([...current, formData.customer_id]));
      setShowForm(false);
      resetForm();
      toast.success("Salt cell cleaning logged");
    } catch (error) {
      console.error("[SaltCellLog] Could not save cleaning:", error);
      toast.error("Could not save the salt cell cleaning. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteLog) return;

    try {
      await db.saltCellLogs.delete(deleteLog.id);
      setDeleteLog(null);
      toast.success("Cleaning log deleted");
    } catch (error) {
      console.error("[SaltCellLog] Could not delete cleaning:", error);
      toast.error("Could not delete the cleaning log. Please try again.");
    }
  };

  const toggleCustomer = (customerId) => {
    setExpandedCustomers((current) => {
      const next = new Set(current);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  };

  if (saltPoolCustomers.length === 0) return null;

  return (
    <section className="mt-5 border-y border-line bg-surface-1" aria-labelledby="salt-cell-log-title">
      <header>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-controls="salt-cell-cleaning-list"
          aria-label={expanded ? "Collapse salt cell cleaning log" : "Expand salt cell cleaning log"}
          className="min-h-16 w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Zap className="h-5 w-5 shrink-0 text-brand-ink" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <h3 id="salt-cell-log-title" className="truncate text-sm font-semibold tracking-[-0.015em] text-ink">
                Salt Cell Cleanings
              </h3>
              <span className="mt-0.5 block truncate text-[0.6875rem] font-medium text-ink-muted">
                {saltPoolCustomers.length} salt pool{saltPoolCustomers.length === 1 ? "" : "s"} · by service day
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-1" aria-label={`${visibleLogs.length} salt cell cleaning logs`}>
              <span className="font-data text-sm font-semibold tabular-nums text-brand-ink">{visibleLogs.length}</span>
              <span className="text-[0.625rem] font-semibold text-ink-muted">
                {visibleLogs.length === 1 ? "log" : "logs"}
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </span>
        </button>
      </header>

      {expanded && (
        <div id="salt-cell-cleaning-list" className="border-t border-line">
          <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
            <div className="native-scroll overflow-x-auto border-b border-line p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              <TabsList
                data-testid="salt-cell-service-day-tabs"
                aria-label="Salt cell service day"
                className="grid h-12 w-max min-w-full grid-flow-col auto-cols-[minmax(4rem,1fr)] gap-1 rounded-control border border-line bg-surface-2 p-1"
              >
                {availableDays.map((day) => {
                  const count = customersByDay.get(day)?.length || 0;
                  return (
                    <TabsTrigger
                      key={day}
                      value={day}
                      aria-label={`${day}, ${count} salt ${count === 1 ? "pool" : "pools"}`}
                      className="group inline-flex h-10 min-w-16 items-center justify-center !rounded-chip px-2 text-sm font-semibold text-ink-muted transition-colors duration-150 hover:bg-surface-1 hover:text-ink-secondary active:scale-[0.98] data-[state=active]:bg-brand data-[state=active]:text-white data-[state=active]:shadow-sm"
                    >
                      <span>{day === "Unscheduled" ? "Other" : day.substring(0, 3)}</span>
                      {count > 0 && (
                        <span className="ml-1.5 min-w-3 text-center font-data text-xs font-semibold tabular-nums text-ink-secondary opacity-75 group-data-[state=active]:text-white group-data-[state=active]:opacity-90">
                          {count}
                        </span>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            {availableDays.map((day) => (
              <TabsContent key={day} value={day} className="mt-0">
                <ol className="divide-y divide-line" aria-label={`${day} salt cell cleaning list`}>
                  {(customersByDay.get(day) || []).map((customer) => {
                    const customerId = getCustomerId(customer);
                    const customerLogs = logsByCustomer.get(customerId) || [];
                    const latestLog = customerLogs[0];
                    const latestCondition = latestLog
                      ? conditionConfig[latestLog.condition] || conditionConfig.good
                      : null;
                    const customerExpanded = expandedCustomers.has(customerId);
                    const historyId = `salt-cell-history-${customerId}`;

                    return (
                      <li key={customerId}>
                        <div className="flex min-h-14 min-w-0 items-center gap-1.5 px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => openCleaningForm(customer)}
                            aria-label={`Log salt cell cleaning for ${customer.full_name}`}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-ink transition-colors hover:bg-brand-softer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-brand-softer"
                          >
                            <Plus className="h-5 w-5" aria-hidden="true" />
                          </button>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-ink">{customer.full_name || "Unnamed customer"}</p>
                            <p className={`mt-0.5 truncate text-[0.6875rem] font-semibold ${latestCondition?.color || "text-watch"}`}>
                              {latestLog
                                ? `${formatCleaningDate(latestLog.cleaning_date)} · ${latestCondition.label}`
                                : "No cleanings logged"}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleCustomer(customerId)}
                            aria-expanded={customerExpanded}
                            aria-controls={historyId}
                            aria-label={`${customerExpanded ? "Hide" : "Show"} cleaning history for ${customer.full_name}`}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-surface-2"
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform duration-150 motion-reduce:transition-none ${customerExpanded ? "rotate-180" : ""}`}
                              aria-hidden="true"
                            />
                          </button>
                        </div>

                        {customerExpanded && (
                          <div id={historyId} className="border-t border-line bg-surface-2">
                            {customerLogs.length > 0 ? (
                              <div className="divide-y divide-line">
                                {customerLogs.map((log) => {
                                  const condition = conditionConfig[log.condition] || conditionConfig.good;
                                  return (
                                    <div key={log.id} className="flex min-h-14 items-center gap-2 px-3 py-2 pl-14">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className="truncate text-xs font-semibold text-ink">
                                            {formatCleaningDate(log.cleaning_date)}
                                          </span>
                                          <span className={`shrink-0 text-[0.6875rem] font-semibold ${condition.color}`}>
                                            {condition.label}
                                          </span>
                                        </div>
                                        {log.notes && (
                                          <p className="mt-0.5 truncate text-[0.6875rem] font-medium text-ink-muted">{log.notes}</p>
                                        )}
                                      </div>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setDeleteLog(log)}
                                        aria-label={`Delete salt cell cleaning from ${formatCleaningDate(log.cleaning_date)}`}
                                        className="h-11 w-11 shrink-0 text-critical hover:bg-[var(--status-critical-soft)] hover:text-critical"
                                      >
                                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="px-4 py-3 pl-14 text-xs font-medium text-ink-muted">
                                No history yet. Use the plus button to log the first cleaning.
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={handleFormOpenChange}>
        <DialogContent className="w-[calc(100%-1.5rem)] rounded-sheet p-5 sm:max-w-md">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>Log Salt Cell Cleaning</DialogTitle>
            <DialogDescription>
              Record the cleaning date and scale condition for the selected salt pool.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="salt-customer">Customer *</Label>
              <Select
                value={formData.customer_id}
                onValueChange={(value) => setFormData((current) => ({ ...current, customer_id: value }))}
                required
              >
                <SelectTrigger id="salt-customer" aria-label="Customer" className="mt-1 h-11 rounded-control border-line bg-surface-2">
                  <SelectValue placeholder="Select salt pool customer" />
                </SelectTrigger>
                <SelectContent>
                  {saltPoolCustomers.map((customer) => (
                    <SelectItem key={getCustomerId(customer)} value={getCustomerId(customer)}>
                      <span className="flex items-center gap-2">
                        <Droplets className="h-3.5 w-3.5 text-info" aria-hidden="true" />
                        {customer.full_name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="cleaning-date">Cleaning Date *</Label>
              <Input
                id="cleaning-date"
                type="date"
                value={formData.cleaning_date}
                onChange={(event) => setFormData((current) => ({ ...current, cleaning_date: event.target.value }))}
                required
                className="mt-1 h-11 rounded-control border-line bg-surface-2"
              />
            </div>

            <div>
              <Label htmlFor="condition">Scale Condition</Label>
              <Select
                value={formData.condition}
                onValueChange={(value) => setFormData((current) => ({ ...current, condition: value }))}
              >
                <SelectTrigger id="condition" aria-label="Scale Condition" className="mt-1 h-11 rounded-control border-line bg-surface-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(conditionConfig).map(([key, config]) => (
                    <SelectItem key={key} value={key}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="salt-notes">Notes (optional)</Label>
              <Textarea
                id="salt-notes"
                value={formData.notes}
                onChange={(event) => setFormData((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Scale, inspection, or replacement notes"
                rows={2}
                className="mt-1 rounded-control border-line bg-surface-2"
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => handleFormOpenChange(false)} className="h-11">
                Cancel
              </Button>
              <Button type="submit" disabled={!formData.customer_id || saving} className="h-11 bg-brand text-white hover:bg-brand-strong">
                {saving ? "Saving…" : "Save Cleaning Log"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteLog} onOpenChange={(open) => !open && setDeleteLog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cleaning Log?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the salt cell cleaning entry permanently. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
