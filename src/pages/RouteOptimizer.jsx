import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useCustomersFilter, useCurrentUser, useServiceLogs } from "@/api/convexHooks";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Navigation,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  X,
  Flag,
  Play,
  RefreshCw,
  Settings,
  UserPlus,
} from "lucide-react";
import { PoolIcon, IconBadge } from "@/components/ui/iconography";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { toast } from "sonner";
import { routeOptimizer } from "@/lib/routeOptimizer";
import { openNavigation } from "@/lib/mapNavigation";
import {
  buildDurationProfile,
  calculateServiceTimingSummary,
  parseClockToMinutes,
  resolveServiceDurationMinutes,
} from "@/lib/routeTimingEstimator";

const DEFAULT_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const normalizeDayName = (value) => {
  if (!value) return null;
  switch (String(value).trim().toLowerCase()) {
    case "sun":
    case "sunday":
      return "Sunday";
    case "mon":
    case "monday":
      return "Monday";
    case "tue":
    case "tues":
    case "tuesday":
      return "Tuesday";
    case "wed":
    case "weds":
    case "wednesday":
      return "Wednesday";
    case "thu":
    case "thur":
    case "thurs":
    case "thursday":
      return "Thursday";
    case "fri":
    case "friday":
      return "Friday";
    case "sat":
    case "saturday":
      return "Saturday";
    default:
      return null;
  }
};

const formatMinutes = (minutes) => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const hasNavigableAddress = (address) => (
  typeof address === "string" && address.trim().length > 0 && address !== "No address on file"
);

const hasServiceAddress = (customer) => hasNavigableAddress(customer?.address);

const getReferenceDateForDay = (dayName) => {
  const normalizedDay = normalizeDayName(dayName);
  let targetIndex = -1;
  switch (normalizedDay) {
    case "Sunday":
      targetIndex = 0;
      break;
    case "Monday":
      targetIndex = 1;
      break;
    case "Tuesday":
      targetIndex = 2;
      break;
    case "Wednesday":
      targetIndex = 3;
      break;
    case "Thursday":
      targetIndex = 4;
      break;
    case "Friday":
      targetIndex = 5;
      break;
    case "Saturday":
      targetIndex = 6;
      break;
    default:
      targetIndex = -1;
  }
  const now = new Date();
  if (targetIndex < 0) return now;
  const delta = (targetIndex - now.getDay() + 7) % 7;
  const targetDate = new Date(now);
  targetDate.setDate(now.getDate() + delta);
  return targetDate;
};

