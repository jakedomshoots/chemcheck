import { useEffect, useMemo, useState } from "react";
import { addYears, format, parseISO } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, ChevronDown, Circle, ListChecks, Settings2 } from "lucide-react";
import { db, getTodayDate } from "@/db/chemcheck-db";
import { useEquipmentCreate, useEquipmentUpdate, usePoolCreate } from "@/api/normalizedHooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toast } from "sonner";

const FILTER_TYPES = ["Cartridge", "D.E.", "Sand", "Other"];
const SERVICE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const getServiceDay = (customer) => (
  SERVICE_DAYS.find((day) => day.toLowerCase() === customer?.service_day?.trim().toLowerCase()) || "Unscheduled"
);

const getCustomerId = (customer) => {
  const value = Number(customer?.id ?? customer?._id);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const getFilterType = (equipment) => {
  if (!equipment?.name) return null;
  const normalizedName = equipment.name.toLowerCase();
  if (normalizedName.includes("cartridge")) return "Cartridge";
  if (normalizedName.includes("d.e") || normalizedName.includes("diatom")) return "D.E.";
  if (normalizedName.includes("sand")) return "Sand";
  if (normalizedName.includes("other")) return "Other";
  return equipment.name;
};

const formatMaintenanceDate = (date) => {
  if (!date) return null;
  try {
    return format(parseISO(date), "MMM d");
  } catch {
    return date;
  }
};

const getNextAnnualDate = (date) => format(addYears(parseISO(date), 1), "yyyy-MM-dd");

export function FilterMaintenanceSection({ customers = [] }) {
  const today = getTodayDate();
  const currentYear = today.slice(0, 4);
  const createPool = usePoolCreate();
  const createEquipment = useEquipmentCreate();
  const updateEquipment = useEquipmentUpdate();

  const [expanded, setExpanded] = useState(false);
  const [activeDay, setActiveDay] = useState("Monday");
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [formData, setFormData] = useState({
    filter_type: "",
    model: "",
    cleaning_date: today,
  });

  const customerIds = useMemo(
    () => customers.map(getCustomerId).filter(Boolean),
    [customers]
  );
  const customerIdsKey = customerIds.join(",");

  const maintenanceData = useLiveQuery(
    async () => {
      if (customerIds.length === 0) return { pools: [], filters: [] };
      const pools = await db.pools.where("customer_id").anyOf(customerIds).toArray();
      const poolIds = pools.map((pool) => pool.id).filter(Boolean);
      const equipment = poolIds.length > 0
        ? await db.equipment.where("pool_id").anyOf(poolIds).toArray()
        : [];
      const filters = equipment.filter((item) => (
        item.equipment_type?.toLowerCase() === "filter" && item.status !== "retired"
      ));
      return { pools, filters };
    },
    [customerIdsKey],
    { pools: [], filters: [] }
  );

  const rows = useMemo(() => {
    const primaryPoolByCustomer = new Map();
    maintenanceData.pools.forEach((pool) => {
      const current = primaryPoolByCustomer.get(pool.customer_id);
      if (!current || (pool.active && !current.active) || (pool.sort_order ?? 0) < (current.sort_order ?? 0)) {
        primaryPoolByCustomer.set(pool.customer_id, pool);
      }
    });

    const filterByCustomer = new Map();
    maintenanceData.filters.forEach((filter) => {
      const current = filterByCustomer.get(filter.customer_id);
      if (!current || (filter.local_updated_at ?? 0) > (current.local_updated_at ?? 0)) {
        filterByCustomer.set(filter.customer_id, filter);
      }
    });

    return customers.map((customer) => {
      const customerId = getCustomerId(customer);
      const equipment = customerId ? filterByCustomer.get(customerId) : null;
      const cleanedThisYear = equipment?.last_service_date?.startsWith(currentYear) || false;
      return {
        customer,
        customerId,
        pool: customerId ? primaryPoolByCustomer.get(customerId) : null,
        equipment,
        filterType: getFilterType(equipment),
        cleanedThisYear,
      };
    });
  }, [customers, currentYear, maintenanceData]);

  const completedCount = rows.filter((row) => row.cleanedThisYear).length;
  const dueCount = rows.length - completedCount;
  const progress = rows.length > 0 ? Math.round((completedCount / rows.length) * 100) : 0;

  const rowsByDay = useMemo(() => {
    const byDay = new Map();
    rows.forEach((row) => {
      const day = getServiceDay(row.customer);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(row);
    });
    return byDay;
  }, [rows]);

  const availableDays = useMemo(
    () => [...SERVICE_DAYS, "Unscheduled"].filter((day) => rowsByDay.has(day)),
    [rowsByDay]
  );

  useEffect(() => {
    if (availableDays.length > 0 && !availableDays.includes(activeDay)) {
      setActiveDay(availableDays[0]);
    }
  }, [activeDay, availableDays]);

  const supplySummary = useMemo(() => {
    const counts = new Map();
    let unspecified = 0;
    rows.forEach((row) => {
      if (!row.filterType) {
        unspecified += 1;
        return;
      }
      counts.set(row.filterType, (counts.get(row.filterType) || 0) + 1);
    });
    const parts = [...counts.entries()].map(([type, count]) => `${type} ${count}`);
    if (unspecified > 0) parts.push(`${unspecified} type${unspecified === 1 ? "" : "s"} needed`);
    return parts.length > 0 ? parts.join(" · ") : "Add filter types to build your replacement reference";
  }, [rows]);

  const ensurePrimaryPool = async (row) => {
    if (row.pool) return row.pool;
    if (!row.customerId) throw new Error("Customer record is missing a local ID");
    const customer = row.customer;
    const poolId = await createPool({
      customer_id: row.customerId,
      convex_customer_id: customer.convex_id,
      name: "Primary Pool",
      address: customer.address,
      service_day: customer.service_day || "Monday",
      pool_gallons: customer.pool_gallons,
      pool_type: customer.pool_type || "Chlorine",
      surface_type: customer.surface_type || "Plaster",
      sort_order: 0,
      active: true,
    });
    return { id: poolId, customer_id: row.customerId };
  };

  const openEditor = (row, markClean = false) => {
    const resolvedType = FILTER_TYPES.includes(row.filterType) ? row.filterType : (row.filterType ? "Other" : "");
    setFormData({
      filter_type: resolvedType,
      model: row.equipment?.model || "",
      cleaning_date: today,
    });
    setEditor({ ...row, markClean });
  };

  const handleSaveDetails = async (event) => {
    event.preventDefault();
    if (!editor || !formData.filter_type) return;
    setSaving(true);
    try {
      const pool = await ensurePrimaryPool(editor);
      const baseData = {
        equipment_type: "filter",
        name: formData.filter_type,
        model: formData.model.trim() || undefined,
        status: "active",
      };
      const cleaningData = editor.markClean
        ? {
            last_service_date: formData.cleaning_date,
            next_service_due: getNextAnnualDate(formData.cleaning_date),
          }
        : {};

      if (editor.equipment?.id) {
        await updateEquipment(editor.equipment.id, { ...baseData, ...cleaningData });
      } else {
        await createEquipment({
          ...baseData,
          ...cleaningData,
          customer_id: editor.customerId,
          pool_id: pool.id,
        });
      }

      toast.success(editor.markClean ? "Filter details saved and cleaning checked off" : "Filter details saved");
      setEditor(null);
    } catch (error) {
      console.error("[FilterMaintenance] Could not save filter details:", error);
      toast.error("Could not save the filter details. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleClean = async (row) => {
    if (!row.equipment?.id || !row.filterType) {
      openEditor(row, true);
      return;
    }
    setActionId(row.customerId);
    try {
      if (row.cleanedThisYear) {
        await updateEquipment(row.equipment.id, {
          last_service_date: undefined,
          next_service_due: undefined,
        });
        toast.success("Filter returned to this year’s due list");
      } else {
        await updateEquipment(row.equipment.id, {
          last_service_date: today,
          next_service_due: getNextAnnualDate(today),
        });
        toast.success("Annual filter cleaning checked off");
      }
    } catch (error) {
      console.error("[FilterMaintenance] Could not update cleaning status:", error);
      toast.error("Could not update the filter checklist. Please try again.");
    } finally {
      setActionId(null);
    }
  };

  return (
    <section className="mt-5 border-y border-line bg-surface-1" aria-labelledby="filter-maintenance-title">
      <header>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-controls="filter-maintenance-checklist"
          aria-label={expanded ? "Collapse annual filter cleaning checklist" : "Expand annual filter cleaning checklist"}
          className="relative min-h-16 w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <ListChecks className="h-5 w-5 shrink-0 text-brand-ink" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 id="filter-maintenance-title" className="truncate text-sm font-semibold tracking-[-0.015em] text-ink">
                Annual Filter Clean
              </h3>
              <p className="mt-0.5 truncate text-[0.6875rem] font-medium text-ink-muted">
                {currentYear} · {dueCount} due · {supplySummary}
              </p>
            </div>
            <div className="flex shrink-0 items-baseline gap-1" aria-label={`${completedCount} of ${rows.length} filters cleaned`}>
              <span className="font-data text-sm font-semibold tabular-nums text-brand-ink">
                {completedCount}/{rows.length}
              </span>
              <span className="text-[0.625rem] font-semibold text-ink-muted">done</span>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </div>

          <div
            className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-surface-2"
            role="progressbar"
            aria-label={`${currentYear} filter cleaning progress`}
            aria-valuemin={0}
            aria-valuemax={rows.length}
            aria-valuenow={completedCount}
          >
            <div
              className="h-full bg-brand transition-[width] duration-200 ease-standard motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
        </button>
      </header>

      {expanded && (
        <div id="filter-maintenance-checklist" className="border-t border-line">
          {rows.length > 0 ? (
            <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
              <div className="native-scroll overflow-x-auto border-b border-line p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <TabsList
                  data-testid="filter-service-day-tabs"
                  aria-label="Filter service day"
                  className="grid h-12 w-max min-w-full grid-flow-col auto-cols-[minmax(4rem,1fr)] gap-1 rounded-control border border-line bg-surface-2 p-1"
                >
                  {availableDays.map((day) => {
                    const count = rowsByDay.get(day)?.length || 0;
                    return (
                      <TabsTrigger
                        key={day}
                        value={day}
                        aria-label={`${day}, ${count} ${count === 1 ? "customer" : "customers"}`}
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
                  <ol
                    className="divide-y divide-line"
                    data-testid="filter-maintenance-list"
                    aria-label={`${day} filter checklist`}
                  >
                    {(rowsByDay.get(day) || []).map((row) => {
                      const customerName = row.customer.full_name || "Unnamed customer";
                      const statusText = row.cleanedThisYear
                        ? `Cleaned ${formatMaintenanceDate(row.equipment?.last_service_date)}`
                        : row.equipment?.last_service_date
                          ? `Last ${formatMaintenanceDate(row.equipment.last_service_date)}, ${row.equipment.last_service_date.slice(0, 4)}`
                          : `Due ${currentYear}`;
                      const filterDescription = row.filterType
                        ? [row.filterType, row.equipment?.model].filter(Boolean).join(" · ")
                        : "Filter type needed";

                      return (
                        <li key={String(row.customerId ?? customerName)} className="px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleClean(row)}
                              disabled={actionId === row.customerId}
                              aria-label={row.cleanedThisYear
                                ? `Mark ${customerName} filter due for ${currentYear}`
                                : `Mark ${customerName} filter cleaned for ${currentYear}`}
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-brand-softer hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                            >
                              {row.cleanedThisYear ? (
                                <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden="true" />
                              ) : (
                                <Circle className="h-5 w-5" aria-hidden="true" />
                              )}
                            </button>

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-ink">{customerName}</p>
                              <p className={`mt-0.5 truncate text-[0.6875rem] font-semibold ${row.cleanedThisYear ? "text-ok" : row.filterType ? "text-ink-muted" : "text-watch"}`}>
                                {filterDescription} · {statusText}
                              </p>
                            </div>

                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditor(row)}
                              aria-label={`Edit filter details for ${customerName}`}
                              className="h-11 w-11 shrink-0 rounded-control text-brand-ink hover:bg-brand-softer"
                            >
                              <Settings2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <div className="px-5 py-5 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-ok" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold text-ink">No customers to check</p>
              <p className="mt-1 text-xs font-medium text-ink-muted">Add customers to build the annual checklist.</p>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!editor} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="w-[calc(100%-1.5rem)] rounded-sheet p-5 sm:max-w-md">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>{editor?.customer?.full_name || "Customer"} filter</DialogTitle>
            <DialogDescription>
              Save the filter style and replacement model so you can check supplies without revisiting the equipment pad.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveDetails} className="space-y-4">
            <div>
              <Label htmlFor="filter-type">Filter type *</Label>
              <Select
                value={formData.filter_type}
                onValueChange={(value) => setFormData((current) => ({ ...current, filter_type: value }))}
              >
                <SelectTrigger id="filter-type" aria-label="Filter type" className="mt-1 h-11 rounded-control border-line bg-surface-2">
                  <SelectValue placeholder="Choose filter type" />
                </SelectTrigger>
                <SelectContent>
                  {FILTER_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="filter-model">Model or replacement part</Label>
              <Input
                id="filter-model"
                value={formData.model}
                onChange={(event) => setFormData((current) => ({ ...current, model: event.target.value }))}
                placeholder="Pentair CCP420 / R173576"
                className="mt-1 h-11 rounded-control border-line bg-surface-2"
              />
            </div>

            {editor?.markClean && (
              <div>
                <Label htmlFor="filter-cleaning-date">Cleaning date *</Label>
                <Input
                  id="filter-cleaning-date"
                  type="date"
                  value={formData.cleaning_date}
                  onChange={(event) => setFormData((current) => ({ ...current, cleaning_date: event.target.value }))}
                  required
                  className="mt-1 h-11 rounded-control border-line bg-surface-2"
                />
              </div>
            )}

            <DialogFooter>
              <Button
                type="submit"
                disabled={!formData.filter_type || saving}
                className="h-12 w-full rounded-full bg-brand font-semibold text-white shadow-cta hover:bg-brand-strong"
              >
                {saving ? "Saving..." : editor?.markClean ? "Save & Mark Clean" : "Save Filter Details"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
