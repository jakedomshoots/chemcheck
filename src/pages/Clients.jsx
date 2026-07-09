import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useCustomersFilter, useCurrentUser, useCustomerUpdate, useCustomerDelete } from "@/api/convexHooks";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Plus, Users, Search, ArrowUp, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import ClientListItem from "../components/clients/ClientListItem";
import { toast } from "sonner";
import { DAY_ORDER, getEffectiveWorkingDays } from "@/lib/workingDays";

const FALLBACK_SORT_ORDER = Number.MAX_SAFE_INTEGER;

function getSortFallback(createdAt) {
  if (!createdAt) return FALLBACK_SORT_ORDER;
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : FALLBACK_SORT_ORDER;
}

function compareByPotentialOrder(a, b) {
  const aSort = typeof a.sort_order === "number" ? a.sort_order : FALLBACK_SORT_ORDER;
  const bSort = typeof b.sort_order === "number" ? b.sort_order : FALLBACK_SORT_ORDER;

  if (aSort !== bSort) return aSort - bSort;

  const aCreatedAt = getSortFallback(a.createdAt);
  const bCreatedAt = getSortFallback(b.createdAt);
  if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;

  const aId = String(a._id ?? a.id ?? "");
  const bId = String(b._id ?? b.id ?? "");
  return aId.localeCompare(bId);
}

function getDisplaySortOrder(customer) {
  return typeof customer.sort_order === "number" ? customer.sort_order : FALLBACK_SORT_ORDER;
}

