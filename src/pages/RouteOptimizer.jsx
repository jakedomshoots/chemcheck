import { useState, useEffect, useMemo, useCallback } from "react";
import { useCustomersFilter, useCurrentUser, useServiceLogs } from "@/api/convexHooks";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Navigation,
  MapPin,
  Clock,
  Zap,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  X,
  Flag,
  Play,
} from "lucide-react";
import { PoolIcon, IconBadge } from "@/components/ui/iconography";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { toast } from "sonner";
import { routeOptimizer } from "@/lib/routeOptimizer";
import { buildNavigationUrl, openNavigation } from "@/lib/mapNavigation";
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
  const user = useCurrentUser();
  const allCustomers = useCustomersFilter({ created_by: user?.email });
  const recentServiceLogs = useServiceLogs("-service_date", 1500);
  const convexBusiness = useQuery(api.businesses.getCurrent);

  const routeOptimizationEnabled = convexBusiness?.settings?.route_optimization ?? true;
  const workingHoursStart = convexBusiness?.settings?.working_hours_start || "08:00";
  const workingHoursEnd = convexBusiness?.settings?.working_hours_end || "17:00";
  const businessAddress = convexBusiness?.address;
  const daysOfWeek = useMemo(() => {
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
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [routeRunnerActive, setRouteRunnerActive] = useState(false);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [routeWarnings, setRouteWarnings] = useState([]);

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

  const durationProfile = useMemo(
    () => buildDurationProfile(recentServiceLogs),
    [recentServiceLogs]
  );

  useEffect(() => {
    setOptimizedRoute(null);
    setRouteWarnings([]);
    setRouteRunnerActive(false);
    setCurrentStopIndex(0);
  }, [selectedDay]);

  const optimizeRoute = useCallback(async () => {
    if (dayCustomers.length === 0) return;
    setOptimizing(true);
    try {
      const customerById = new Map(
        customers.map((customer) => [Number(customer._id ?? customer.id), customer])
      );
      const targetDate = getReferenceDateForDay(selectedDay);
      const customersForOptimization = dayCustomers.map((customer) => {
        const customerId = Number(customer?._id ?? customer?.id);
        const historicalDuration = durationProfile.customerMedianById.get(customerId) ?? null;
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

      if (route.stops.length === 0) {
        toast.info(`No route stops found for ${selectedDay}.`);
        setOptimizedRoute(null);
        return;
      }

      const optimizedStops = route.stops.map((stop, idx) => {
        const originalCustomer = customerById.get(Number(stop.customer.id));
        const gateCodeText = originalCustomer?.gate_code ? `Gate code: ${originalCustomer.gate_code}` : null;
        const travelLabel = idx === 0
          ? (startLocation ? `~${Math.round(stop.travelTime)} min from business` : "Start location")
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
      const totalMinutes = Math.round(route.totalTime || serviceSummary.totalServiceMinutes);

      setOptimizedRoute({
        optimized_order: optimizedStops,
        total_estimated_minutes: totalMinutes,
        total_estimated_time: formatMinutes(totalMinutes),
        total_service_minutes: totalMinutes,
        origin_address: startLocation ? businessAddress : null,
        optimization_summary: `Route optimized with ${route.optimizationMethod} for ${selectedDay}.`
      });
      setRouteWarnings(route.warnings || []);
      setRouteRunnerActive(false);
      setCurrentStopIndex(0);
    } catch (error) {
      console.error("[RouteOptimizer] Failed to generate route:", error);
      setRouteWarnings(["Route provider unavailable. Estimated distances may be less accurate."]);
      toast.error("Could not generate route plan. Please try again.");
    } finally {
      setOptimizing(false);
    }
  }, [customers, dayCustomers, selectedDay, workingHoursStart, durationProfile, businessAddress]);

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
    setRouteRunnerActive(true);
    setCurrentStopIndex(0);
  }, []);

  const handleExitRouteRunner = useCallback(() => {
    setRouteRunnerActive(false);
  }, []);

  const handleNextStop = useCallback(() => {
    if (!optimizedRoute) return;
    setCurrentStopIndex((prev) => {
      const next = Math.min(prev + 1, optimizedRoute.optimized_order.length - 1);
      if (next === prev) {
        toast.success("Route complete!");
      }
      return next;
    });
  }, [optimizedRoute]);

  const handlePreviousStop = useCallback(() => {
    setCurrentStopIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleNavigateToStop = useCallback((address, location) => {
    if (!address || address === "No address on file") {
      toast.error("No address available for navigation.");
      return;
    }
    openNavigation(location ? { address, latitude: location.latitude, longitude: location.longitude } : address);
  }, []);

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
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">Route planner</p>
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
            <Select value={selectedDay} onValueChange={setSelectedDay}>
              <SelectTrigger
                aria-label="Select Service Day"
                className="h-11 rounded-2xl border border-line bg-white text-ink focus:border-ring"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {daysOfWeek.map(day => (
                  <SelectItem key={day} value={day}>
                    {day} ({customerDayCounts.get(day) || 0} customers)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {routeOptimizationEnabled ? (
            <Button
              onClick={optimizeRoute}
              disabled={optimizing || dayCustomers.length === 0}
              className="h-12 rounded-full bg-brand px-6 font-semibold text-white shadow-cta hover:bg-brand-strong disabled:bg-line disabled:text-white disabled:shadow-none"
            >
              {optimizing ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin mr-2"></div>
                  Building...
                </>
              ) : (
                <>
                  <PoolIcon name="route" className="mr-2 h-4 w-4" />
                  Generate Route Plan
                </>
              )}
            </Button>
          ) : (
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-4 py-3 text-sm text-watch">
              <AlertTriangle className="h-4 w-4 shrink-0 text-watch" aria-hidden="true" />
              <span className="font-medium">Route optimization is disabled in Settings</span>
            </div>
          )}
        </div>
      </div>

      {dayCustomers.length === 0 ? (
        <div className="rounded-sheet border border-line bg-surface-1 px-5 py-10 text-center shadow-card ">
          <IconBadge name="route" size="lg" tone="slate" className="mx-auto mb-4" iconClassName="h-7 w-7" />
          <h3 className="mb-2 text-xl font-semibold tracking-[-0.035em] text-ink">No Customers Scheduled</h3>
          <p className="mx-auto max-w-sm text-sm font-medium leading-6 text-ink-secondary">
            Add customers to {selectedDay} to build a route plan.
          </p>
        </div>
      ) : !optimizedRoute ? (
        <div className="rounded-sheet border border-line bg-surface-1 p-8 text-center shadow-card ">
          <IconBadge name="route" size="lg" className="mx-auto mb-4" iconClassName="h-7 w-7" />
          <h3 className="mb-2 text-xl font-semibold tracking-[-0.035em] text-ink">Ready to Build Route</h3>
          <p className="mx-auto mb-3 max-w-md text-sm font-medium leading-6 text-ink-secondary">
            You have {dayCustomers.length} customer{dayCustomers.length !== 1 ? 's' : ''} scheduled for {selectedDay}.
          </p>
          <p className="mx-auto max-w-md text-xs font-medium leading-5 text-ink-muted">
            Generate a stop sequence based on your saved customer order and addresses.
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
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-raised border border-[var(--status-info-line)] bg-brand-softer p-4 text-center">
                <div className="text-3xl font-semibold tabular-nums tracking-[-0.04em] text-brand-ink">{optimizedRoute.optimized_order.length}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-brand-ink">Total stops</div>
              </div>
              <div className="rounded-raised border border-line bg-surface-1 p-4 text-center">
                <div className="text-3xl font-semibold tabular-nums tracking-[-0.04em] text-ink">{optimizedRoute.total_estimated_time || 'N/A'}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Est. time</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 text-sm">
              <div className="rounded-2xl border border-line bg-surface-1 px-3 py-2 text-ink-secondary">
                Service: <span className="font-semibold text-ink">{formatMinutes(optimizedRoute.total_service_minutes || 0)}</span>
              </div>
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
              <div className="mt-3 rounded-lg border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-3 py-2 text-sm text-watch" role="status">
                <div className="font-medium">Estimated map data</div>
                <ul className="mt-1 list-disc pl-5">
                  {routeWarnings.slice(0, 2).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}

            {!routeRunnerActive && (
              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={handleStartRoute}
                  className="h-12 w-full rounded-full bg-ink px-6 font-semibold text-surface-0 shadow-raised hover:bg-brand-strong sm:w-auto"
                >
                  <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                  Start Route
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
            <div className="space-y-3">
              {optimizedRoute.optimized_order.map((stop, index) => (
                <div
                  key={index}
                  className="overflow-hidden rounded-raised border border-line bg-surface-1 shadow-card transition-all hover:shadow-card"
                >
                  <div className="flex items-stretch">
                    <div className="flex shrink-0 items-center justify-center bg-ink px-5 py-4 text-surface-0 sm:px-6 sm:py-5">
                      <div className="text-center">
                        <div className="text-2xl font-semibold tabular-nums tracking-[-0.04em] sm:text-3xl">{stop.position}</div>
                        <div className="mt-0.5 text-xs font-semibold uppercase tracking-[0.14em] opacity-75 sm:text-xs">Stop</div>
                      </div>
                    </div>

                    <div className="flex-1 p-4">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold tracking-[-0.025em] text-ink sm:text-lg">{stop.customer_name}</h3>
                          <div className="mt-1 flex items-start gap-2 text-ink-secondary">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" aria-hidden="true" />
                            <span className="text-sm font-medium leading-snug">{stop.customer_address}</span>
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                      </div>

                      {stop.estimated_travel_time_from_previous && index > 0 && (
                        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-[var(--status-info-line)] bg-brand-softer px-3 py-2">
                          <Clock className="h-4 w-4 text-brand-ink" aria-hidden="true" />
                          <span className="text-sm font-medium text-brand-ink">
                            {stop.estimated_travel_time_from_previous} from previous stop
                          </span>
                        </div>
                      )}

                      {index === 0 && stop.estimated_travel_time_from_previous && (
                        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-[var(--status-info-line)] bg-brand-softer px-3 py-2">
                          <Clock className="h-4 w-4 text-brand-ink" aria-hidden="true" />
                          <span className="text-sm font-medium text-brand-ink">
                            {stop.estimated_travel_time_from_previous}
                          </span>
                        </div>
                      )}

                      {stop.notes && (
                        <div className="mt-3 rounded-2xl border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] p-3">
                          <p className="text-sm font-medium text-ink-secondary">{stop.notes}</p>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleNavigateToStop(stop.customer_address, stop.customer_location)}
                          className="h-9 rounded-full bg-brand px-4 text-xs font-semibold text-white shadow-cta hover:bg-brand-strong"
                        >
                          <Navigation className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          Navigate
                        </Button>
                        {stop.customer && (
                          <>
                            {stop.customer.pool_type && (
                              <span className="rounded-full border border-[var(--status-info-line)] bg-brand-softer px-2.5 py-1 text-xs font-semibold text-brand-ink">
                                {stop.customer.pool_type}
                              </span>
                            )}
                            {stop.customer.pool_gallons && (
                              <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-secondary">
                                {stop.customer.pool_gallons?.toLocaleString()} gal
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
  const progressPercent = stops.length > 1 ? (currentIndex / (stops.length - 1)) * 100 : 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">Route in Progress</h3>
          <p className="text-sm text-ink-secondary">
            Stop {currentIndex + 1} of {stops.length}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onExit} className="text-ink-secondary">
          <X className="w-4 h-4 mr-1" />
          Exit
        </Button>
      </div>

      <div className="w-full bg-surface-2 rounded-full h-2.5">
        <div
          className="h-2.5 rounded-full bg-brand transition-all duration-300"
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
            <Flag className="w-6 h-6 text-white/80" />
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 mt-0.5 flex-shrink-0 text-brand-ink" />
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
            <Clock className="h-5 w-5 text-brand-ink" />
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
              className="rounded-full bg-brand text-white shadow-cta hover:bg-brand-strong"
            >
              <PoolIcon name="route" className="mr-2 h-5 w-5" />
              Navigate
            </Button>
            <Button
              size="lg"
              onClick={onMarkArrived}
              className="rounded-full bg-[var(--status-ok)] text-white shadow-card hover:bg-[var(--status-ok-ink)]"
            >
              {isLastStop ? (
                <>
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Mark Complete
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 mr-2" />
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
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
