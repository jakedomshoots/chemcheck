import { useState, useEffect, useMemo } from "react";
import { useActivePoolCustomerIds, useCustomersFilter, useServiceLogs, useCurrentUser } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { createPageUrl, parseLocalDate } from "@/utils";
import { PoolIcon, IconBadge } from "@/components/ui/iconography";
import { Button } from "@/components/ui/button";
import { format, subWeeks, startOfWeek, endOfWeek } from "date-fns";
import CustomerCard from "../components/home/CustomerCard";
import OffDayServicePickerDialog from "@/components/home/OffDayServicePickerDialog";
import QuickStats from "../components/home/QuickStats";
import TodayGlance from "@/components/route/TodayGlance";
import { CustomerCardSkeleton, QuickStatsSkeleton } from "@/components/ui/skeleton";
import { RouteCompleteCelebration } from "@/components/home/RouteCompleteCelebration";
import { navigateWithTransition, transitionName } from "@/lib/viewTransitions";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import { trackUxEvent } from "@/lib/uxAnalytics";
import { getEffectiveWorkingDays } from "@/lib/workingDays";
import { compareWithinDay } from "@/lib/customerOrdering";
import {
  buildDurationProfile,
  calculateServiceTimingSummary,
  estimateRouteFinishTime,
} from "@/lib/routeTimingEstimator";
import { getObservedDriveProfile, startDriveTimeCapture } from "@/lib/native/location";
import { buildTodayGlancePayload, publishTodayGlance } from "@/lib/native/platform";
import { buildNavigationUrl } from "@/lib/mapNavigation";

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
  const activePoolCustomerIds = useActivePoolCustomerIds();
  const allLogsData = useServiceLogs("-service_date", 100);

  const activeCustomersData = useMemo(
    () => allCustomersData.filter((customer) => activePoolCustomerIds.has(Number(customer._id))),
    [activePoolCustomerIds, allCustomersData]
  );

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
  const [celebrationOpen, setCelebrationOpen] = useState(false);

  // Arrival feedback for a just-logged service — the confetti fires HERE, on
  // the destination screen, instead of mid-unmount on the form.
  useEffect(() => {
    let payload = null;
    try {
      const raw = sessionStorage.getItem('chemcheck_last_service');
      if (!raw) return;
      sessionStorage.removeItem('chemcheck_last_service');
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload?.name) {
      toast.success(`Logged ${payload.name}`);
    }
    try {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#06b6d4', '#0891b2', '#22d3ee', '#0e7490'],
          disableForReducedMotion: true,
        });
      }
    } catch {
      /* confetti is decoration; never break the route over it */
    }
  }, []);

  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const dayOfWeek = useMemo(() => format(new Date(), "EEEE"), []);
  const homePrimaryAction = user?.preferences?.home_primary_action || 'start_next_pending';
  // Key the memo on the day list's content: the business query can hand back a
  // fresh object each render, and a fresh array here would re-run every
  // effect that depends on it.
  const workingDaysKey = getEffectiveWorkingDays(convexBusiness).join('|');
  const workingDays = useMemo(() => workingDaysKey.split('|'), [workingDaysKey]);
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
    if (activeCustomersData && allLogsData) {
      try {
        setAllCustomers(activeCustomersData);

        let todaysCustomers = [];
        if (workingDays.includes(dayOfWeek)) {
          todaysCustomers = activeCustomersData
            .filter((c) => c.service_day === dayOfWeek)
            .sort(compareWithinDay);
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
  }, [activeCustomersData, allLogsData, today, dayOfWeek, workingDays]);

  const missedServices = useMemo(() => {
    const currentDayIndex = daysOrder.indexOf(dayOfWeek);

    if (currentDayIndex === -1 || !workingDays.includes(dayOfWeek)) {
      return [];
    }

    // Only working days that came earlier this week can have been missed.
    const previousDays = daysOrder.slice(0, currentDayIndex).filter((day) => workingDays.includes(day));
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
  }, [allCustomers, allThisWeekLogs, dayOfWeek, skippedCustomers, workingDays]);

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
      .sort(compareWithinDay);
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
    toast.warning(`Skipped ${customer.full_name || 'Customer'} for this week`);
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
      navigateWithTransition(navigate, createPageUrl("CustomerDetail") + `?id=${customer._id}`, {
        state: { customer, lastWeekLog: getLastWeekLog(customer._id) }
      });
    } else {
      navigateWithTransition(navigate, createPageUrl("NewServiceLog") + `?customerId=${customer._id}`, {
        state: { customer, lastWeekLog: getLastWeekLog(customer._id) }
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

  // The payoff moment: when today's route has nothing left pending, the app
  // celebrates once per day — water light, haptics, the day's numbers.
  useEffect(() => {
    if (loading) return;
    if (stats.total === 0 || stats.pending !== 0) return;
    const key = `chemcheck_route_celebrated_${today}`;
    try {
      if (localStorage.getItem(key) === '1') return;
      localStorage.setItem(key, '1');
    } catch {
      /* private mode — celebrate anyway */
    }
    setCelebrationOpen(true);
  }, [loading, stats.total, stats.pending, today]);

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

  // Drive-time capture: observe proof-of-service time tracking for the rest of
  // the session so drives between stops become route estimates. Silent on
  // the web without location permission.
  useEffect(() => {
    try {
      startDriveTimeCapture();
    } catch {
      /* no location provider — the route works without drive data */
    }
  }, []);

  const driveProfile = useMemo(() => {
    try {
      return getObservedDriveProfile();
    } catch {
      return new Map();
    }
  }, [todayLogs]);

  const lastCompletedCustomerId = useMemo(() => {
    const latest = [...todayLogs]
      .filter((log) => log?.end_time)
      .sort((a, b) => String(b.end_time).localeCompare(String(a.end_time)))[0];
    return latest?.customer_id ?? null;
  }, [todayLogs]);

  const finishEstimate = useMemo(() => {
    const pendingCustomers = customers.filter((c) => !isCompleted(c._id) && !isSkipped(c._id));
    return estimateRouteFinishTime(pendingCustomers, {
      customerMedianById: durationProfile.customerMedianById,
      serviceFallback: 15,
      driveProfile,
      fromCustomerId: lastCompletedCustomerId,
    });
  }, [customers, completedCustomerIds, skippedCustomerIds, durationProfile, driveProfile, lastCompletedCustomerId]);

  // Mirror the glance into a native widget when a shell provides one
  // (documented no-op otherwise — see src/lib/native/platform.ts).
  useEffect(() => {
    if (loading || stats.total === 0) return;
    const payload = buildTodayGlancePayload({
      date: today,
      totalStops: stats.total,
      completedStops: stats.completed,
      skippedStops: stats.skipped,
      nextStop: nextPendingCustomer
        ? {
            customerId: nextPendingCustomer._id,
            name: nextPendingCustomer.full_name,
            address: nextPendingCustomer.address,
            mapsUrl: nextPendingCustomer.address ? buildNavigationUrl(nextPendingCustomer.address) : "",
          }
        : null,
      estimatedFinishAt: finishEstimate.finishAt,
    });
    void publishTodayGlance(payload);
  }, [loading, today, stats.total, stats.completed, stats.skipped, nextPendingCustomer, finishEstimate.finishAt]);

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
    navigateWithTransition(navigate, createPageUrl("NewServiceLog") + `?customerId=${nextPendingCustomer._id}`, {
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
    navigateWithTransition(navigate, createPageUrl("NewServiceLog") + `?customerId=${customer._id}`, {
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
    ? { icon: "add", label: 'Add First Client', disabled: false }
    : homePrimaryAction === 'open_route_plan'
      ? { icon: "route", label: 'Open Route Plan', disabled: false }
      : homePrimaryAction === 'add_client'
        ? { icon: "add", label: 'Add Client', disabled: false }
        : {
            icon: "start",
            label: nextPendingCustomer ? `Start Next: ${nextPendingCustomer.full_name}` : "No Pending Stops",
            disabled: !nextPendingCustomer,
          };

  if (loading) {
    return (
      <main id="main-content" className="relative mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Home">
        <div className="mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card ">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.035em] text-ink">Today's Route</h2>
            <p className="mt-1 text-sm font-medium text-ink-muted">
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
    <main id="main-content" className="relative mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Home">
      <div
        data-testid="route-header"
        className="mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-3xl font-semibold leading-tight tracking-[-0.045em] text-ink sm:text-4xl">
              Today's Route
            </h2>
            <p className="mt-1 text-sm font-medium text-ink-muted">
              {dayOfWeek}, {format(new Date(), "MMM dd, yyyy")}
            </p>
          </div>

          {showOpsBrief && (
            <aside
              aria-label="Daily Ops Brief"
              className="w-full rounded-2xl border border-[var(--status-info-line)] bg-[var(--status-info-soft)] px-4 py-3 sm:w-auto sm:min-w-[250px] sm:max-w-[300px] sm:shrink-0"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-info">
                    <PoolIcon name="ops" className="h-4 w-4 shrink-0" />
                    <span>Daily Ops Brief</span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-ink-muted">Estimated route</p>
                </div>
                <p className="flex shrink-0 items-center gap-1 whitespace-nowrap text-base font-semibold tabular-nums text-info">
                  <PoolIcon name="route" className="h-4 w-4" />
                  {opsBrief.pendingStops} stops · {formatRouteDuration(opsBrief.estimatedRouteMinutes)}
                </p>
              </div>
            </aside>
          )}
        </div>

        {stats.total > 0 && (
          <div className="mt-4">
            <div
              className="flex items-center justify-between gap-3 text-xs font-medium text-ink-muted"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span>{stats.completed} of {stats.total} stops logged</span>
              {stats.skipped > 0 && <span>{stats.skipped} skipped</span>}
            </div>
            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-label="Stops logged"
              aria-valuemin={0}
              aria-valuemax={stats.total}
              aria-valuenow={stats.completed}
              aria-valuetext={`${stats.completed} of ${stats.total} stops logged`}
            >
              <div
                className="route-progress-bar h-full rounded-full bg-brand"
                style={{ '--route-progress': stats.total ? (stats.completed / stats.total) * 100 : 0 }}
              />
            </div>
          </div>
        )}
      </div>

      {missedServices.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-raised border surface-watch shadow-card">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <PoolIcon name="warning" className="h-4 w-4 text-watch" />
              <span className="text-sm font-semibold text-ink">
                {missedServices.length} Missed
              </span>
            </div>
            {missedServices.length > 2 && (
              <button
                type="button"
                onClick={() => setMissedExpanded(!missedExpanded)}
                aria-expanded={missedExpanded}
                aria-controls="missed-services-list"
                className="min-h-11 rounded-full px-3 py-1.5 text-xs font-semibold text-watch transition-colors hover:bg-[var(--status-watch-line)]"
              >
                {missedExpanded ? 'Show less' : `+${missedServices.length - 2} more`}
              </button>
            )}
          </div>
          <ul id="missed-services-list" className="divide-y divide-[var(--status-watch-line)]" aria-label="Missed services">
            {(missedExpanded ? missedServices : missedServices.slice(0, 2)).map(customer => (
              <li
                key={customer._id}
                className="flex items-center justify-between gap-3 px-4 py-2"
              >
                <button
                  type="button"
                  className="min-h-11 min-w-0 flex-1 rounded-control text-left transition-colors hover:bg-surface-1/60"
                  onClick={() => navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`)}
                  aria-label={`Open service log for ${customer.full_name || 'Customer'}, missed ${customer.scheduledDay}`}
                >
                  <p className="truncate text-sm font-semibold text-ink">{customer.full_name || 'Customer'}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {customer.scheduledDay} · {customer.address}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="min-h-11 rounded-full px-3 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-1 hover:text-ink-secondary"
                    aria-label={`Skip ${customer.full_name || 'Customer'} this week`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSkipCustomer(customer);
                    }}
                  >
                    Skip
                  </button>
                  <Button
                    size="sm"
                    className="h-11 rounded-full bg-ink px-3 text-xs font-semibold text-surface-0 hover:bg-ink-secondary"
                    aria-label={`Service ${customer.full_name || 'Customer'} now`}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateWithTransition(navigate, createPageUrl("NewServiceLog") + `?customerId=${customer._id}`);
                    }}
                  >
                    Service Now
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-2 shadow-card">
        <Button
          onClick={handlePrimaryHomeAction}
          disabled={primaryActionConfig.disabled}
          className="h-[3.25rem] w-full rounded-card bg-brand px-4 text-sm font-semibold text-white shadow-cta hover:bg-brand-strong disabled:border disabled:border-line disabled:bg-surface-2 disabled:text-ink-muted disabled:shadow-none"
        >
          <PoolIcon name={primaryActionConfig.icon} className="h-4 w-4 shrink-0" />
          <span className="truncate">{primaryActionConfig.label}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={handleOpenOffDayPicker}
          className="mt-2 h-auto min-h-11 w-full rounded-card px-4 py-2.5 text-sm font-semibold text-brand-ink shadow-none hover:bg-brand-soft hover:text-brand-ink focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <PoolIcon name="serviceDay" className="h-4 w-4" />
          <span>Service another day</span>
        </Button>
      </div>

      <QuickStats
        total={stats.total}
        completed={stats.completed}
        skipped={stats.skipped}
        pending={stats.pending}
      />

      <TodayGlance
        total={stats.total}
        completed={stats.completed}
        skipped={stats.skipped}
        nextStop={nextPendingCustomer}
        finishAt={finishEstimate.finishAt}
        remainingMinutes={finishEstimate.remainingMinutes}
      />

      {customers.length === 0 ? (
        <div className="mb-24 rounded-sheet border border-line bg-surface-1 px-5 py-7 text-center shadow-card">
          <IconBadge name="empty" size="lg" tone="cyan" className="mx-auto mb-4" iconClassName="h-7 w-7 text-brand-ink" />
          <h3 className="mb-2 text-xl font-semibold tracking-[-0.035em] text-ink">
            No Customers Scheduled
          </h3>
          <p className="mx-auto max-w-sm text-sm font-medium leading-6 text-ink-secondary">
            You have no customers scheduled for {dayOfWeek}. Use Add First Client above to build the route.
          </p>
        </div>
      ) : (
        <section className="mb-24" aria-label="Today's customers">
          <div className="flex items-center justify-between px-1 pb-2">
            <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-muted">
              Stop order
            </h3>
            <span className="font-data text-xs font-semibold text-ink-muted">
              {customers.length} {customers.length === 1 ? "stop" : "stops"}
            </span>
          </div>
          <ol className="divide-y divide-line border-y border-line bg-surface-1">
            {customers.map((customer, index) => (
              <li key={customer._id} style={transitionName(`customer-${customer._id}`)}>
                <CustomerCard
                  customer={customer}
                  stopNumber={index + 1}
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
              </li>
            ))}
          </ol>
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

      {celebrationOpen && (
        <RouteCompleteCelebration
          completed={stats.completed}
          total={stats.total}
          onClose={() => setCelebrationOpen(false)}
        />
      )}
    </main>
  );
}