export default function RouteOptimizer() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const allCustomers = useCustomersFilter(user?.email ? { created_by: user.email } : undefined);
  const recentServiceLogs = useServiceLogs("-service_date", 1500);
  const convexBusiness = useQuery(api.businesses.getCurrent);

  const routeOptimizationEnabled = convexBusiness?.settings?.route_optimization ?? true;
  const workingHoursStart = convexBusiness?.settings?.working_hours_start || "08:00";
  const workingHoursEnd = convexBusiness?.settings?.working_hours_end || "17:00";
  const businessAddress = convexBusiness?.address;
  const configuredDays = useMemo(() => {
    const settingsDays = convexBusiness?.settings?.working_days;
    const sourceDays = settingsDays?.length > 0 ? settingsDays : DEFAULT_DAYS;
    const normalizedDays = sourceDays
      .map((day) => normalizeDayName(day))
      .filter(Boolean);

    if (normalizedDays.length === 0) return DEFAULT_DAYS;
    return [...new Set(normalizedDays)];
  }, [convexBusiness?.settings?.working_days]);

  const [customers, setCustomers] = useState([]);
  const [selectedDay, setSelectedDay] = useState(() => normalizeDayName(format(new Date(), "EEEE")) || "Monday");
  const [optimizedRoute, setOptimizedRoute] = useState(null);
  const [builtContextKey, setBuiltContextKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [routeRunnerActive, setRouteRunnerActive] = useState(false);
  const [routeCompleted, setRouteCompleted] = useState(false);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [routeWarnings, setRouteWarnings] = useState([]);
  const [routeError, setRouteError] = useState(null);
  const isMountedRef = useRef(true);

  const daysOfWeek = useMemo(() => {
    const scheduledDays = customers
      .map((customer) => normalizeDayName(customer.service_day))
      .filter(Boolean);
    const visibleDays = new Set([...configuredDays, ...scheduledDays]);
    return DEFAULT_DAYS.filter((day) => visibleDays.has(day));
  }, [configuredDays, customers]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (allCustomers !== undefined) {
      setCustomers(allCustomers || []);
      setLoading(false);
    }
  }, [allCustomers]);

  useEffect(() => {
    if (daysOfWeek.length === 0) return;
    if (!daysOfWeek.includes(selectedDay)) {
      setSelectedDay(daysOfWeek[0]);
    }
  }, [daysOfWeek, selectedDay]);

  const customerDayCounts = useMemo(() => {
    const counts = new Map();
    for (const customer of customers) {
      const normalizedDay = normalizeDayName(customer.service_day);
      if (!normalizedDay) continue;
      counts.set(normalizedDay, (counts.get(normalizedDay) || 0) + 1);
    }
    return counts;
  }, [customers]);

  const dayCustomers = useMemo(
    () => customers.filter((customer) => normalizeDayName(customer.service_day) === selectedDay),
    [customers, selectedDay]
  );

  const missingAddressCount = useMemo(
    () => dayCustomers.filter((customer) => !hasServiceAddress(customer)).length,
    [dayCustomers]
  );

  const alternateScheduledDay = useMemo(() => {
    if (daysOfWeek.length < 2) return null;
    const selectedIndex = Math.max(daysOfWeek.indexOf(selectedDay), 0);
    for (let offset = 1; offset < daysOfWeek.length; offset += 1) {
      const day = daysOfWeek[(selectedIndex + offset) % daysOfWeek.length];
      if ((customerDayCounts.get(day) || 0) > 0) return day;
    }
    return null;
  }, [customerDayCounts, daysOfWeek, selectedDay]);

  const durationProfile = useMemo(
    () => buildDurationProfile(recentServiceLogs),
    [recentServiceLogs]
  );

  const optimizationContextKey = useMemo(() => JSON.stringify({
    selectedDay,
    workingHoursStart,
    businessAddress: businessAddress || null,
    customers: dayCustomers.map((customer) => ({
      id: String(customer?._id ?? customer?.id ?? ""),
      name: customer?.full_name ?? customer?.name ?? "",
      address: customer?.address || "",
      gateCode: customer?.gate_code ?? null,
      poolType: customer?.pool_type ?? null,
      poolGallons: customer?.pool_gallons ?? null,
      order: customer?.sort_order ?? null,
      duration: customer?.estimatedDuration ?? customer?.estimated_duration ?? customer?.duration_ms ?? null,
    })),
  }), [businessAddress, dayCustomers, selectedDay, workingHoursStart]);
  const optimizationContextRef = useRef(optimizationContextKey);

  useEffect(() => {
    optimizationContextRef.current = optimizationContextKey;
  }, [optimizationContextKey]);

  useEffect(() => {
    if (!optimizedRoute || !builtContextKey || builtContextKey === optimizationContextKey) return;
    setOptimizedRoute(null);
    setBuiltContextKey(null);
    setRouteWarnings([]);
    setRouteRunnerActive(false);
    setRouteCompleted(false);
    setCurrentStopIndex(0);
    setRouteError("The saved schedule changed. Generate a fresh plan before starting the route.");
  }, [builtContextKey, optimizationContextKey, optimizedRoute]);

  useEffect(() => {
    setOptimizedRoute(null);
    setBuiltContextKey(null);
    setRouteWarnings([]);
    setRouteError(null);
    setRouteRunnerActive(false);
    setRouteCompleted(false);
    setCurrentStopIndex(0);
  }, [selectedDay]);

  const optimizeRoute = useCallback(async () => {
    if (dayCustomers.length === 0 || optimizing) return;
    const contextAtStart = optimizationContextKey;
    setOptimizing(true);
    setRouteError(null);
    setRouteCompleted(false);
    try {
      const customerById = new Map(
        dayCustomers.map((customer) => [String(customer._id ?? customer.id), customer])
      );
      const targetDate = getReferenceDateForDay(selectedDay);
      const customersForOptimization = dayCustomers.map((customer) => {
        const customerId = Number(customer?._id ?? customer?.id);
        const historicalDuration = Number.isFinite(customerId)
          ? durationProfile.customerMedianById.get(customerId) ?? null
          : null;
        const estimatedDuration = resolveServiceDurationMinutes(customer, {
          customerMedian: historicalDuration,
          fallback: 15,
        });

        return { ...customer, estimatedDuration };
      });

      const startLocation = businessAddress
        ? await routeOptimizer.geocodeAddress(businessAddress)
        : undefined;

      const route = await routeOptimizer.optimizeRoute(customersForOptimization, targetDate, {
        startTime: workingHoursStart,
        startLocation,
        prioritizeTimeWindows: true,
        prioritizeHighPriority: true,
        algorithm: "nearest-neighbor",
      });

      if (!isMountedRef.current || optimizationContextRef.current !== contextAtStart) {
        toast.info("Your schedule changed while the plan was building. Generate it again for the latest stops.");
        return;
      }

      if (route.stops.length === 0) {
        toast.info(`No route stops found for ${selectedDay}.`);
        setOptimizedRoute(null);
        setRouteError(`No usable stops were found for ${selectedDay}. Check each customer’s service day and address, then try again.`);
        return;
      }

      const optimizedStops = route.stops.map((stop, idx) => {
        const originalCustomer = customerById.get(String(stop.customer.id));
        const gateCodeText = originalCustomer?.gate_code ? `Gate code: ${originalCustomer.gate_code}` : null;
        const travelLabel = idx === 0
          ? (startLocation ? `~${Math.round(stop.travelTime)} min from business` : "Start here")
          : `~${Math.round(stop.travelTime)} min`;
        return {
          position: idx + 1,
          customer_name: stop.customer.name || "Unnamed customer",
          customer_address: stop.customer.address || "No address on file",
          estimated_travel_time_from_previous: travelLabel,
          raw_travel_time_minutes: Math.round(stop.travelTime),
          notes: gateCodeText,
          customer_location: stop.customer.location,
          customer: originalCustomer || stop.customer,
        };
      });

      const serviceSummary = calculateServiceTimingSummary(dayCustomers, {
        customerMedianById: durationProfile.customerMedianById,
        fallback: 15,
      });
      const totalMinutes = serviceSummary.totalServiceMinutes;
      const routeWarningsWithReadiness = [...(route.warnings || [])];
      if (missingAddressCount > 0) {
        routeWarningsWithReadiness.unshift(
          `${missingAddressCount} stop${missingAddressCount === 1 ? " has" : "s have"} no service address. Add ${missingAddressCount === 1 ? "it" : "them"} before navigating.`
        );
      }
      const omittedStopCount = Math.max(0, dayCustomers.length - optimizedStops.length);
      if (omittedStopCount > 0) {
        routeWarningsWithReadiness.unshift(
          `${omittedStopCount} scheduled stop${omittedStopCount === 1 ? " was" : "s were"} left out because its saved details could not be read.`
        );
      }

      setOptimizedRoute({
        optimized_order: optimizedStops,
        total_estimated_minutes: totalMinutes,
        total_estimated_time: formatMinutes(totalMinutes),
        total_service_minutes: totalMinutes,
        average_service_minutes: serviceSummary.timePerPoolMinutes,
        origin_address: startLocation ? businessAddress : null,
        optimization_summary: route.routing?.remote > 0 ? "Live travel data" : "Estimated travel data",
      });
      setBuiltContextKey(contextAtStart);
      setRouteWarnings([...new Set(routeWarningsWithReadiness)]);
      setRouteRunnerActive(false);
      setCurrentStopIndex(0);
    } catch (error) {
      console.error("[RouteOptimizer] Failed to generate route:", error);
      if (!isMountedRef.current || optimizationContextRef.current !== contextAtStart) return;
      setRouteError(
        optimizedRoute
          ? "We couldn’t refresh this plan. Your last generated route is still available below."
          : "We couldn’t build the route plan. Check your connection and customer addresses, then try again."
      );
      toast.error("Could not generate route plan. Please try again.");
    } finally {
      if (isMountedRef.current) setOptimizing(false);
    }
  }, [
    businessAddress,
    dayCustomers,
    durationProfile,
    missingAddressCount,
    optimizedRoute,
    optimizationContextKey,
    optimizing,
    selectedDay,
    workingHoursStart,
  ]);

  const availableWorkingMinutes = useMemo(() => {
    const startMinutes = parseClockToMinutes(workingHoursStart);
    const endMinutes = parseClockToMinutes(workingHoursEnd);
    if (startMinutes === null || endMinutes === null) return null;
    if (endMinutes <= startMinutes) return null;
    return endMinutes - startMinutes;
  }, [workingHoursStart, workingHoursEnd]);

  const exceedsWorkingHours = useMemo(() => {
    if (!optimizedRoute || availableWorkingMinutes === null) return false;
    return optimizedRoute.total_estimated_minutes > availableWorkingMinutes;
  }, [optimizedRoute, availableWorkingMinutes]);

  const handleStartRoute = useCallback(() => {
    if (!optimizedRoute?.optimized_order?.length) return;
    setRouteCompleted(false);
    setRouteRunnerActive(true);
    setCurrentStopIndex(0);
  }, [optimizedRoute]);

  const handleExitRouteRunner = useCallback(() => {
    setRouteRunnerActive(false);
  }, []);

  const handleNextStop = useCallback(() => {
    if (!optimizedRoute) return;
    if (currentStopIndex >= optimizedRoute.optimized_order.length - 1) {
      setRouteRunnerActive(false);
      setRouteCompleted(true);
      toast.success("Route complete!");
      return;
    }
    setCurrentStopIndex((prev) => prev + 1);
  }, [currentStopIndex, optimizedRoute]);

  const handlePreviousStop = useCallback(() => {
    setCurrentStopIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleNavigateToStop = useCallback((address, location) => {
    if (!hasNavigableAddress(address)) {
      toast.error("No address available for navigation.");
      return;
    }
    openNavigation(location ? { address, latitude: location.latitude, longitude: location.longitude } : address);
  }, []);

  const handleAddCustomer = useCallback(() => {
    navigate(createPageUrl("NewClient"), {
      state: { serviceDay: selectedDay, source: "route_planner" },
    });
  }, [navigate, selectedDay]);

  if (loading) {
    return (
      <main className="relative mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Route Planner">
        <div className="mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card ">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.035em] text-ink">Route Planner</h2>
            <p className="mt-1 text-sm font-medium text-ink-muted">Loading your customers...</p>
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="relative mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Route Planner">
      <div className="mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card ">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-3xl font-semibold leading-tight tracking-[-0.045em] text-ink sm:text-4xl">
            <Navigation className="h-7 w-7 text-brand-ink" aria-hidden="true" />
            Route Planner
          </h2>
          <p className="mt-1 text-sm font-medium text-ink-muted">Build a practical daily stop order from your saved customer list</p>
        </div>
      </div>

      <div className="mb-5 rounded-sheet border border-line bg-surface-1 p-5 shadow-card ">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-end">
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink">Select Service Day</label>
            <Select value={selectedDay} onValueChange={setSelectedDay} disabled={optimizing}>
              <SelectTrigger
                aria-label="Select Service Day"
                className="h-11 rounded-2xl border border-line bg-white text-ink focus:border-ring"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {daysOfWeek.map(day => (
                  <SelectItem key={day} value={day}>
                    {day} ({customerDayCounts.get(day) || 0} {(customerDayCounts.get(day) || 0) === 1 ? "customer" : "customers"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {routeOptimizationEnabled ? (
            <Button
              onClick={optimizeRoute}
              disabled={optimizing || dayCustomers.length === 0}
              className="h-12 rounded-full bg-brand px-6 font-semibold text-white shadow-cta hover:bg-brand-strong disabled:bg-surface-2 disabled:text-ink-muted disabled:shadow-none"
            >
              {optimizing ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" aria-hidden="true" />
                  Building plan…
                </>
              ) : (
                <>
                  <PoolIcon name="route" className="mr-2 h-4 w-4" />
                  Generate Route Plan
                </>
              )}
            </Button>
          ) : (
            <div className="flex min-h-12 flex-col gap-3 rounded-2xl border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-4 py-3 text-sm text-watch sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-watch" aria-hidden="true" />
                <span className="font-medium">Route planning is turned off</span>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(createPageUrl("Settings"))}
                className="h-10 rounded-full border-[var(--status-watch-line)] bg-surface-1 px-4 text-sm font-semibold text-watch hover:bg-white"
              >
                <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
                Open Settings
              </Button>
            </div>
          )}
        </div>

        {dayCustomers.length > 0 && (
          <div
            data-testid="route-readiness"
            className="mt-4 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-control border border-line bg-surface-2"
          >
            <div className="px-2 py-3 text-center">
              <div className="font-data text-lg font-semibold tabular-nums text-ink">{dayCustomers.length}</div>
              <div className="text-[11px] font-semibold text-ink-muted">Stops</div>
            </div>
            <div className="px-2 py-3 text-center">
              <div className={`font-data text-lg font-semibold tabular-nums ${missingAddressCount > 0 ? "text-watch" : "text-ok"}`}>
                {dayCustomers.length - missingAddressCount}/{dayCustomers.length}
              </div>
              <div className="text-[11px] font-semibold text-ink-muted">Addresses</div>
            </div>
            <div className="px-2 py-3 text-center">
              <div className="font-data text-sm font-semibold tabular-nums text-ink">{workingHoursStart}</div>
              <div className="text-[11px] font-semibold text-ink-muted">Start time</div>
            </div>
          </div>
        )}
      </div>

      {routeError && (
        <div
          role="alert"
          className="mb-5 flex flex-col gap-3 rounded-raised border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-4 py-3 text-sm text-watch sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="font-medium leading-5">{routeError}</span>
          </div>
          {routeOptimizationEnabled && dayCustomers.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={optimizeRoute}
              disabled={optimizing}
              className="h-10 shrink-0 rounded-full border-[var(--status-watch-line)] bg-surface-1 px-4 text-sm font-semibold text-watch hover:bg-white"
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try Again
            </Button>
          )}
        </div>
      )}

      {dayCustomers.length === 0 ? (
        <div className="rounded-sheet border border-line bg-surface-1 px-5 py-10 text-center shadow-card ">
          <IconBadge name="route" size="lg" tone="slate" className="mx-auto mb-4" iconClassName="h-7 w-7" />
          <h3 className="mb-2 text-xl font-semibold tracking-[-0.035em] text-ink">No Customers Scheduled</h3>
          <p className="mx-auto max-w-sm text-sm font-medium leading-6 text-ink-secondary">
            Add customers to {selectedDay} to build a route plan.
          </p>
          <div className="mx-auto mt-5 flex max-w-sm flex-col gap-2 sm:flex-row sm:justify-center">
            {alternateScheduledDay ? (
              <Button
                type="button"
                onClick={() => setSelectedDay(alternateScheduledDay)}
                className="h-11 rounded-full bg-brand px-5 font-semibold text-white shadow-cta hover:bg-brand-strong"
              >
                Plan {alternateScheduledDay}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleAddCustomer}
                className="h-11 rounded-full bg-brand px-5 font-semibold text-white shadow-cta hover:bg-brand-strong"
              >
                <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add First Customer
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={alternateScheduledDay ? handleAddCustomer : () => navigate(createPageUrl("Clients"))}
              className="h-11 rounded-full border-line bg-surface-1 px-5 font-semibold text-ink shadow-sm hover:bg-brand-softer hover:text-brand-ink"
            >
              {alternateScheduledDay ? `Add to ${selectedDay}` : "View Customer Schedule"}
            </Button>
          </div>
        </div>
      ) : !optimizedRoute ? (
        <div className="rounded-sheet border border-line bg-surface-1 p-8 text-center shadow-card ">
          <IconBadge name="route" size="lg" className="mx-auto mb-4" iconClassName="h-7 w-7" />
          <h3 className="mb-2 text-xl font-semibold tracking-[-0.035em] text-ink">Ready to Build Route</h3>
          <p className="mx-auto mb-3 max-w-md text-sm font-medium leading-6 text-ink-secondary">
            You have {dayCustomers.length} customer{dayCustomers.length !== 1 ? 's' : ''} scheduled for {selectedDay}.
          </p>
          <p className="mx-auto max-w-md text-xs font-medium leading-5 text-ink-muted">
            Generate a stop sequence from the saved customer addresses. Service-time totals stay separate from travel estimates.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card ">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <IconBadge name="route" size="sm" iconClassName="h-4 w-4" />
                <h3 className="text-lg font-semibold tracking-[-0.025em] text-ink">Route Summary</h3>
              </div>
              <span className="text-xs font-medium text-ink-muted">{optimizedRoute.optimization_summary}</span>
            </div>
            <div
              data-testid="route-summary-metrics"
              className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-raised border border-line bg-surface-2"
            >
              <div className="px-2 py-4 text-center">
                <div className="font-data text-2xl font-semibold tabular-nums tracking-[-0.04em] text-brand-ink">{optimizedRoute.optimized_order.length}</div>
                <div className="mt-1 text-[11px] font-semibold text-ink-muted">Stops</div>
              </div>
              <div className="px-2 py-4 text-center">
                <div className="font-data text-2xl font-semibold tabular-nums tracking-[-0.04em] text-ink">{optimizedRoute.total_estimated_time || "N/A"}</div>
                <div className="mt-1 text-[11px] font-semibold text-ink-muted">Service</div>
              </div>
              <div className="px-2 py-4 text-center">
                <div className="font-data text-2xl font-semibold tabular-nums tracking-[-0.04em] text-ink">{optimizedRoute.average_service_minutes || 0}</div>
                <div className="mt-1 text-[11px] font-semibold text-ink-muted">Min / stop</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 text-sm">
              <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface-1 px-3 py-2 text-ink-secondary">
                <Clock className="h-4 w-4 text-brand-ink" aria-hidden="true" />
                <span>
                  Working hours: <span className="font-semibold text-ink">{workingHoursStart} - {workingHoursEnd}</span>
                </span>
              </div>
              {optimizedRoute.origin_address && (
                <div className="rounded-2xl border border-line bg-surface-1 px-3 py-2 text-ink-secondary">
                  Starting from: <span className="font-semibold text-ink">{optimizedRoute.origin_address}</span>
                </div>
              )}
            </div>

            {exceedsWorkingHours && (
              <div className="mt-3 rounded-2xl border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-3 py-2 text-sm text-watch">
                Estimated route time exceeds configured working hours. Consider splitting stops or extending working hours.
              </div>
            )}

            {routeWarnings.length > 0 && (
              <div className="mt-3 rounded-2xl border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-3 py-2 text-sm text-watch" role="status">
                <div className="font-medium">Route readiness</div>
                <ul className="mt-1 list-disc pl-5">
                  {routeWarnings.slice(0, 2).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}

            {routeCompleted && !routeRunnerActive && (
              <div className="mt-3 flex items-start gap-2 rounded-2xl border border-[var(--status-ok-line)] bg-[var(--status-ok-soft)] px-3 py-3 text-sm text-ok" role="status">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <div className="font-semibold">Route complete</div>
                  <div className="mt-0.5 text-xs font-medium">All {optimizedRoute.optimized_order.length} stops were worked through.</div>
                </div>
              </div>
            )}

            {!routeRunnerActive && (
              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={handleStartRoute}
                  className="h-12 w-full rounded-full bg-ink px-6 font-semibold text-surface-0 shadow-raised hover:bg-brand-strong sm:w-auto"
                >
                  {routeCompleted ? (
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  {routeCompleted ? "Run Route Again" : "Start Route"}
                </Button>
              </div>
            )}
          </div>
          {routeRunnerActive ? (
            <RouteRunnerView
              stops={optimizedRoute.optimized_order}
              currentIndex={currentStopIndex}
              originAddress={optimizedRoute.origin_address}
              onNavigate={handleNavigateToStop}
              onMarkArrived={handleNextStop}
              onNext={handleNextStop}
              onPrevious={handlePreviousStop}
              onExit={handleExitRouteRunner}
            />
          ) : (
            <section aria-label="Optimized stop order">
              <div className="flex items-center justify-between px-1 pb-2">
                <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-muted">Stop order</h3>
                <span className="font-data text-xs font-semibold tabular-nums text-ink-muted">
                  {optimizedRoute.optimized_order.length} optimized {optimizedRoute.optimized_order.length === 1 ? "stop" : "stops"}
                </span>
              </div>

              <ol
                className="divide-y divide-line border-y border-line bg-surface-1"
                data-testid="optimized-stop-list"
              >
                {optimizedRoute.optimized_order.map((stop, index) => (
                  <li key={String(stop.customer?._id ?? stop.customer?.id ?? `${stop.position}-${stop.customer_name}`)}>
                    <article
                      className="bg-surface-1 px-3 py-2.5"
                      data-testid={`optimized-stop-${stop.position}`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="w-7 shrink-0 text-center font-data text-sm font-semibold tabular-nums text-brand-ink"
                          aria-label={`Stop ${stop.position}`}
                        >
                          {String(stop.position).padStart(2, "0")}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <h3 className="truncate text-sm font-semibold tracking-[-0.015em] text-ink">
                              {stop.customer_name}
                            </h3>
                            {index === 0 && (
                              <span className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-semibold text-brand-ink">
                                <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
                                Start
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs font-medium text-ink-muted">
                            {stop.customer_address}
                          </p>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleNavigateToStop(stop.customer_address, stop.customer_location)}
                          disabled={!hasNavigableAddress(stop.customer_address)}
                          className="h-11 shrink-0 rounded-control px-2.5 text-xs font-semibold text-brand-ink hover:bg-brand-softer disabled:text-ink-muted"
                        >
                          <Navigation className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                          {hasNavigableAddress(stop.customer_address) ? "Navigate" : "Address Needed"}
                        </Button>
                      </div>

                      <div
                        className="ml-10 mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] font-semibold leading-4 text-ink-muted"
                        aria-label={`Stop ${stop.position} details`}
                      >
                        {stop.estimated_travel_time_from_previous && (
                          <span className={`inline-flex items-center gap-1 ${index === 0 ? "text-brand-ink" : ""}`}>
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            {stop.estimated_travel_time_from_previous}
                            {index > 0 ? " from previous" : ""}
                          </span>
                        )}
                        {stop.notes && (
                          <span className="border-l border-line pl-2 text-watch">{stop.notes}</span>
                        )}
                        {stop.customer?.pool_type && (
                          <span className="border-l border-line pl-2 text-ink-secondary">{stop.customer.pool_type}</span>
                        )}
                        {stop.customer?.pool_gallons && (
                          <span className="border-l border-line pl-2 text-ink-secondary">
                            {stop.customer.pool_gallons.toLocaleString()} gal
                          </span>
                        )}
                      </div>
                    </article>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function RouteRunnerView({
  stops,
  currentIndex,
  originAddress,
  onNavigate,
  onMarkArrived,
  onNext,
  onPrevious,
  onExit,
}) {
  const currentStop = stops[currentIndex];
  const isFirstStop = currentIndex === 0;
  const isLastStop = currentIndex === stops.length - 1;
  const progressPercent = stops.length > 0 ? ((currentIndex + 1) / stops.length) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">Route in Progress</h3>
          <p className="text-sm text-ink-secondary">
            Stop {currentIndex + 1} of {stops.length}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onExit} className="h-11 text-ink-secondary">
          <X className="mr-1 h-4 w-4" aria-hidden="true" />
          Exit
        </Button>
      </div>

      <div
        className="h-2.5 w-full rounded-full bg-surface-2"
        role="progressbar"
        aria-label="Route progress"
        aria-valuemin={1}
        aria-valuemax={stops.length}
        aria-valuenow={currentIndex + 1}
        aria-valuetext={`Stop ${currentIndex + 1} of ${stops.length}`}
      >
        <div
          className="h-2.5 rounded-full bg-brand transition-[width] duration-300 ease-standard motion-reduce:transition-none"
          style={{ width: `${progressPercent}%` }}
        ></div>
      </div>

      <Card className="overflow-hidden rounded-sheet border border-line bg-surface-1 shadow-card ">
        <div className="bg-ink p-6 text-surface-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center text-2xl font-bold">
                {currentStop.position}
              </div>
              <div>
                <div className="text-xs opacity-80 uppercase tracking-wide">Current Stop</div>
                <h4 className="text-xl font-bold">{currentStop.customer_name}</h4>
              </div>
            </div>
            <Flag className="h-6 w-6 text-white/80" aria-hidden="true" />
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand-ink" aria-hidden="true" />
            <div>
              <div className="font-semibold text-ink">{currentStop.customer_address}</div>
              {originAddress && isFirstStop && (
                <div className="text-sm text-ink-muted mt-1">
                  From: {originAddress}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-[var(--status-info-line)] bg-brand-softer p-3">
            <Clock className="h-5 w-5 text-brand-ink" aria-hidden="true" />
            <div>
              <div className="text-sm font-medium text-brand-ink">
                {isFirstStop
                  ? `Est. ${currentStop.raw_travel_time_minutes || 0} min from start`
                  : `Est. ${currentStop.raw_travel_time_minutes || 0} min from previous stop`}
              </div>
            </div>
          </div>

          {currentStop.notes && (
            <div className="p-3 bg-[var(--status-watch-soft)] rounded-lg border border-[var(--status-watch-line)]">
              <p className="text-sm text-ink-secondary">{currentStop.notes}</p>
            </div>
          )}

          {currentStop.customer && (
            <div className="flex flex-wrap gap-2">
              {currentStop.customer.pool_type && (
                <span className="text-xs px-2 py-1 bg-brand-soft text-brand-ink rounded-lg">
                  {currentStop.customer.pool_type}
                </span>
              )}
              {currentStop.customer.pool_gallons && (
                <span className="text-xs px-2 py-1 bg-[var(--status-info-soft)] text-info rounded-lg">
                  {currentStop.customer.pool_gallons?.toLocaleString()} gal
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Button
              size="lg"
              onClick={() => onNavigate(currentStop.customer_address, currentStop.customer_location)}
              disabled={!hasNavigableAddress(currentStop.customer_address)}
              className="rounded-full bg-brand text-white shadow-cta hover:bg-brand-strong disabled:bg-surface-2 disabled:text-ink-muted disabled:shadow-none"
            >
              <PoolIcon name="route" className="mr-2 h-5 w-5" />
              {hasNavigableAddress(currentStop.customer_address) ? "Navigate" : "Address Needed"}
            </Button>
            <Button
              size="lg"
              onClick={onMarkArrived}
              className="rounded-full bg-[var(--status-ok)] text-white shadow-card hover:bg-[var(--status-ok-ink)]"
            >
              {isLastStop ? (
                <>
                  <CheckCircle className="mr-2 h-5 w-5" aria-hidden="true" />
                  Mark Complete
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-5 w-5" aria-hidden="true" />
                  Mark Arrived
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={onPrevious}
          disabled={isFirstStop}
          className="flex-1"
        >
          Previous Stop
        </Button>
        <Button
          variant="outline"
          onClick={onNext}
          disabled={isLastStop}
          className="flex-1"
        >
          Next Stop
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
