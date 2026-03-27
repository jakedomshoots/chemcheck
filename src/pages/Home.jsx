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

// Get the current week key for localStorage
function getWeekKey() {
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  return `skipped_services_${format(weekStart, 'yyyy-MM-dd')}`;
}

// Get skipped customers for this week from localStorage
function getSkippedCustomers() {
  try {
    const key = getWeekKey();
    const stored = localStorage.getItem(key);
    return stored ? normalizeSkippedCustomerIds(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

// Save skipped customers for this week to localStorage
function saveSkippedCustomers(customerIds) {
  try {
    const key = getWeekKey();
    const normalizedIds = normalizeSkippedCustomerIds(customerIds);
    localStorage.setItem(key, JSON.stringify(normalizedIds));

    // Clean up old week keys (only once per week)
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

  // Check user's default view preference and redirect if needed
  useEffect(() => {
    // Wait for user data to load
    if (!user) return;
    if (hasCheckedDefaultView) return;

    // Only check once per session to avoid redirect loops
    const sessionKey = 'chemcheck_default_view_checked';
    const alreadyChecked = sessionStorage.getItem(sessionKey);

    if (!alreadyChecked) {
      const defaultView = user?.preferences?.defaultView;

      // Mark as checked for this session
      sessionStorage.setItem(sessionKey, 'true');
      setHasCheckedDefaultView(true);

      // Redirect to Clients page if user prefers "customers" view
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
      // Don't set loading to true - show skeleton instead
      try {
        // Store all customers
        setAllCustomers(allCustomersData);

        // Filter and sort today's customers
        let todaysCustomers = [];
        if (dayOfWeek !== "Sunday" && dayOfWeek !== "Saturday") {
          todaysCustomers = allCustomersData
            .filter((c) => c.service_day === dayOfWeek)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        }
        setCustomers(todaysCustomers);

        // Filter today's logs
        const logs = allLogsData.filter(log => log.service_date === today);
        setTodayLogs(logs);

        // Get this week's logs for missed service detection
        const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
        const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

        const thisWeekLogs = allLogsData.filter(log => {
          try {
            const logDate = parseLocalDate(log.service_date);
            return logDate && logDate >= weekStart && logDate <= weekEnd;
          } catch {
            return false;
          }
        });
        setAllThisWeekLogs(thisWeekLogs);

        // Filter last week's logs
        const lastWeekStart = startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });
        const lastWeekEnd = endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });

        const lastWeek = allLogsData.filter(log => {
          try {
            const logDate = parseLocalDate(log.service_date);
            return logDate && logDate >= lastWeekStart && logDate <= lastWeekEnd;
          } catch {
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

  // Calculate missed services from previous days this week
  const missedServices = useMemo(() => {
    const currentDayIndex = daysOrder.indexOf(dayOfWeek);

    if (currentDayIndex === -1 || dayOfWeek === "Sunday" || dayOfWeek === "Saturday") {
      return [];
    }

    // Get all customers scheduled before today this week
    const previousDays = daysOrder.slice(0, currentDayIndex);
    const missedCustomers = [];

    previousDays.forEach(day => {
      // Check ALL customers, not just today's
      const dayCustomers = allCustomers.filter(c => c.service_day === day);

      dayCustomers.forEach(customer => {
        // Check if they have a log this week
        const hasLogThisWeek = allThisWeekLogs.some(log =>
          log.customer_id === customer._id
        );

        // Check if they've been skipped this week
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

  // Drop stale skipped entries after service is completed this week.
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
      // Pass customer data via navigation state to avoid redundant lookup
      navigate(createPageUrl("CustomerDetail") + `?id=${customer._id}`, {
        state: { customer, lastWeekLog: getLastWeekLog(customer._id) }
      });
    } else {
      // Pass customer data for instant form render
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
    const query = encodeURIComponent(customer.address);
    window.open(`https://maps.google.com/?q=${query}`, "_blank", "noopener,noreferrer");
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

  const primaryActionConfig = homePrimaryAction === 'open_route_plan'
    ? { icon: Route, label: 'Open Route Plan', disabled: false }
    : homePrimaryAction === 'add_client'
      ? { icon: Plus, label: 'Add Client', disabled: false }
      : {
          icon: PlayCircle,
          label: nextPendingCustomer ? `Start Next: ${nextPendingCustomer.full_name}` : "No Pending Stops",
          disabled: !nextPendingCustomer,
        };

  if (loading) {
    // Show skeleton immediately instead of blocking spinner
    return (
      <main className="max-w-7xl mx-auto px-3 py-4 font-sans" aria-label="Home">
        <div className="mb-4">
          <div className="mb-1">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">Today&apos;s Route</h2>
              <p className="text-xs font-medium text-slate-600">
                {dayOfWeek}, {format(new Date(), "MMM dd, yyyy")}
              </p>
            </div>
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
    <main className="max-w-7xl mx-auto px-3 py-4 font-sans" aria-label="Home">
      <div className="mb-4">
        <div className="mb-1">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Today&apos;s Route</h2>
            <p className="text-xs font-medium text-slate-600">
              {dayOfWeek}, {format(new Date(), "MMM dd, yyyy")}
            </p>
          </div>
        </div>
      </div>

      {/* Missed Services Alert */}
      {missedServices.length > 0 && (
        <div className="mb-4 bg-white rounded-xl shadow-sm border border-slate-200/60 border-l-4 border-l-amber-400 overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 stroke-[2]" />
              <span className="text-sm font-semibold text-slate-800">
                {missedServices.length} Missed
              </span>
            </div>
            {missedServices.length > 2 && (
              <button
                onClick={() => setMissedExpanded(!missedExpanded)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
              >
                {missedExpanded ? 'Show less' : `+${missedServices.length - 2} more`}
              </button>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {(missedExpanded ? missedServices : missedServices.slice(0, 2)).map(customer => (
              <div
                key={customer._id}
                className="px-4 py-2.5 flex items-center justify-between gap-3"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`)}
                >
                  <p className="text-sm font-medium text-slate-800 truncate">{customer.full_name || 'Customer'}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {customer.scheduledDay} · {customer.address}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="text-xs text-slate-400 hover:text-slate-600 font-medium transition-colors px-2 py-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSkipCustomer(customer);
                    }}
                  >
                    Skip
                  </button>
                  <Button
                    size="sm"
                    className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white h-7 text-xs font-medium rounded-lg px-3"
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

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          onClick={handlePrimaryHomeAction}
          disabled={primaryActionConfig.disabled}
          className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg"
        >
          <primaryActionConfig.icon className="w-4 h-4 mr-2" />
          {primaryActionConfig.label}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleOpenOffDayPicker}
          className="border-2 border-slate-200 hover:border-cyan-500 text-slate-700"
        >
          <Calendar className="w-4 h-4 mr-2" />
          Service Another Day
        </Button>
      </div>

      {showOpsBrief && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-4 h-4 text-cyan-700" />
            <h3 className="text-sm font-semibold text-slate-900">Daily Ops Brief</h3>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Estimated Route</p>
              <p className="text-lg font-bold text-cyan-700 flex items-center gap-1">
                <Route className="w-3.5 h-3.5" />
                {opsBrief.pendingStops} stops · {formatRouteDuration(opsBrief.estimatedRouteMinutes)}
              </p>
            </div>
          </div>
        </div>
      )}

      <QuickStats
        total={stats.total}
        completed={stats.completed}
        skipped={stats.skipped}
        pending={stats.pending}
      />

      {customers.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-3 bg-slate-100 rounded-full flex items-center justify-center">
            <Calendar className="w-8 h-8 text-slate-400 stroke-[1.75]" />
          </div>
          <h3 className="text-lg font-bold tracking-tight text-slate-900 mb-2">
            No Customers Scheduled
          </h3>
          <p className="text-sm font-medium text-slate-600 mb-4">
            You have no customers scheduled for {dayOfWeek}
          </p>
          <Button
            onClick={() => navigate(createPageUrl("Clients"))}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg font-semibold"
          >
            <Plus className="w-4 h-4 mr-2 stroke-[1.75]" />
            Add Clients
          </Button>
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
