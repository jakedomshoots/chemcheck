
import React, { useState, useEffect, useMemo } from "react";
import { useCustomersFilter, useServiceLogs, useCurrentUser, useServiceLogDelete } from "@/api/convexHooks";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Calendar, Filter, Camera, Clock, CheckCircle2, AlertCircle, X, History as HistoryIcon } from "lucide-react";
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
import { getEffectiveWorkingDays } from "@/lib/workingDays";

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
  const normalizedFilteredCustomerId = useMemo(() => {
    if (!filteredCustomerId) return null;
    const asNumber = Number(filteredCustomerId);
    return Number.isNaN(asNumber) ? filteredCustomerId : asNumber;
  }, [filteredCustomerId]);

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
    return customers.find(c =>
      c._id === normalizedFilteredCustomerId ||
      c.id === normalizedFilteredCustomerId ||
      String(c._id) === filteredCustomerId ||
      String(c.id) === filteredCustomerId
    );
  }, [filteredCustomerId, normalizedFilteredCustomerId, customers]);

  // Clear customer filter function
  const clearCustomerFilter = () => {
    setSearchParams({});
  };

  // Get working days from cloud settings with local fallback for offline/dev mode.
  const daysOfWeek = useMemo(() => {
    return getEffectiveWorkingDays(convexBusiness);
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

  // Keep filter counts aligned with what can actually render in day tabs.
  const scopedLogs = useMemo(() => {
    if (!customers.length || !logs.length || !daysOfWeek.length) {
      return [];
    }

    const visibleCustomerIds = new Set(
      customers
        .filter((customer) => daysOfWeek.includes(customer.service_day))
        .flatMap((customer) => [customer._id, customer.id])
        .filter((id) => id !== undefined && id !== null)
        .map((id) => String(id))
    );

    return logs.filter((log) => {
      if (log?.customer_id === undefined || log?.customer_id === null) {
        return false;
      }
      return visibleCustomerIds.has(String(log.customer_id));
    });
  }, [customers, logs, daysOfWeek]);

  // Calculate filter counts for the badge display
  const filterCounts = useMemo(() => {
    return getFilterCounts(scopedLogs);
  }, [scopedLogs]);

  // Apply proof-of-service filter to logs
  const filteredLogs = useMemo(() => {
    return filterByProofOfService(scopedLogs, proofFilter);
  }, [scopedLogs, proofFilter]);

  const logMatchesCustomer = (log, customer) => (
    log.customer_id === customer._id ||
    log.customer_id === customer.id ||
    String(log.customer_id) === String(customer._id) ||
    String(log.customer_id) === String(customer.id)
  );

  const getCustomersForDay = (day) => {
    const dayCustomers = customers.filter(c => c.service_day === day);

    // For each customer, get their logs
    let result = dayCustomers.map(customer => {
      // Get ALL logs for this customer (for accurate total count)
      const allCustomerLogs = scopedLogs.filter(log => logMatchesCustomer(log, customer));
      // Get filtered logs (for display based on proof-of-service filter)
      const customerLogs = filteredLogs.filter(log => logMatchesCustomer(log, customer));
      return {
        customer,
        logs: customerLogs,
        totalLogCount: allCustomerLogs.length,
        lastServiceDate: allCustomerLogs[0]?.service_date || null,
      };
    }).filter(item => {
      // In filtered mode, show only customers with matching logs.
      // In "all" mode, show customers that have any history.
      if (proofFilter !== "all") return item.logs.length > 0;
      return item.totalLogCount > 0;
    });

    // If filtering by customerId, ensure that customer is shown first and included even with no logs
    if (filteredCustomerId) {
      const filteredCustomerData = dayCustomers.find(c =>
        c._id === normalizedFilteredCustomerId ||
        c.id === normalizedFilteredCustomerId ||
        String(c._id) === filteredCustomerId ||
        String(c.id) === filteredCustomerId
      );
      if (filteredCustomerData) {
        // Get all logs for this customer (not filtered by proof-of-service)
        const allLogsForCustomer = scopedLogs.filter(log => logMatchesCustomer(log, filteredCustomerData));
        const filteredLogsForCustomer = filteredLogs.filter(log => logMatchesCustomer(log, filteredCustomerData));

        // Remove from result if already there, then prepend
        result = result.filter(item =>
          item.customer._id !== filteredCustomerData._id &&
          item.customer.id !== filteredCustomerData.id
        );
        result.unshift({
          customer: filteredCustomerData,
          logs: filteredLogsForCustomer,
          totalLogCount: allLogsForCustomer.length,
          lastServiceDate: allLogsForCustomer[0]?.service_date || null,
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
      <main className="relative mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Service History">
        <div className="mb-4 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950">Service History</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Loading...</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-24 rounded-[1.25rem] border border-white/80 bg-white/80 shadow-[0_18px_60px_-48px_rgba(8,47,73,0.65)] backdrop-blur" />
          <div className="h-24 rounded-[1.25rem] border border-white/80 bg-white/80 shadow-[0_18px_60px_-48px_rgba(8,47,73,0.65)] backdrop-blur" />
          <div className="h-24 rounded-[1.25rem] border border-white/80 bg-white/80 shadow-[0_18px_60px_-48px_rgba(8,47,73,0.65)] backdrop-blur" />
        </div>
      </main>
    );
  }

  return (
    <main className="relative mx-auto max-w-7xl px-3 pb-36 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Service History">
      <div className="mb-4 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Service history</p>
            <h2 className="flex items-center gap-2 text-3xl font-semibold leading-tight tracking-[-0.045em] text-slate-950 sm:text-4xl">
              <HistoryIcon className="h-7 w-7 text-cyan-700" aria-hidden="true" />
              Service History
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">All service logs by day</p>
          </div>

          {/* Proof-of-Service Filter */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden="true" />
            <Select value={proofFilter} onValueChange={setProofFilter}>
              <SelectTrigger
                aria-label="History Range"
                className="w-full sm:w-[200px] h-11 rounded-2xl border border-slate-200 bg-white text-slate-900 focus:border-cyan-500"
              >
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
          <div className="mt-4 flex items-center justify-between gap-3 rounded-[1.25rem] border border-cyan-100 bg-cyan-50/70 px-3 py-2.5 shadow-sm shadow-cyan-900/5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <span className="truncate block text-sm font-semibold text-slate-900">
                  {filteredCustomer.full_name}
                </span>
                <p className="text-xs font-medium text-slate-600">
                  Viewing chemical history · {filteredCustomer.service_day}
                </p>
              </div>
            </div>
            <button
              onClick={clearCustomerFilter}
              className="rounded-full p-1.5 text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
              aria-label="Clear customer filter"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Active Filter Indicator */}
        {proofFilter !== 'all' && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Showing:</span>
            <Badge
              variant="outline"
              className="rounded-full border-cyan-200 bg-cyan-50 text-xs text-cyan-700"
            >
              {PROOF_OF_SERVICE_FILTER_OPTIONS.find(o => o.value === proofFilter)?.label}
              <span className="ml-1 text-cyan-500">({filteredLogs.length} logs)</span>
            </Badge>
            <button
              onClick={() => setProofFilter('all')}
              className="text-xs font-semibold text-slate-500 underline-offset-2 transition-colors hover:text-slate-700 hover:underline"
            >
              Clear filter
            </button>
          </div>
        )}
      </div>

      <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">

        <div className="mb-5 overflow-x-auto">
          <TabsList className="inline-flex w-full min-w-full rounded-2xl border border-white/80 bg-white/80 p-1 shadow-[0_18px_60px_-48px_rgba(8,47,73,0.65)] backdrop-blur sm:w-auto sm:min-w-0">
            {daysOfWeek.map((day) => (
              <TabsTrigger
                key={day}
                value={day}
                className="flex-1 whitespace-nowrap rounded-xl px-3 text-slate-600 transition-colors data-[state=active]:bg-cyan-600 data-[state=active]:text-white sm:flex-none"
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
                <Card className="rounded-[1.75rem] border border-white/80 bg-white/80 px-5 py-10 text-center shadow-[0_24px_80px_-58px_rgba(8,47,73,0.85)] backdrop-blur">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 shadow-inner">
                    <Calendar className="h-7 w-7" aria-hidden="true" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold tracking-[-0.035em] text-slate-950">
                    No Service History for {day}
                  </h3>
                  <p className="mx-auto max-w-sm text-sm font-medium leading-6 text-slate-600">
                    No service logs in the past month for customers scheduled on {day}
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {dayData.map(({ customer, logs, totalLogCount, lastServiceDate }) => (
                    <CustomerHistoryCard
                      key={customer._id || customer.id}
                      customer={customer}
                      logs={logs}
                      totalLogCount={totalLogCount}
                      lastServiceDate={lastServiceDate}
                      onDeleteLog={handleDeleteLog}
                      onClick={() => navigate(createPageUrl("CustomerDetail") + `?id=${customer._id || customer.id}`)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </main>
  );
}
