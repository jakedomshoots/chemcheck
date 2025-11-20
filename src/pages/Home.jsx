import React, { useState, useEffect, useMemo } from "react";
import { useCustomersFilter, useServiceLogsFilter, useServiceLogs, useCurrentUser } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Calendar, Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { format, subWeeks, startOfWeek, endOfWeek, parseISO } from "date-fns";
import CustomerCard from "../components/home/CustomerCard";
import QuickStats from "../components/home/QuickStats";

const daysOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export default function Home() {
  const navigate = useNavigate();
  const user = useCurrentUser();

  const allCustomersData = useCustomersFilter({ created_by: user.email });
  const allLogsData = useServiceLogs("-service_date", 100);

  const [allCustomers, setAllCustomers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [lastWeekLogs, setLastWeekLogs] = useState([]);
  const [allThisWeekLogs, setAllThisWeekLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const dayOfWeek = useMemo(() => format(new Date(), "EEEE"), []);

  useEffect(() => {
    if (allCustomersData && allLogsData) {
      setLoading(true);

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
            const logDate = parseISO(log.service_date);
            return logDate >= weekStart && logDate <= weekEnd;
          } catch (e) {
            return false;
          }
        });
        setAllThisWeekLogs(thisWeekLogs);

        // Filter last week's logs
        const lastWeekStart = startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });
        const lastWeekEnd = endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });

        const lastWeek = allLogsData.filter(log => {
          try {
            const logDate = parseISO(log.service_date);
            return logDate >= lastWeekStart && logDate <= lastWeekEnd;
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

        if (!hasLogThisWeek) {
          missedCustomers.push({
            ...customer,
            scheduledDay: day
          });
        }
      });
    });

    return missedCustomers;
  }, [allCustomers, allThisWeekLogs, dayOfWeek]);

  // Memoized computed values
  const isCompleted = useMemo(() => {
    const completedIds = new Set(todayLogs.map(log => log.customer_id));
    return (customerId) => completedIds.has(customerId);
  }, [todayLogs]);

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

  const handleCustomerClick = (customer) => {
    if (isCompleted(customer._id)) {
      navigate(createPageUrl("CustomerDetail") + `?id=${customer._id}`);
    } else {
      navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`);
    }
  };

  const stats = useMemo(() => {
    const completed = customers.filter((c) => isCompleted(c._id)).length;
    return {
      total: customers.length,
      completed,
      pending: customers.length - completed
    };
  }, [customers, isCompleted]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3 py-4">
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg shadow-lg">
            <Calendar className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Today's Route</h2>
            <p className="text-xs text-slate-600">
              {dayOfWeek}, {format(new Date(), "MMM dd, yyyy")}
            </p>
          </div>
        </div>
      </div>

      {/* Missed Services Alert */}
      {missedServices.length > 0 && (
        <Card className="p-4 mb-4 border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-500 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-amber-900 mb-1">
                ⚠️ Missed Services This Week
              </h3>
              <p className="text-sm text-amber-800 mb-3">
                {missedServices.length} customer{missedServices.length !== 1 ? 's' : ''} haven't been serviced on their scheduled day:
              </p>
              <div className="space-y-2">
                {missedServices.map(customer => (
                  <div
                    key={customer.id}
                    onClick={() => navigate(createPageUrl("NewServiceLog") + `?customerId=${customer.id}`)}
                    className="flex items-center justify-between p-3 bg-white rounded-lg border-2 border-amber-200 cursor-pointer hover:border-amber-400 active:bg-amber-50"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                        {customer.full_name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">{customer.full_name}</p>
                        <p className="text-xs text-slate-600">
                          Scheduled: {customer.scheduledDay} • {customer.address}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white h-8 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(createPageUrl("NewServiceLog") + `?customerId=${customer.id}`);
                      }}
                    >
                      Service Now
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <QuickStats total={stats.total} completed={stats.completed} pending={stats.pending} />

      {customers.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-3 bg-slate-100 rounded-full flex items-center justify-center">
            <Calendar className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            No Customers Scheduled
          </h3>
          <p className="text-sm text-slate-600 mb-4">
            You have no customers scheduled for {dayOfWeek}
          </p>
          <Button
            onClick={() => navigate(createPageUrl("Clients"))}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Clients
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {customers.map((customer) => (
            <CustomerCard
              key={customer._id}
              customer={customer}
              isCompleted={isCompleted(customer._id)}
              lastWeekLog={getLastWeekLog(customer._id)}
              onClick={() => handleCustomerClick(customer)}
            />
          ))}
        </div>
      )}
    </div>
  );
}