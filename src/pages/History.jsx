
import React, { useState, useEffect, useMemo } from "react";
import { useCustomersFilter, useServiceLogs, useCurrentUser, useServiceLogDelete } from "@/api/convexHooks";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl, parseLocalDate } from "@/utils";
import { BarChart3, Calendar, Filter, Camera, Clock, CheckCircle2, AlertCircle, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton, CustomerCardSkeleton } from "@/components/ui/skeleton";
// date-fns imports removed - no longer filtering by date
import CustomerHistoryCard from "../components/history/CustomerHistoryCard";
import {
  filterByProofOfService,
  getFilterCounts,
  PROOF_OF_SERVICE_FILTER_OPTIONS
} from "@/lib/proof-of-service";

// Icons for filter options
const filterIcons = {
  all: null,
  has_photos: Camera,
  has_time: Clock,
  complete: CheckCircle2,
  incomplete: AlertCircle,
};

export default function History() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useCurrentUser();

  // Get customerId from URL query params for filtered view
  const filteredCustomerId = searchParams.get("customerId");

  // Get business settings for working days
  const convexBusiness = useQuery(api.businesses.getCurrent);

  const allCustomers = useCustomersFilter({ created_by: user.email });
  const allLogs = useServiceLogs("-service_date");
  const deleteServiceLog = useServiceLogDelete();

  const [customers, setCustomers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState("Monday");
  const [proofFilter, setProofFilter] = useState("all");

  // Find the filtered customer if customerId is provided
  const filteredCustomer = useMemo(() => {
    if (!filteredCustomerId || !customers.length) return null;
    return customers.find(c => c._id === filteredCustomerId);
  }, [filteredCustomerId, customers]);

  // Clear customer filter function
  const clearCustomerFilter = () => {
    setSearchParams({});
  };

  // Get working days from business settings, with fallback to default weekdays
  const daysOfWeek = useMemo(() => {
    const defaultDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

    if (convexBusiness?.settings?.working_days && convexBusiness.settings.working_days.length > 0) {
      // Sort days in proper week order
      const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      return [...convexBusiness.settings.working_days].sort((a, b) =>
        dayOrder.indexOf(a) - dayOrder.indexOf(b)
      );
    }

    return defaultDays;
  }, [convexBusiness]);

  // Update activeDay if it's not in the working days list
  useEffect(() => {
    if (daysOfWeek.length > 0 && !daysOfWeek.includes(activeDay)) {
      setActiveDay(daysOfWeek[0]);
    }
  }, [daysOfWeek, activeDay]);

  // Auto-switch to filtered customer's service day
  useEffect(() => {
    if (filteredCustomer && filteredCustomer.service_day && daysOfWeek.includes(filteredCustomer.service_day)) {
      setActiveDay(filteredCustomer.service_day);
    }
  }, [filteredCustomer, daysOfWeek]);

  useEffect(() => {
    if (allCustomers && allLogs) {
      setCustomers(allCustomers);

      // Show all logs (no month filter) to sync with CustomerDetail page
      setLogs(allLogs);
      setLoading(false);
    }
  }, [allCustomers, allLogs]);

  // Calculate filter counts for the badge display
  const filterCounts = useMemo(() => {
    return getFilterCounts(logs);
  }, [logs]);

  // Apply proof-of-service filter to logs
  const filteredLogs = useMemo(() => {
    return filterByProofOfService(logs, proofFilter);
  }, [logs, proofFilter]);

  const getCustomersForDay = (day) => {
    const dayCustomers = customers.filter(c => c.service_day === day);

    // For each customer, get their filtered logs from the past month
    let result = dayCustomers.map(customer => {
      const customerLogs = filteredLogs.filter(log => log.customer_id === customer._id);
      return {
        customer,
        logs: customerLogs
      };
    }).filter(item => item.logs.length > 0); // Only show customers with logs

    // If filtering by customerId, ensure that customer is shown first and included even with no logs
    if (filteredCustomerId) {
      const filteredCustomerData = dayCustomers.find(c => c._id === filteredCustomerId);
      if (filteredCustomerData) {
        // Get all logs for this customer (not filtered by proof-of-service)
        const allLogsForCustomer = logs.filter(log => log.customer_id === filteredCustomerId);

        // Remove from result if already there, then prepend
        result = result.filter(item => item.customer._id !== filteredCustomerId);
        result.unshift({
          customer: filteredCustomerData,
          logs: allLogsForCustomer
        });
      }
    }

    return result;
  };

  const handleDeleteLog = async (logId) => {
    await deleteServiceLog({ id: logId });
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Service History</h2>
              <p className="text-sm text-slate-600">All service logs by day</p>
            </div>
          </div>
        </div>
        <div className="mb-6">
          <Skeleton className="h-10 w-full rounded-2xl" />
        </div>
        <div className="space-y-3">
          <CustomerCardSkeleton />
          <CustomerCardSkeleton />
          <CustomerCardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Service History</h2>
              <p className="text-sm text-slate-600">All service logs by day</p>
            </div>
          </div>

          {/* Proof-of-Service Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <Select value={proofFilter} onValueChange={setProofFilter}>
              <SelectTrigger className="w-[180px] h-9 text-sm bg-white text-slate-900 border border-slate-200 focus:border-cyan-500 rounded-lg">
                <SelectValue placeholder="Filter by proof" />
              </SelectTrigger>
              <SelectContent>
                {PROOF_OF_SERVICE_FILTER_OPTIONS.map((option) => {
                  const Icon = filterIcons[option.value];
                  const count = filterCounts[option.value];
                  return (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">
                        {Icon && <Icon className="w-3.5 h-3.5" />}
                        <span>{option.label}</span>
                        <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                          {count}
                        </Badge>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Customer Filter Indicator */}
        {filteredCustomer && (
          <div className="mt-3 p-3 bg-gradient-to-r from-cyan-50 to-blue-50 border-2 border-cyan-200 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                {filteredCustomer.full_name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div>
                <span className="text-sm font-semibold text-slate-900">
                  {filteredCustomer.full_name}
                </span>
                <p className="text-xs text-slate-600">
                  Viewing chemical history · {filteredCustomer.service_day}
                </p>
              </div>
            </div>
            <button
              onClick={clearCustomerFilter}
              className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-white/80 rounded-lg transition-colors"
              aria-label="Clear customer filter"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Active Filter Indicator */}
        {proofFilter !== 'all' && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-slate-500">Showing:</span>
            <Badge
              variant="outline"
              className="text-xs bg-cyan-50 border-cyan-200 text-cyan-700"
            >
              {PROOF_OF_SERVICE_FILTER_OPTIONS.find(o => o.value === proofFilter)?.label}
              <span className="ml-1 text-cyan-500">({filteredLogs.length} logs)</span>
            </Badge>
            <button
              onClick={() => setProofFilter('all')}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              Clear filter
            </button>
          </div>
        )}
      </div>

      <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
        <div className="overflow-x-auto mb-6">
          <TabsList className="inline-flex w-full sm:w-auto min-w-full sm:min-w-0 bg-slate-100 p-1 rounded-2xl">
            {daysOfWeek.map((day) => (
              <TabsTrigger
                key={day}
                value={day}
                className="flex-1 sm:flex-none rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-cyan-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all whitespace-nowrap px-3"
              >
                {day.substring(0, 3)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {daysOfWeek.map((day) => {
          const dayData = getCustomersForDay(day);
          return (
            <TabsContent key={day} value={day}>
              {dayData.length === 0 ? (
                <Card className="p-12 text-center bg-slate-50 border-2 border-dashed border-slate-200">
                  <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
                    <Calendar className="w-8 h-8 text-slate-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    No Service History for {day}
                  </h3>
                  <p className="text-slate-600">
                    No service logs in the past month for customers scheduled on {day}
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {dayData.map(({ customer, logs }) => (
                    <CustomerHistoryCard
                      key={customer.id}
                      customer={customer}
                      logs={logs}
                      onDeleteLog={handleDeleteLog}
                      onClick={() => navigate(createPageUrl("CustomerDetail") + `?id=${customer.id}`)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