export default function Clients() {
  const navigate = useNavigate();
  const user = useCurrentUser();

  const convexBusiness = useQuery(api.businesses.getCurrent);

  const allCustomers = useCustomersFilter(user?.email ? { created_by: user.email } : undefined);
  const updateCustomer = useCustomerUpdate();
  const deleteCustomerMutation = useCustomerDelete();

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState("Monday");
  const [deleteCustomer, setDeleteCustomer] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [reorderMode, setReorderMode] = useState(false);
  const [movingCustomerId, setMovingCustomerId] = useState(null);
  const customersRef = useRef([]);
  const pendingSortInitializationIdsRef = useRef(new Set());
  const pendingReorderSortsRef = useRef(new Map());
  const pendingReorderDaysByCustomerIdRef = useRef(new Map());
  const dayTabRefs = useRef({});
  const hasAutoScrolledDayRef = useRef(false);

  const daysOfWeek = useMemo(() => {
    return getEffectiveWorkingDays(convexBusiness);
  }, [convexBusiness]);

  const validWorkingDays = daysOfWeek;
  const dayRankByName = useMemo(() => {
    const map = new Map();
    DAY_ORDER.forEach((day, index) => {
      map.set(day, index);
    });
    return map;
  }, []);

  const activeDayRankByName = useMemo(() => {
    const map = new Map();
    validWorkingDays.forEach((day, index) => {
      map.set(day, index);
    });
    return map;
  }, [validWorkingDays]);

  const compareCustomersForDisplay = useCallback((a, b) => {
    if (a.service_day !== b.service_day) {
      const aRank = activeDayRankByName.get(a.service_day);
      const bRank = activeDayRankByName.get(b.service_day);
      if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
      if (aRank !== undefined) return -1;
      if (bRank !== undefined) return 1;

      const aDayRank = dayRankByName.get(a.service_day);
      const bDayRank = dayRankByName.get(b.service_day);
      if (aDayRank !== undefined && bDayRank !== undefined) return aDayRank - bDayRank;

      return String(a.service_day).localeCompare(String(b.service_day));
    }

    const aSortOrder = getDisplaySortOrder(a);
    const bSortOrder = getDisplaySortOrder(b);

    if (aSortOrder !== bSortOrder) return aSortOrder - bSortOrder;

    const aCreatedAt = getSortFallback(a.createdAt);
    const bCreatedAt = getSortFallback(b.createdAt);
    if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;

    const aId = String(a._id ?? a.id ?? "");
    const bId = String(b._id ?? b.id ?? "");
    return aId.localeCompare(bId);
  }, [activeDayRankByName, dayRankByName]);

  useEffect(() => {
    if (validWorkingDays.length > 0 && !validWorkingDays.includes(activeDay)) {
      setActiveDay(validWorkingDays[0]);
    }
  }, [validWorkingDays, activeDay]);

  useEffect(() => {
    customersRef.current = customers;
  }, [customers]);

  useEffect(() => {
    const activeTab = dayTabRefs.current[activeDay];
    if (!activeTab) return;

    const rafId = window.requestAnimationFrame(() => {
      activeTab.scrollIntoView({
        behavior: hasAutoScrolledDayRef.current ? "smooth" : "auto",
        block: "nearest",
        inline: "center",
      });
      hasAutoScrolledDayRef.current = true;
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [activeDay, validWorkingDays]);

  useEffect(() => {
    if (!allCustomers) return;

    const lockedReorderDays = new Set(pendingReorderDaysByCustomerIdRef.current.values());
    const lockedCustomersById = new Map(
      customersRef.current
        .filter((customer) => lockedReorderDays.has(customer.service_day))
        .map((customer) => [customer._id, customer])
    );

    const customersForDisplay = allCustomers.map((customer) => {
      const lockedCustomer = lockedCustomersById.get(customer._id);
      if (lockedCustomer) return lockedCustomer;

      const pendingSortOrder = pendingReorderSortsRef.current.get(String(customer._id));
      if (pendingSortOrder === undefined) return customer;

      return {
        ...customer,
        sort_order: pendingSortOrder,
      };
    });

    const dayGroups = {};
    customersForDisplay.forEach((customer) => {
      if (!dayGroups[customer.service_day]) {
        dayGroups[customer.service_day] = [];
      }
      dayGroups[customer.service_day].push(customer);
    });

    const sortOrderById = new Map();
    const updates = [];

    for (const day in dayGroups) {
      const dayCustomers = dayGroups[day]
        .map((customer) => {
          const pendingSortOrder = pendingReorderSortsRef.current.get(String(customer._id));
          if (pendingSortOrder === undefined) return customer;

          return {
            ...customer,
            sort_order: pendingSortOrder,
          };
        })
        .sort(compareByPotentialOrder);

      dayCustomers.forEach((customer, index) => {
        sortOrderById.set(customer._id, index);
        const customerKey = String(customer._id);
        const shouldPersist = typeof customer.sort_order !== "number" || customer.sort_order !== index;
        if (!shouldPersist) return;

        if (pendingReorderSortsRef.current.has(customerKey)) {
          return;
        }

        if (pendingSortInitializationIdsRef.current.has(customerKey)) {
          return;
        }

        pendingSortInitializationIdsRef.current.add(customerKey);
        updates.push(
          updateCustomer({ id: customer._id, sort_order: index })
            .catch((error) => {
              console.error("Failed to initialize client sort order:", error);
            })
            .finally(() => {
              pendingSortInitializationIdsRef.current.delete(customerKey);
            })
        );
      });
    }

    const sorted = [...customersForDisplay].sort((a, b) => {
      return compareCustomersForDisplay({
        ...a,
        sort_order: sortOrderById.get(a._id) ?? a.sort_order,
      }, {
        ...b,
        sort_order: sortOrderById.get(b._id) ?? b.sort_order,
      });
    });

    setCustomers(sorted);
    setLoading(false);

    if (updates.length > 0) {
      Promise.allSettled(updates);
    }
  }, [allCustomers, compareCustomersForDisplay, updateCustomer]);

  const handleDelete = async () => {
    if (deleteCustomer) {
      await deleteCustomerMutation({ id: deleteCustomer._id });
      setDeleteCustomer(null);
    }
  };

  const handleEdit = useCallback((customer) => {
    navigate(createPageUrl("EditClient") + `?id=${customer._id}`);
  }, [navigate]);

  const applyReorder = useCallback(async (day, reorderedDayCustomers) => {
    const nextOrderById = new Map();
    reorderedDayCustomers.forEach((customer, index) => {
      nextOrderById.set(customer._id, index);
    });

    const updates = [];
    const nextCustomers = customers.map((customer) => {
      if (customer.service_day !== day) {
        return customer;
      }

      const nextSortOrder = nextOrderById.get(customer._id);
      if (nextSortOrder === undefined) return customer;

      if (customer.sort_order !== nextSortOrder) {
        const customerKey = String(customer._id);
        pendingReorderSortsRef.current.set(customerKey, nextSortOrder);
        pendingReorderDaysByCustomerIdRef.current.set(customerKey, day);
        updates.push(
          updateCustomer({ id: customer._id, sort_order: nextSortOrder })
            .finally(() => {
              pendingReorderSortsRef.current.delete(customerKey);
              pendingReorderDaysByCustomerIdRef.current.delete(customerKey);
            })
        );
      }

      return {
        ...customer,
        sort_order: nextSortOrder,
      };
    }).sort(compareCustomersForDisplay);

    setCustomers(nextCustomers);

    if (updates.length > 0) {
      await Promise.all(updates);
    }
  }, [compareCustomersForDisplay, customers, updateCustomer]);

  const handleMoveUp = async (customer) => {
    if (movingCustomerId) return;
    setMovingCustomerId(customer._id);

    try {
      const dayCustomers = customers.filter((c) => c.service_day === customer.service_day);
      const currentIndex = dayCustomers.findIndex(c => c._id === customer._id);

      if (currentIndex <= 0) {
        setMovingCustomerId(null);
        return;
      }

      const next = [...dayCustomers];
      const [moved] = next.splice(currentIndex, 1);
      next.splice(currentIndex - 1, 0, moved);

      await applyReorder(customer.service_day, next);

      toast.success("Customer moved up");
    } catch (error) {
      console.error("Error moving customer:", error);
      toast.error("Failed to move customer");
    } finally {
      setMovingCustomerId(null);
    }
  };

  const handleMoveDown = async (customer) => {
    if (movingCustomerId) return;
    setMovingCustomerId(customer._id);

    try {
      const dayCustomers = customers.filter((c) => c.service_day === customer.service_day);
      const currentIndex = dayCustomers.findIndex(c => c._id === customer._id);

      if (currentIndex >= dayCustomers.length - 1) {
        setMovingCustomerId(null);
        return;
      }

      const next = [...dayCustomers];
      const [moved] = next.splice(currentIndex, 1);
      next.splice(currentIndex + 1, 0, moved);

      await applyReorder(customer.service_day, next);

      toast.success("Customer moved down");
    } catch (error) {
      console.error("Error moving customer:", error);
      toast.error("Failed to move customer");
    } finally {
      setMovingCustomerId(null);
    }
  };

  const getCustomersByDay = useCallback((day) => {
    return customers
      .filter((c) => c.service_day === day)
      .sort(compareByPotentialOrder)
      .filter((c) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return c.full_name.toLowerCase().includes(query) ||
          c.address.toLowerCase().includes(query);
      });
  }, [customers, searchQuery]);

  const customerCounts = useMemo(() => {
    const counts = {};
    customers.forEach(c => {
      counts[c.service_day] = (counts[c.service_day] || 0) + 1;
    });
    return counts;
  }, [customers]);

  const orphanedCustomers = useMemo(() => {
    return customers.filter(c => !daysOfWeek.includes(c.service_day));
  }, [customers, daysOfWeek]);

  const visibleCustomerCount = useMemo(() => {
    return customers.filter(c => daysOfWeek.includes(c.service_day)).length;
  }, [customers, daysOfWeek]);
  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Clients">
        <div className="mb-4 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur">
          <h2 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950">Clients</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Loading your client list…</p>
        </div>
        <div className="flex items-center justify-center py-16">
          <div className="h-10 w-10 rounded-full border-4 border-cyan-200 border-t-cyan-600 animate-spin" aria-hidden="true" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Clients">
      <div
        data-testid="clients-header"
        className="mb-4 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Client roster</p>
            <h2 className="text-3xl font-semibold leading-tight tracking-[-0.045em] text-slate-950 sm:text-4xl">
              Clients
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {visibleCustomerCount} clients scheduled
              {orphanedCustomers.length > 0 && (
                <span className="ml-1 text-amber-700">
                  ({orphanedCustomers.length} not on working days)
                </span>
              )}
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            {!reorderMode ? (
              <>
                <Button
                  onClick={() => setReorderMode(true)}
                  disabled={visibleCustomerCount === 0}
                  variant="outline"
                  className="h-11 flex-1 rounded-[1.15rem] border border-slate-200 bg-white/90 text-sm font-semibold text-slate-800 shadow-sm hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none sm:flex-none"
                >
                  <ArrowUp className="mr-2 h-4 w-4" aria-hidden="true" />
                  Reorder
                </Button>
                <Button
                  onClick={() => navigate(createPageUrl("NewClient"))}
                  className="h-11 flex-1 rounded-[1.15rem] bg-cyan-600 text-sm font-semibold text-white shadow-[0_18px_38px_-24px_rgba(8,145,178,0.95)] hover:bg-cyan-700 sm:flex-none"
                >
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Add Client
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setReorderMode(false)}
                className="h-11 w-full rounded-[1.15rem] bg-slate-950 text-sm font-semibold text-white shadow-sm hover:bg-cyan-700 sm:w-auto"
              >
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                Done Reordering
              </Button>
            )}
          </div>
        </div>
      </div>

      {reorderMode && (
        <div className="mb-4 rounded-[1.25rem] border border-cyan-200/80 bg-cyan-50/80 px-4 py-3 shadow-sm">
          <p className="text-sm font-semibold text-cyan-900">
            Reorder Mode active. Use the arrows on each client to move them up or down for the selected day.
          </p>
        </div>
      )}

      {orphanedCustomers.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-[1.35rem] border border-amber-200/80 bg-amber-50/85 shadow-sm">
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900">
                {orphanedCustomers.length} customer{orphanedCustomers.length !== 1 ? 's' : ''} not scheduled on working days
              </p>
              <p className="mt-1 text-xs font-medium text-amber-800">
                These customers have service days outside your current working schedule: {orphanedCustomers.map(c => c.full_name).join(', ')}
              </p>
              <p className="mt-1 text-xs font-medium text-amber-700">
                Update their service days in Settings → Schedule or edit individual customers.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search clients by name or address..."
          className="h-11 rounded-[1.15rem] border border-slate-200 bg-white/90 pl-9 text-sm font-medium text-slate-700 shadow-sm focus:border-cyan-400"
        />
      </div>

      <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
        <div className="-mx-3 mb-4 overflow-x-auto px-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 rounded-[1.15rem] border border-white/80 bg-white/85 p-1 shadow-[0_18px_60px_-48px_rgba(8,47,73,0.55)] backdrop-blur sm:min-w-0 sm:w-full">
            {validWorkingDays.map((day) => {
              const count = customerCounts[day] || 0;
              return (
                <TabsTrigger
                  key={day}
                  value={day}
                  ref={(el) => {
                    if (el) dayTabRefs.current[day] = el;
                  }}
                  className="group inline-flex h-9 shrink-0 min-w-[4.5rem] snap-start items-center justify-center whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-slate-500 transition-all data-[state=active]:bg-cyan-600 data-[state=active]:text-white data-[state=active]:shadow-sm hover:text-slate-700 sm:min-w-0 sm:flex-1"
                >
                  <span>{day.substring(0, 3)}</span>
                  {count > 0 && (
                    <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 group-data-[state=active]:bg-white/20 group-data-[state=active]:text-white">
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {validWorkingDays.map((day) => {
          const dayCustomers = getCustomersByDay(day);
          return (
            <TabsContent key={day} value={day}>
              {dayCustomers.length === 0 ? (
                <div className="mb-20 rounded-[1.75rem] border border-white/80 bg-white/80 px-5 py-10 text-center shadow-[0_24px_80px_-58px_rgba(8,47,73,0.85)] backdrop-blur">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 shadow-inner">
                    <Users className="h-7 w-7" aria-hidden="true" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold tracking-[-0.035em] text-slate-950">
                    {searchQuery ? "No Matching Clients" : `No Clients for ${day}`}
                  </h3>
                  <p className="mx-auto mb-5 max-w-sm text-sm font-medium leading-6 text-slate-600">
                    {searchQuery ? "Try adjusting your search" : "Add clients to this day's route"}
                  </p>
                  {!searchQuery && (
                    <Button
                      onClick={() => navigate(createPageUrl("NewClient"))}
                      className="h-11 rounded-full bg-cyan-600 px-6 font-semibold text-white shadow-[0_18px_38px_-24px_rgba(8,145,178,0.95)] hover:bg-cyan-700"
                    >
                      <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                      Add Client
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {dayCustomers.map((customer, index) => (
                    <ClientListItem
                      key={customer._id}
                      customer={customer}
                      onDelete={setDeleteCustomer}
                      onEdit={handleEdit}
                      onClick={(c) => navigate(createPageUrl("CustomerDetail") + `?id=${c._id}`)}
                      reorderMode={reorderMode}
                      onMoveUp={handleMoveUp}
                      onMoveDown={handleMoveDown}
                      isFirst={index === 0}
                      isLast={index === dayCustomers.length - 1}
                      isMoving={movingCustomerId === customer._id}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <AlertDialog open={!!deleteCustomer} onOpenChange={() => setDeleteCustomer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete <strong>{deleteCustomer?.full_name}</strong> and all their service logs? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
