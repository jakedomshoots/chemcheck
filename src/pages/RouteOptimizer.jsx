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

// Deterministic, address-aware geocoding fallback that mirrors the route
// optimizer's internal heuristic. Used to turn a business address into a
// start location without requiring a network geocoding service.
function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function geocodeAddressHeuristic(address) {
  const normalizedAddress = (address || "").trim().toLowerCase();
  if (!normalizedAddress) {
    return { latitude: 34.0522, longitude: -118.2437, address };
  }

  const parts = normalizedAddress.split(",").map((part) => part.trim()).filter(Boolean);
  const streetPart = parts[0] || normalizedAddress;
  const localityKey = parts.slice(1).join(",") || "";
  const zipMatch = normalizedAddress.match(/\b\d{5}(?:-\d{4})?\b/);
  const zipCode = zipMatch ? zipMatch[0].slice(0, 5) : null;

  const houseMatch = streetPart.match(/\b\d{1,6}\b/);
  const parsedHouse = houseMatch ? Number(houseMatch[0]) : NaN;
  const houseNumber = Number.isFinite(parsedHouse) ? parsedHouse : null;

  const streetName = streetPart
    .replace(/\b\d{1,6}\b/g, " ")
    .replace(/\b(apt|apartment|unit|ste|suite|#)\s*[a-z0-9-]+\b/gi, " ")
    .replace(/\b(off|near|at|by)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "unknown-street";

  const localitySeed = zipCode || localityKey || "default-locality";
  const localityHash = hashString(localitySeed);
  const baseLatOffset = (((localityHash % 10000) / 10000) - 0.5) * 0.16;
  const baseLngOffset = ((((Math.floor(localityHash / 10000)) % 10000) / 10000) - 0.5) * 0.16;

  const streetSeed = `${localitySeed}|${streetName}`;
  const streetHash = hashString(streetSeed);
  const streetAngleRadians = ((streetHash % 360) * Math.PI) / 180;
  const streetRadius = ((((Math.floor(streetHash / 360)) % 1000) / 1000) - 0.5) * 0.02;

  const baseLatitude = 34.0522 + baseLatOffset;
  const baseLongitude = -118.2437 + baseLngOffset;
  const streetLatitude = baseLatitude + Math.cos(streetAngleRadians) * streetRadius;
  const streetLongitude = baseLongitude + Math.sin(streetAngleRadians) * streetRadius;

  const normalizedHouse = houseNumber !== null ? ((houseNumber % 2000) - 1000) / 1000 : 0;
  const alongStreetStep = 0.0035;

  return {
    latitude: streetLatitude + Math.cos(streetAngleRadians) * normalizedHouse * alongStreetStep,
    longitude: streetLongitude + Math.sin(streetAngleRadians) * normalizedHouse * alongStreetStep,
    address,
  };
}

function buildBusinessStartLocation(businessAddress) {
  if (!businessAddress || typeof businessAddress !== "string") return undefined;
  return geocodeAddressHeuristic(businessAddress);
}

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

      const startLocation = buildBusinessStartLocation(businessAddress);

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
          customer: originalCustomer || stop.customer,
        };
      });

      const serviceSummary = calculateServiceTimingSummary(dayCustomers, {
        customerMedianById: durationProfile.customerMedianById,
        fallback: 15,
      });
      const totalMinutes = serviceSummary.totalServiceMinutes;

      setOptimizedRoute({
        optimized_order: optimizedStops,
        total_estimated_minutes: totalMinutes,
        total_estimated_time: formatMinutes(totalMinutes),
        total_service_minutes: totalMinutes,
        origin_address: startLocation ? businessAddress : null,
        optimization_summary: `Route optimized with ${route.optimizationMethod} for ${selectedDay}.`
      });
      setRouteRunnerActive(false);
      setCurrentStopIndex(0);
    } catch (error) {
      console.error("[RouteOptimizer] Failed to generate route:", error);
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

  const handleNavigateToStop = useCallback((address) => {
    if (!address || address === "No address on file") {
      toast.error("No address available for navigation.");
      return;
    }
    openNavigation(address);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <div className="mb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Route Planner</h2>
            <p className="text-sm text-slate-600">Build a practical daily stop order from your saved customer list</p>
          </div>
        </div>
      </div>

      <Card className="p-6 mb-6 border-2 shadow-lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">Select Service Day</label>
            <Select value={selectedDay} onValueChange={setSelectedDay}>
              <SelectTrigger
                aria-label="Select Service Day"
                className="bg-white text-slate-900 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
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
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg"
            >
              {optimizing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  Building...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5 mr-2" />
                  Generate Route Plan
                </>
              )}
            </Button>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span className="text-sm text-amber-700">Route optimization is disabled in Settings</span>
            </div>
          )}
        </div>
      </Card>

      {dayCustomers.length === 0 ? (
        <Card className="p-12 text-center bg-slate-50 border-2 border-dashed border-slate-200">
          <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
            <Navigation className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No Customers Scheduled</h3>
          <p className="text-slate-600">Add customers to {selectedDay} to build a route plan</p>
        </Card>
      ) : !optimizedRoute ? (
        <Card className="p-8 text-center border-2 bg-gradient-to-br from-cyan-50 to-blue-50">
          <Navigation className="w-12 h-12 mx-auto mb-4 text-cyan-600" />
          <h3 className="text-xl font-semibold text-slate-900 mb-2">Ready to Build Route</h3>
          <p className="text-slate-600 mb-4">
            You have {dayCustomers.length} customer{dayCustomers.length !== 1 ? 's' : ''} scheduled for {selectedDay}
          </p>
          <p className="text-sm text-slate-500">
            Generate a stop sequence based on your saved customer order and addresses
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="p-6 border-2 shadow-lg bg-gradient-to-br from-emerald-50 to-teal-50">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Route Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-600">{optimizedRoute.optimized_order.length}</div>
                <div className="text-sm text-slate-600 mt-1">Total Stops</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-cyan-600">{optimizedRoute.total_estimated_time || 'N/A'}</div>
                <div className="text-sm text-slate-600 mt-1">Est. Time</div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-emerald-200/50 flex items-center justify-between text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" />
                <span>Working Hours: <span className="font-semibold text-slate-900">{workingHoursStart} - {workingHoursEnd}</span></span>
              </div>
              <div>{optimizedRoute.optimization_summary}</div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
              <div className="rounded-lg bg-white/70 border border-emerald-200/40 px-3 py-2 text-slate-700">
                Service: <span className="font-semibold text-slate-900">{formatMinutes(optimizedRoute.total_service_minutes || 0)}</span>
              </div>
              {optimizedRoute.origin_address && (
                <div className="rounded-lg bg-white/70 border border-emerald-200/40 px-3 py-2 text-slate-700">
                  Starting from: <span className="font-semibold text-slate-900">{optimizedRoute.origin_address}</span>
                </div>
              )}
            </div>

            {exceedsWorkingHours && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Estimated route time exceeds configured working hours. Consider splitting stops or extending working hours.
              </div>
            )}

            {!routeRunnerActive && (
              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={handleStartRoute}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg"
                >
                  <Play className="w-5 h-5 mr-2" />
                  Start Route
                </Button>
              </div>
            )}
          </Card>

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
                <Card key={index} className="overflow-hidden border-2 hover:shadow-lg transition-all duration-300">
                  <div className="flex items-start">
                    <div className="bg-gradient-to-br from-cyan-500 to-blue-600 text-white p-6 flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-3xl font-bold">{stop.position}</div>
                        <div className="text-xs opacity-75 mt-1">Stop</div>
                      </div>
                    </div>

                    <div className="flex-1 p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="text-lg font-bold text-slate-900">{stop.customer_name}</h3>
                          <div className="flex items-start gap-2 text-slate-600 mt-1">
                            <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-cyan-600" />
                            <span className="text-sm">{stop.customer_address}</span>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-400" />
                      </div>

                      {stop.estimated_travel_time_from_previous && index > 0 && (
                        <div className="flex items-center gap-2 mt-3 p-2 bg-blue-50 rounded-lg border border-blue-200">
                          <Clock className="w-4 h-4 text-blue-600" />
                          <span className="text-sm text-blue-700 font-medium">
                            {stop.estimated_travel_time_from_previous} from previous stop
                          </span>
                        </div>
                      )}

                      {index === 0 && stop.estimated_travel_time_from_previous && (
                        <div className="flex items-center gap-2 mt-3 p-2 bg-blue-50 rounded-lg border border-blue-200">
                          <Clock className="w-4 h-4 text-blue-600" />
                          <span className="text-sm text-blue-700 font-medium">
                            {stop.estimated_travel_time_from_previous}
                          </span>
                        </div>
                      )}

                      {stop.notes && (
                        <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                          <p className="text-sm text-slate-700">{stop.notes}</p>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 mt-3">
                        <Button
                          size="sm"
                          onClick={() => handleNavigateToStop(stop.customer_address)}
                          className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white"
                        >
                          <Navigation className="w-4 h-4 mr-2" />
                          Navigate
                        </Button>
                        {stop.customer && (
                          <>
                            {stop.customer.pool_type && (
                              <span className="text-xs px-2 py-1 bg-cyan-100 text-cyan-700 rounded-lg">
                                {stop.customer.pool_type}
                              </span>
                            )}
                            {stop.customer.pool_gallons && (
                              <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-lg">
                                {stop.customer.pool_gallons?.toLocaleString()} gal
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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
          <h3 className="text-lg font-semibold text-slate-900">Route in Progress</h3>
          <p className="text-sm text-slate-600">
            Stop {currentIndex + 1} of {stops.length}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onExit} className="text-slate-600">
          <X className="w-4 h-4 mr-1" />
          Exit
        </Button>
      </div>

      <div className="w-full bg-slate-200 rounded-full h-2.5">
        <div
          className="bg-gradient-to-r from-cyan-500 to-blue-600 h-2.5 rounded-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        ></div>
      </div>

      <Card className="border-2 shadow-lg overflow-hidden">
        <div className="bg-gradient-to-br from-cyan-500 to-blue-600 text-white p-6">
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
            <MapPin className="w-5 h-5 mt-0.5 flex-shrink-0 text-cyan-600" />
            <div>
              <div className="font-semibold text-slate-900">{currentStop.customer_address}</div>
              {originAddress && isFirstStop && (
                <div className="text-sm text-slate-500 mt-1">
                  From: {originAddress}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <Clock className="w-5 h-5 text-blue-600" />
            <div>
              <div className="text-sm text-blue-700 font-medium">
                {isFirstStop
                  ? `Est. ${currentStop.raw_travel_time_minutes || 0} min from start`
                  : `Est. ${currentStop.raw_travel_time_minutes || 0} min from previous stop`}
              </div>
            </div>
          </div>

          {currentStop.notes && (
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-sm text-slate-700">{currentStop.notes}</p>
            </div>
          )}

          {currentStop.customer && (
            <div className="flex flex-wrap gap-2">
              {currentStop.customer.pool_type && (
                <span className="text-xs px-2 py-1 bg-cyan-100 text-cyan-700 rounded-lg">
                  {currentStop.customer.pool_type}
                </span>
              )}
              {currentStop.customer.pool_gallons && (
                <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-lg">
                  {currentStop.customer.pool_gallons?.toLocaleString()} gal
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Button
              size="lg"
              onClick={() => onNavigate(currentStop.customer_address)}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white"
            >
              <Navigation className="w-5 h-5 mr-2" />
              Navigate
            </Button>
            <Button
              size="lg"
              onClick={onMarkArrived}
              className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
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
