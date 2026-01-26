import { useState, useEffect, useMemo } from "react";
import { useCustomersFilter, useServiceLogs, useCurrentUser } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { createPageUrl, parseLocalDate } from "@/utils";
import { Calendar, Plus, AlertTriangle, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { format, subWeeks, startOfWeek, endOfWeek } from "date-fns";
import CustomerCard from "../components/home/CustomerCard";
import QuickStats from "../components/home/QuickStats";
import { CustomerCardSkeleton, QuickStatsSkeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const daysOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

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
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save skipped customers for this week to localStorage
function saveSkippedCustomers(customerIds) {
  try {
    const key = getWeekKey();
    localStorage.setItem(key, JSON.stringify(customerIds));

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

// Animation variants factory that respects reduced motion preference
function getAnimationVariants(shouldReduceMotion) {
  return {
    container: {
      hidden: { opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 10 },
      visible: {
        opacity: 1,
        y: 0,
        transition: {
          duration: shouldReduceMotion ? 0 : 0.4,
          staggerChildren: shouldReduceMotion ? 0 : 0.05
        }
      }
    },
    item: {
      hidden: { opacity: shouldReduceMotion ? 1 : 0, x: shouldReduceMotion ? 0 : -10 },
      visible: { opacity: 1, x: 0 }
    }
  };
}

export default function Home() {
  const navigate = useNavigate();
  const user = useCurrentUser();

  // Accessibility: respect user's reduced motion preference
  const shouldReduceMotion = useReducedMotion();
  const animationVariants = useMemo(
    () => getAnimationVariants(shouldReduceMotion),
    [shouldReduceMotion]
  );

  const allCustomersData = useCustomersFilter({ created_by: user.email });
  const allLogsData = useServiceLogs("-service_date", 100);

  const [allCustomers, setAllCustomers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [lastWeekLogs, setLastWeekLogs] = useState([]);
  const [allThisWeekLogs, setAllThisWeekLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skippedCustomers, setSkippedCustomers] = useState(() => getSkippedCustomers());
  const [hasCheckedDefaultView, setHasCheckedDefaultView] = useState(false);

  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const dayOfWeek = useMemo(() => format(new Date(), "EEEE"), []);

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

  // Handle skipping a customer for this week
  const handleSkipCustomer = (customer) => {
    const customerId = customer._id;
    const newSkipped = [...skippedCustomers, customerId];
    setSkippedCustomers(newSkipped);
    saveSkippedCustomers(newSkipped);
    toast.success(`Skipped ${customer.full_name || 'Customer'} for this week`);
  };

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

  const handleHistoryClick = (customer) => {
    // Navigate to History page with customer ID for filtered view
    navigate(createPageUrl("History") + `?customerId=${customer._id}`);
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
    // Show skeleton immediately instead of blocking spinner
    return (
      <div className="max-w-7xl mx-auto px-3 py-4 font-sans">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg shadow-lg">
              <Calendar className="w-4 h-4 text-white stroke-[1.75]" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">Today's Route</h2>
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
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3 py-4 font-sans">
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg shadow-lg">
            <Calendar className="w-4 h-4 text-white stroke-[1.75]" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Today's Route</h2>
            <p className="text-xs font-medium text-slate-600">
              {dayOfWeek}, {format(new Date(), "MMM dd, yyyy")}
            </p>
          </div>
        </div>
      </div>

      {/* Missed Services Alert */}
      {missedServices.length > 0 && (
        <Card className="p-4 mb-4 border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-500 rounded-lg shrink-0">
              <AlertTriangle className="w-5 h-5 text-white stroke-[1.75]" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold tracking-tight text-amber-900 mb-1 text-base">
                Missed Services
              </h3>
              <p className="text-sm font-medium text-amber-800 mb-3">
                {missedServices.length} {missedServices.length === 1 ? 'customer needs' : 'customers need'} service
              </p>
              <div className="space-y-3">
                {missedServices.map(customer => (
                  <div
                    key={customer._id}
                    className="p-3 bg-white rounded-lg border-2 border-amber-200"
                  >
                    <div
                      className="cursor-pointer hover:opacity-80 mb-3"
                      onClick={() => navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`)}
                    >
                      <p className="font-semibold text-slate-900 text-base">{customer.full_name || 'Customer'}</p>
                      <p className="text-sm text-slate-600 mt-0.5">
                        {customer.scheduledDay} · {customer.address}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-9 text-sm font-semibold border-slate-300 text-slate-600 hover:bg-slate-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSkipCustomer(customer);
                        }}
                      >
                        <SkipForward className="w-4 h-4 mr-1.5" />
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white h-9 text-sm font-semibold"
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
          </div>
        </Card>
      )}

      <QuickStats total={stats.total} completed={stats.completed} pending={stats.pending} />

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
        <motion.div
          variants={animationVariants.container}
          initial="hidden"
          animate="visible"
          className="space-y-3"
        >
          {customers.map((customer) => (
            <motion.div
              layout={!shouldReduceMotion}
              key={customer._id}
              variants={animationVariants.item}
            >
              <CustomerCard
                customer={customer}
                isCompleted={isCompleted(customer._id)}
                lastWeekLog={getLastWeekLog(customer._id)}
                onClick={() => handleCustomerClick(customer)}
                onHistoryClick={handleHistoryClick}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
