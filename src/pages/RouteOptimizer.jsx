import { useState, useEffect, useMemo, useCallback } from "react";
import { useCustomersFilter, useCurrentUser } from "@/api/convexHooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navigation, MapPin, Clock, Zap, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const AVG_SERVICE_MINUTES = 25;
const AVG_TRAVEL_SPEED_MPH = 24;

const extractZip = (address = "") => {
  const match = address.match(/\b\d{5}(?:-\d{4})?\b/);
  return match ? match[0] : null;
};

const normalizeStreetName = (address = "") =>
  address
    .toLowerCase()
    .replace(/\b\d+\b/g, "")
    .replace(
      /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|circle|cir)\b/g,
      ""
    )
    .replace(/[^a-z]/g, "")
    .trim();

const estimateTravelMinutes = (previous, current) => {
  if (!previous || !current) return 0;

  const previousZip = extractZip(previous.address);
  const currentZip = extractZip(current.address);
  if (previousZip && currentZip && previousZip === currentZip) return 6;

  const previousStreet = normalizeStreetName(previous.address);
  const currentStreet = normalizeStreetName(current.address);
  if (previousStreet && currentStreet && previousStreet === currentStreet) return 4;

  return 10;
};

const formatMinutes = (minutes) => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const toOrderNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

export default function RouteOptimizer() {
  const user = useCurrentUser();
  const allCustomers = useCustomersFilter({ created_by: user?.email });

  const [customers, setCustomers] = useState([]);
  const [selectedDay, setSelectedDay] = useState(format(new Date(), "EEEE"));
  const [optimizedRoute, setOptimizedRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);

  useEffect(() => {
    if (allCustomers) {
      setCustomers(allCustomers);
      setLoading(false);
    }
  }, [allCustomers]);

  const dayCustomers = useMemo(
    () => customers.filter((c) => c.service_day === selectedDay),
    [customers, selectedDay]
  );

  useEffect(() => {
    setOptimizedRoute(null);
  }, [selectedDay]);

  const optimizeRoute = useCallback(() => {
    if (dayCustomers.length === 0) return;
    setOptimizing(true);

    const orderedStops = [...dayCustomers].sort((a, b) => {
      const orderDelta = toOrderNumber(a.sort_order) - toOrderNumber(b.sort_order);
      if (orderDelta !== 0) return orderDelta;

      const aZip = extractZip(a.address) || "";
      const bZip = extractZip(b.address) || "";
      if (aZip !== bZip) return aZip.localeCompare(bZip);

      return (a.full_name || "").localeCompare(b.full_name || "");
    });

    let totalTravelMinutes = 0;
    const optimizedStops = orderedStops.map((customer, idx) => {
      const previousStop = idx > 0 ? orderedStops[idx - 1] : null;
      const travelMinutes = previousStop ? estimateTravelMinutes(previousStop, customer) : 0;
      totalTravelMinutes += travelMinutes;

      const gateCodeText = customer.gate_code ? `Gate code: ${customer.gate_code}` : null;
      return {
        position: idx + 1,
        customer_name: customer.full_name,
        customer_address: customer.address,
        estimated_travel_time_from_previous: idx === 0 ? "Start location" : `~${travelMinutes} min`,
        notes: gateCodeText,
        customer
      };
    });

    const totalMinutes = (optimizedStops.length * AVG_SERVICE_MINUTES) + totalTravelMinutes;
    const estimatedDistanceMiles = Number(((totalTravelMinutes / 60) * AVG_TRAVEL_SPEED_MPH).toFixed(1));

    setOptimizedRoute({
      optimized_order: optimizedStops,
      total_estimated_time: formatMinutes(totalMinutes),
      total_estimated_distance: `${estimatedDistanceMiles} mi`,
      optimization_summary: `Route plan built from your saved customer order and nearby addresses for ${selectedDay}. Update customer sort order to fine-tune stop sequence.`
    });
    setOptimizing(false);
  }, [dayCustomers, selectedDay]);

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
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg">
            <Navigation className="w-5 h-5 text-white" />
          </div>
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
                    {day} ({customers.filter(c => c.service_day === day).length} customers)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-600">{optimizedRoute.optimized_order.length}</div>
                <div className="text-sm text-slate-600 mt-1">Total Stops</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">{optimizedRoute.total_estimated_distance || 'N/A'}</div>
                <div className="text-sm text-slate-600 mt-1">Est. Distance</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-cyan-600">{optimizedRoute.total_estimated_time || 'N/A'}</div>
                <div className="text-sm text-slate-600 mt-1">Est. Time</div>
              </div>
            </div>
            {optimizedRoute.optimization_summary && (
              <div className="mt-4 p-4 bg-white rounded-lg border border-emerald-200">
                <p className="text-sm text-slate-700">{optimizedRoute.optimization_summary}</p>
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
