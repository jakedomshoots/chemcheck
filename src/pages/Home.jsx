import { useState, useEffect, useMemo } from "react";
import { useCustomersFilter, useServiceLogs, useCurrentUser } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { createPageUrl, parseLocalDate } from "@/utils";
import { Calendar, Plus, AlertTriangle, PlayCircle, ShieldAlert, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, subWeeks, startOfWeek, endOfWeek } from "date-fns";
import CustomerCard from "../components/home/CustomerCard";
import OffDayServicePickerDialog from "@/components/home/OffDayServicePickerDialog";
import QuickStats from "../components/home/QuickStats";
import { CustomerCardSkeleton, QuickStatsSkeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { trackUxEvent } from "@/lib/uxAnalytics";
import { getEffectiveWorkingDays } from "@/lib/workingDays";
import { buildDurationProfile, calculateServiceTimingSummary } from "@/lib/routeTimingEstimator";

const daysOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function normalizeSkippedCustomerIds(customerIds) {
  if (!Array.isArray(customerIds)) return [];
  return [...new Set(customerIds.filter((id) => id !== null && id !== undefined))];
}

function getWeekKey() {
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  return `skipped_services_${format(weekStart, 'yyyy-MM-dd')}`;
}

function getSkippedCustomers() {
  try {
    const key = getWeekKey();
    const stored = localStorage.getItem(key);
    return stored ? normalizeSkippedCustomerIds(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

function saveSkippedCustomers(customerIds) {
  try {
    const key = getWeekKey();
    const normalizedIds = normalizeSkippedCustomerIds(customerIds);
    localStorage.setItem(key, JSON.stringify(normalizedIds));

    const lastCleanup = localStorage.getItem('skipped_services_last_cleanup');
    if (!lastCleanup || lastCleanup !== key) {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('skipped_services_') && k !== key && k !== 'skipped_services_last_cleanup') {
          localStorage.removeItem(k);
        }
      });
      localStorage.setItem('skipped_services_last_cleanup', key);
    }
  } catch (e) {
    console.error('Failed to save skipped customers:', e);
  }
}

function formatRouteDuration(totalMinutes) {
  const safeMinutes = Number.isFinite(totalMinutes) ? Math.max(0, Math.round(totalMinutes)) : 0;
  if (safeMinutes < 60) return `${safeMinutes} min`;

  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  const hourLabel = hours === 1 ? "hr" : "hrs";

  if (minutes === 0) return `${hours} ${hourLabel}`;
  return `${hours} ${hourLabel} ${minutes} min`;
}

export default function Home() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const convexBusiness = useQuery(api.businesses.getCurrent);

  const allCustomersData = useCustomersFilter(user?.email ? { created_by: user.email } : undefined);
  const allLogsData = useServiceLogs("-service_date", 100);

  const [allCustomers, setAllCustomers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [lastWeekLogs, setLastWeekLogs] = useState([]);
  const [allThisWeekLogs, setAllThisWeekLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skippedCustomers, setSkippedCustomers] = useState(() => getSkippedCustomers());
  const [hasCheckedDefaultView, setHasCheckedDefaultView] = useState(false);
  const [missedExpanded, setMissedExpanded] = useState(false);
  const [offDayPickerOpen, setOffDayPickerOpen] = useState(false);
  const [offDaySearchQuery, setOffDaySearchQuery] = useState("");
  const [selectedOffDay, setSelectedOffDay] = useState(null);

  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const dayOfWeek = useMemo(() => format(new Date(), "EEEE"), []);
  const homePrimaryAction = user?.preferences?.home_primary_action || 'start_next_pending';
  const workingDays = useMemo(() => getEffectiveWorkingDays(convexBusiness), [convexBusiness]);
  const availableOffDays = useMemo(
    () => workingDays.filter((day) => day !== dayOfWeek),
    [workingDays, dayOfWeek]
  );
  const opsBriefFeatureEnabled = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('chemcheck_ff_home_ops_brief') !== 'false';
  }, []);
  const showOpsBrief = opsBriefFeatureEnabled && (user?.preferences?.show_ops_brief ?? true);

  useEffect(() => {
    if (availableOffDays.length === 0) {
      setSelectedOffDay(null);
      return;
    }

    if (!selectedOffDay || !availableOffDays.includes(selectedOffDay)) {
      setSelectedOffDay(availableOffDays[0]);
    }
  }, [availableOffDays, selectedOffDay]);

  useEffect(() => {
    if (!user) return;
    if (hasCheckedDefaultView) return;

    const sessionKey = 'chemcheck_default_view_checked';
    const alreadyChecked = sessionStorage.getItem(sessionKey);

    if (!alreadyChecked) {
      const defaultView = user?.preferences?.defaultView;

      sessionStorage.setItem(sessionKey, 'true');
      setHasCheckedDefaultView(true);

      if (defaultView === 'customers') {
        navigate(createPageUrl("Clients"), { replace: true });
        return;
      }
    } else {
      setHasCheckedDefaultView(true);
    }
  }, [user, navigate, hasCheckedDefaultView]);

  useEffect(() => {
    if (allCustomersData && allLogsData) {
      try {
        setAllCustomers(allCustomersData);

        let todaysCustomers = [];
        if (dayOfWeek !== "Sunday" && dayOfWeek !== "Saturday") {
          todaysCustomers = allCustomersData
            .filter((c) => c.service_day === dayOfWeek)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        }
        setCustomers(todaysCustomers);

        const logs = allLogsData.filter(log => log.service_date === today);
        setTodayLogs(logs);

        const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
        const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

        const thisWeekLogs = allLogsData.filter(log => {
          try {
            const logDate = parseLocalDate(log.service_date);
            return logDate && logDate >= weekStart && logDate <= weekEnd;
          } catch (e) {
            return false;
          }
        });
        setAllThisWeekLogs(thisWeekLogs);

        const lastWeekStart = startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });
        const lastWeekEnd = endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });

        const lastWeek = allLogsData.filter(log => {
          try {
            const logDate = parseLocalDate(log.service_date);
            return logDate && logDate >= lastWeekStart && logDate <= lastWeekEnd;
          } catch (e) {
            return false;
          }
        });

        setLastWeekLogs(lastWeek);
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    }
  }, [allCustomersData, allLogsData, today, dayOfWeek]);

  const missedServices = useMemo(() => {
    const currentDayIndex = daysOrder.indexOf(dayOfWeek);

    if (currentDayIndex === -1 || dayOfWeek === "Sunday" || dayOfWeek === "Saturday") {
      return [];
    }

    const previousDays = daysOrder.slice(0, currentDayIndex);
    const missedCustomers = [];

    previousDays.forEach(day => {
      const dayCustomers = allCustomers.filter(c => c.service_day === day);

      dayCustomers.forEach(customer => {
        const hasLogThisWeek = allThisWeekLogs.some(log =>
          log.customer_id === customer._id
        );

        const isSkipped = skippedCustomers.includes(customer._id);

        if (!hasLogThisWeek && !isSkipped) {
          missedCustomers.push({
            ...customer,
            scheduledDay: day
          });
        }
      });
    });

    return missedCustomers;
  }, [allCustomers, allThisWeekLogs, dayOfWeek, skippedCustomers]);

  const completedCustomerIds = useMemo(
    () => new Set(todayLogs.map((log) => log.customer_id)),
    [todayLogs]
  );
  const offDayClients = useMemo(() => {
    if (!selectedOffDay) return [];

    const query = offDaySearchQuery.trim().toLowerCase();
    return allCustomers
      .filter((customer) => customer.service_day === selectedOffDay)
      .filter((customer) => !completedCustomerIds.has(customer._id))
      .filter((customer) => {
        if (!query) return true;
        return customer.full_name.toLowerCase().includes(query) || customer.address.toLowerCase().includes(query);
      })
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [allCustomers, selectedOffDay, offDaySearchQuery, completedCustomerIds]);
  const servicedCustomerIdsThisWeek = useMemo(
    () => new Set(allThisWeekLogs.map((log) => log.customer_id)),
    [allThisWeekLogs]
  );

  useEffect(() => {
    if (!skippedCustomers.length) return;
    const cleanedSkipped = skippedCustomers.filter(
      (customerId) => !servicedCustomerIdsThisWeek.has(customerId)
    );
    if (cleanedSkipped.length === skippedCustomers.length) return;
    setSkippedCustomers(cleanedSkipped);
    saveSkippedCustomers(cleanedSkipped);
  }, [skippedCustomers, servicedCustomerIdsThisWeek]);

  const skippedCustomerIds = useMemo(
    () => new Set(skippedCustomers),
    [skippedCustomers]
  );
  const isCompleted = (customerId) => completedCustomerIds.has(customerId);
  const isSkipped = (customerId) => !isCompleted(customerId) && skippedCustomerIds.has(customerId);

  const handleSkipCustomer = (customer) => {
    const customerId = customer?._id;
    if (!customerId || isCompleted(customerId) || isSkipped(customerId)) return;
    const newSkipped = normalizeSkippedCustomerIds([...skippedCustomers, customerId]);
    setSkippedCustomers(newSkipped);
    saveSkippedCustomers(newSkipped);
    toast.success(`Skipped ${customer.full_name || 'Customer'} for this week`);
  };

  const handleUnskipCustomer = (customer, options = {}) => {
    const customerId = customer?._id;
    const { silent = false } = options;
    if (!customerId || !isSkipped(customerId)) return;
    const newSkipped = skippedCustomers.filter((id) => id !== customerId);
    setSkippedCustomers(newSkipped);
    saveSkippedCustomers(newSkipped);
    if (!silent) {
      toast.success(`Moved ${customer.full_name || 'Customer'} back to pending`);
    }
  };

  const lastWeekLogsMap = useMemo(() => {
    const map = new Map();
    lastWeekLogs.forEach(log => {
      if (!map.has(log.customer_id)) {
        map.set(log.customer_id, log);
      }
    });
    return map;
  }, [lastWeekLogs]);

  const getLastWeekLog = (customerId) => lastWeekLogsMap.get(customerId);
  const todayLogsMap = useMemo(() => {
    const map = new Map();
    todayLogs.forEach((log) => {
      map.set(log.customer_id, log);
    });
    return map;
  }, [todayLogs]);

  const getServiceConfidence = (customerId) => {
    const log = todayLogsMap.get(customerId);
    if (!log) return null;

    const hasCoreReadings = Boolean(log.ph && log.chlorine && log.alkalinity && log.stabilizer);
    const hasRequiredPhotos = Boolean(log.has_before_photos && log.has_after_photos);
    const hasNotes = Boolean(log.notes && String(log.notes).trim().length > 0);

    let score = 0;
    if (hasCoreReadings) score += 35;
    if (hasRequiredPhotos) score += 40;
    if (hasNotes) score += 25;

    if (score >= 80) return { score, label: "High" };
    if (score >= 50) return { score, label: "Medium" };
    return { score, label: "Low" };
  };

  const handleCustomerClick = (customer) => {
    if (isCompleted(customer._id)) {
      navigate(createPageUrl("CustomerDetail") + `?id=${customer._id}`, {
        state: { customer, lastWeekLog: getLastWeekLog(customer._id) }
      });
    } else {
      navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`, {
        state: { customer }
      });
    }
  };

  const handleCustomerStart = (customer) => {
    if (isSkipped(customer?._id)) {
      handleUnskipCustomer(customer, { silent: true });
    }
    handleCustomerClick(customer);
  };

  const handleCallCustomer = (customer) => {
    if (!customer?.phone) return;
    window.location.href = `tel:${customer.phone}`;
  };

  const handleMapCustomer = (customer) => {
    if (!customer?.address) return;
    const encoded = encodeURIComponent(customer.address);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = isIOS
      ? `https://maps.apple.com/?daddr=${encoded}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const stats = useMemo(() => {
    const completed = customers.filter((c) => isCompleted(c._id)).length;
    const skipped = customers.filter((c) => isSkipped(c._id)).length;
    const pending = customers.filter((c) => !isCompleted(c._id) && !isSkipped(c._id)).length;
    return {
      total: customers.length,
      completed,
      skipped,
      pending
    };
  }, [customers, completedCustomerIds, skippedCustomerIds]);

  const nextPendingCustomer = useMemo(
    () => customers.find((customer) => !isCompleted(customer._id) && !isSkipped(customer._id)) || null,
    [customers, completedCustomerIds, skippedCustomerIds]
  );

  const durationProfile = useMemo(
    () => buildDurationProfile(allLogsData),
    [allLogsData]
  );

  const opsBrief = useMemo(() => {
    const serviceSummary = calculateServiceTimingSummary(customers, {
      customerMedianById: durationProfile.customerMedianById,
      fallback: 15,
    });

    return {
      pendingStops: serviceSummary.stopsAssigned,
      estimatedRouteMinutes: serviceSummary.totalServiceMinutes,
    };
  }, [customers, durationProfile]);

  const handlePrimaryHomeAction = () => {
    trackUxEvent('ux_task_started', { flow: 'home_primary_action', action: homePrimaryAction });

    if (customers.length === 0) {
      navigate(createPageUrl("NewClient"));
      trackUxEvent('ux_task_completed', { flow: 'home_primary_action', action: 'add_client' });
      return;
    }

    if (homePrimaryAction === 'open_route_plan') {
      navigate(createPageUrl("RouteOptimizer"));
      trackUxEvent('ux_task_completed', { flow: 'home_primary_action', action: homePrimaryAction });
      return;
    }

    if (homePrimaryAction === 'add_client') {
      navigate(createPageUrl("NewClient"));
      trackUxEvent('ux_task_completed', { flow: 'home_primary_action', action: homePrimaryAction });
      return;
    }

    if (!nextPendingCustomer) {
      trackUxEvent('ux_task_abandoned', { flow: 'home_primary_action', reason: 'no_pending_customer' });
      return;
    }
    navigate(createPageUrl("NewServiceLog") + `?customerId=${nextPendingCustomer._id}`, {
      state: { customer: nextPendingCustomer },
    });
    trackUxEvent('ux_task_completed', { flow: 'home_primary_action', action: homePrimaryAction });
  };

  const handleOpenOffDayPicker = () => {
    setOffDaySearchQuery("");
    setOffDayPickerOpen(true);
    if (!selectedOffDay || !availableOffDays.includes(selectedOffDay)) {
      setSelectedOffDay(availableOffDays[0] || null);
    }
  };

  const handleStartOffDayClient = (customer) => {
    if (!customer) return;

    trackUxEvent('ux_task_started', { flow: 'home_off_day_service', selected_day: selectedOffDay || 'unknown' });
    setOffDayPickerOpen(false);
    setOffDaySearchQuery("");
    navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`, {
      state: {
        customer,
        serviceFlow: {
          source: 'home_off_day_picker',
          selectedDay: selectedOffDay,
          returnPolicy: 'reset_to_today',
          todayDay: dayOfWeek,
        },
      },
    });
    trackUxEvent('ux_task_completed', { flow: 'home_off_day_service', selected_day: selectedOffDay || 'unknown' });
  };

  const primaryActionConfig = customers.length === 0
    ? { icon: Plus, label: 'Add First Client', disabled: false }
    : homePrimaryAction === 'open_route_plan'
      ? { icon: Route, label: 'Open Route Plan', disabled: false }
      : homePrimaryAction === 'add_client'
        ? { icon: Plus, label: 'Add Client', disabled: false }
        : {
            icon: PlayCircle,
            label: nextPendingCustomer ? `Start Next: ${nextPendingCustomer.full_name}` : "No Pending Stops",
            disabled: !nextPendingCustomer,
          };

  if (loading) {
    return (
      <main className="relative mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Home">
        <div className="mb-4 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950">Today's Route</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {dayOfWeek}, {format(new Date(), "MMM dd, yyyy")}
            </p>
          </div>
        </div>
        <QuickStatsSkeleton />
        <div className="space-y-2">
          <CustomerCardSkeleton />
          <CustomerCardSkeleton />
          <CustomerCardSkeleton />
          <CustomerCardSkeleton />
        </div>
      </main>
    );
  }

  return (
    <main className="relative mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Home">
      <div
        data-testid="route-header"
        className="mb-4 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Field command</p>
            <h2 className="text-3xl font-semibold leading-tight tracking-[-0.045em] text-slate-950 sm:text-4xl">
              Today's Route
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {dayOfWeek}, {format(new Date(), "MMM dd, yyyy")}
            </p>
          </div>

          {showOpsBrief && (
            <aside
              aria-label="Daily Ops Brief"
              className="w-full rounded-2xl border border-cyan-100 bg-cyan-50/70 px-4 py-3 shadow-sm shadow-cyan-900/5 sm:w-auto sm:min-w-[250px] sm:max-w-[300px] sm:shrink-0"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800">
                    <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Daily Ops Brief</span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-slate-500">Estimated route</p>
                </div>
                <p className="flex shrink-0 items-center gap-1 whitespace-nowrap text-base font-semibold tabular-nums text-cyan-800">
                  <Route className="h-4 w-4" aria-hidden="true" />
                  {opsBrief.pendingStops} stops · {formatRouteDuration(opsBrief.estimatedRouteMinutes)}
                </p>
              </div>
            </aside>
          )}
        </div>
      </div>

      {missedServices.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-[1.35rem] border border-amber-200/80 bg-amber-50/85 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
              <span className="text-sm font-semibold text-slate-900">
                {missedServices.length} Missed
              </span>
            </div>
            {missedServices.length > 2 && (
              <button
                onClick={() => setMissedExpanded(!missedExpanded)}
                className="rounded-full px-3 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              >
                {missedExpanded ? 'Show less' : `+${missedServices.length - 2} more`}
              </button>
            )}
          </div>
          <div className="divide-y divide-amber-200/70">
            {(missedExpanded ? missedServices : missedServices.slice(0, 2)).map(customer => (
              <div
                key={customer._id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`)}
                >
                  <p className="truncate text-sm font-semibold text-slate-900">{customer.full_name || 'Customer'}</p>
                  <p className="truncate text-xs text-slate-500">
                    {customer.scheduledDay} · {customer.address}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="rounded-full px-3 py-1 text-xs font-semibold text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSkipCustomer(customer);
                    }}
                  >
                    Skip
                  </button>
                  <Button
                    size="sm"
                    className="h-8 rounded-full bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-cyan-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`);
                    }}
                  >
                    Service Now
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/80 p-2 shadow-[0_18px_60px_-48px_rgba(8,47,73,0.75)] backdrop-blur">
        <Button
          onClick={handlePrimaryHomeAction}
          disabled={primaryActionConfig.disabled}
          className="h-[3.25rem] w-full rounded-[1.15rem] bg-cyan-600 px-4 text-sm font-semibold text-white shadow-[0_18px_38px_-24px_rgba(8,145,178,0.95)] hover:bg-cyan-700 disabled:border disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500 disabled:shadow-none"
        >
          <primaryActionConfig.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{primaryActionConfig.label}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={handleOpenOffDayPicker}
          className="mt-2 h-auto w-full rounded-[1rem] px-4 py-2.5 text-sm font-semibold text-cyan-700 shadow-none hover:bg-cyan-50 hover:text-cyan-800 focus-visible:ring-2 focus-visible:ring-cyan-500/30"
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
          <span>Service another day</span>
        </Button>
      </div>

      <QuickStats
        total={stats.total}
        completed={stats.completed}
        skipped={stats.skipped}
        pending={stats.pending}
      />

      {customers.length === 0 ? (
        <div className="mb-24 rounded-[1.75rem] border border-white/80 bg-white/80 px-5 py-7 text-center shadow-[0_24px_80px_-58px_rgba(8,47,73,0.85)] backdrop-blur">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 shadow-inner">
            <Calendar className="h-7 w-7" aria-hidden="true" />
          </div>
          <h3 className="mb-2 text-xl font-semibold tracking-[-0.035em] text-slate-950">
            No Customers Scheduled
          </h3>
          <p className="mx-auto max-w-sm text-sm font-medium leading-6 text-slate-600">
            You have no customers scheduled for {dayOfWeek}. Use Add First Client above to build the route.
          </p>
        </div>
      ) : (
        <section className="space-y-3" aria-label="Today's customers">
          {customers.map((customer) => (
            <div key={customer._id}>
              <CustomerCard
                customer={customer}
                isCompleted={isCompleted(customer._id)}
                isSkipped={isSkipped(customer._id)}
                lastWeekLog={getLastWeekLog(customer._id)}
                onClick={() => handleCustomerClick(customer)}
                onStart={() => handleCustomerStart(customer)}
                onSkip={() => handleSkipCustomer(customer)}
                onUnskip={() => handleUnskipCustomer(customer)}
                onCall={() => handleCallCustomer(customer)}
                onMap={() => handleMapCustomer(customer)}
                serviceConfidence={getServiceConfidence(customer._id)}
              />
            </div>
          ))}
        </section>
      )}

      <OffDayServicePickerDialog
        open={offDayPickerOpen}
        onOpenChange={setOffDayPickerOpen}
        todayDay={dayOfWeek}
        availableDays={availableOffDays}
        selectedDay={selectedOffDay}
        onSelectedDayChange={setSelectedOffDay}
        searchQuery={offDaySearchQuery}
        onSearchQueryChange={setOffDaySearchQuery}
        clients={offDayClients}
        onStartClient={handleStartOffDayClient}
      />
    </main>
  );
}
