import { useState, useEffect, useMemo, useCallback } from "react";
import { useCustomersFilter, useCurrentUser, useServiceLogs } from "@/api/convexHooks";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navigation, MapPin, Clock, Zap, ChevronRight, AlertTriangle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { toast } from "sonner";
import { routeOptimizer } from "@/lib/routeOptimizer";
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

  // Read route optimization and working hours from business settings
  const routeOptimizationEnabled = convexBusiness?.settings?.route_optimization ?? true;
  const workingHoursStart = convexBusiness?.settings?.working_hours_start || "08:00";
  const workingHoursEnd = convexBusiness?.settings?.working_hours_end || "17:00";
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

      const route = await routeOptimizer.optimizeRoute(customersForOptimization, targetDate, {
        startTime: workingHoursStart,
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
        return {
          position: idx + 1,
          customer_name: stop.customer.name || "Unnamed customer",
          customer_address: stop.customer.address || "No address on file",
          estimated_travel_time_from_previous: idx === 0 ? "Start location" : `~${Math.round(stop.travelTime)} min`,
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
        optimization_summary: `Route optimized with ${route.optimizationMethod} for ${selectedDay}.`
      });
    } catch (error) {
      console.error("[RouteOptimizer] Failed to generate route:", error);
      toast.error("Could not generate route plan. Please try again.");
    } finally {
      setOptimizing(false);
    }
  }, [customers, dayCustomers, selectedDay, workingHoursStart, durationProfile]);

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
              <SelectTrigger className="bg-white text-slate-900 border border-slate-200 focus:border-cyan-500 rounded-lg h-11">
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
            </div>

            {exceedsWorkingHours && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Estimated route time exceeds configured working hours. Consider splitting stops or extending working hours.
              </div>
            )}
          </Card>

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

                    {stop.notes && (
                      <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                        <p className="text-sm text-slate-700">{stop.notes}</p>
                      </div>
                    )}

                    {stop.customer && (
                      <div className="flex gap-2 mt-3">
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
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
