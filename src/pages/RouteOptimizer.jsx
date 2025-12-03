import React, { useState, useEffect } from "react";
import { useCustomersFilter, useCurrentUser } from "@/api/convexHooks";
// import { InvokeLLM } from "@/api/integrations"; // TODO: Implement LLM integration for Convex
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navigation, MapPin, Clock, Zap, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function RouteOptimizer() {
  const user = useCurrentUser();
  const allCustomers = useCustomersFilter({ created_by: user.email });

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

  const optimizeRoute = async () => {
    const dayCustomers = customers.filter(c => c.service_day === selectedDay);

    if (dayCustomers.length === 0) {
      return;
    }

    setOptimizing(true);

    const addresses = dayCustomers.map(c => ({
      name: c.full_name,
      address: c.address,
      id: c._id
    }));

    // TODO: Implement LLM integration for Convex
    // For now, just return a simple ordered list
    alert("Route optimization with AI is not yet implemented for Convex. Showing customers in current order.");

    const result = {
      optimized_order: addresses.map((addr, idx) => ({
        position: idx + 1,
        customer_name: addr.name,
        customer_address: addr.address,
        estimated_travel_time_from_previous: idx === 0 ? "Start" : "~5 min",
        notes: "Manual ordering - AI optimization coming soon"
      })),
      total_estimated_time: "TBD",
      total_estimated_distance: "TBD",
      optimization_summary: "Route optimization with AI will be available soon. Currently showing customers in their existing order."
    };

    const enrichedRoute = result.optimized_order.map(stop => {
      const customer = dayCustomers.find(c =>
        c.full_name === stop.customer_name || c.address === stop.customer_address
      );
      return {
        ...stop,
        customer: customer
      };
    });

    setOptimizedRoute({
      ...result,
      optimized_order: enrichedRoute
    });
    setOptimizing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const dayCustomers = customers.filter(c => c.service_day === selectedDay);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg">
            <Navigation className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Route Optimizer</h2>
            <p className="text-sm text-slate-600">AI-powered fuel-efficient routing</p>
          </div>
        </div>
      </div>

      <Card className="p-6 mb-6 border-2 shadow-lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">Select Service Day</label>
            <Select value={selectedDay} onValueChange={setSelectedDay}>
              <SelectTrigger className="border-2 focus:border-cyan-500 rounded-xl">
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
                Optimizing...
              </>
            ) : (
              <>
                <Zap className="w-5 h-5 mr-2" />
                Optimize Route
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
          <p className="text-slate-600">Add customers to {selectedDay} to optimize your route</p>
        </Card>
      ) : !optimizedRoute ? (
        <Card className="p-8 text-center border-2 bg-gradient-to-br from-cyan-50 to-blue-50">
          <Navigation className="w-12 h-12 mx-auto mb-4 text-cyan-600" />
          <h3 className="text-xl font-semibold text-slate-900 mb-2">Ready to Optimize</h3>
          <p className="text-slate-600 mb-4">
            You have {dayCustomers.length} customer{dayCustomers.length !== 1 ? 's' : ''} scheduled for {selectedDay}
          </p>
          <p className="text-sm text-slate-500">
            Click "Optimize Route" to generate the most fuel-efficient path
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