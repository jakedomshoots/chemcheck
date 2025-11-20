
import React, { useState, useEffect } from "react";
import { useCustomersFilter, useServiceLogs, useCurrentUser, useServiceLogDelete } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { BarChart3, Calendar } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { subMonths, isAfter } from "date-fns";
import CustomerHistoryCard from "../components/history/CustomerHistoryCard";

const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export default function History() {
  const navigate = useNavigate();
  const user = useCurrentUser();

  const allCustomers = useCustomersFilter({ created_by: user.email });
  const allLogs = useServiceLogs("-service_date");
  const deleteServiceLog = useServiceLogDelete();

  const [customers, setCustomers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState("Monday");

  useEffect(() => {
    if (allCustomers && allLogs) {
      setCustomers(allCustomers);

      // Get logs from the past month
      const oneMonthAgo = subMonths(new Date(), 1);
      const recentLogs = allLogs.filter(log => {
        const logDate = new Date(log.service_date);
        return isAfter(logDate, oneMonthAgo);
      });

      setLogs(recentLogs);
      setLoading(false);
    }
  }, [allCustomers, allLogs]);

  const getCustomersForDay = (day) => {
    const dayCustomers = customers.filter(c => c.service_day === day);

    // For each customer, get their logs from the past month
    return dayCustomers.map(customer => {
      const customerLogs = logs.filter(log => log.customer_id === customer._id);
      return {
        customer,
        logs: customerLogs
      };
    }).filter(item => item.logs.length > 0); // Only show customers with logs
  };

  const handleDeleteLog = async (logId) => {
    await deleteServiceLog({ id: logId });
  };

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
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Service History</h2>
            <p className="text-sm text-slate-600">Past month's service logs by day</p>
          </div>
        </div>
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
