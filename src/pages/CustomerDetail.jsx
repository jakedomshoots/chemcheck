import React, { useState, useEffect } from "react";
import { useCustomers, useServiceLogsByCustomer, useServiceLogDelete } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, MapPin, Phone, Mail, Droplets, Plus, Calendar, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import ServiceLogCard from "../components/servicelog/ServiceLogCard";
import { format, subWeeks, startOfWeek, endOfWeek } from "date-fns";

export default function CustomerDetail() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const customerId = urlParams.get("id");

  const customers = useCustomers();
  const logs = useServiceLogsByCustomer(customerId);
  const deleteServiceLog = useServiceLogDelete();

  const [customer, setCustomer] = useState(null);
  const [lastWeekLog, setLastWeekLog] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (customers && customerId) {
      const found = customers.find((c) => c._id === customerId);
      setCustomer(found);
      setLoading(false);
    }
  }, [customers, customerId]);

  useEffect(() => {
    if (logs && logs.length > 0) {
      const lastWeekStart = startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });
      const lastWeekEnd = endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });

      const lastWeek = logs.find(log => {
        const logDate = new Date(log.service_date);
        return logDate >= lastWeekStart && logDate <= lastWeekEnd;
      });

      setLastWeekLog(lastWeek);
    }
  }, [logs]);

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

  if (!customer) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-600">Customer not found</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-3 py-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(createPageUrl("Home"))}
        className="mb-3 -ml-2"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back
      </Button>

      {/* Customer Info Card */}
      <Card className="p-4 mb-3 border-2 shadow-lg">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              {customer.full_name}
            </h2>
            <div className="flex items-start gap-1.5 text-slate-600 mb-2">
              <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
              <p className="text-xs leading-relaxed">{customer.address}</p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`)}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg flex-shrink-0 ml-2 h-8"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Log
          </Button>
        </div>

        {(customer.phone || customer.email) && (
          <div className="space-y-1.5 mb-3">
            {customer.phone && (
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="truncate">{customer.email}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-1.5 flex-wrap">
          <span className="text-[10px] px-2 py-1 bg-cyan-100 text-cyan-700 rounded-md font-medium">
            <Calendar className="w-2.5 h-2.5 inline mr-0.5" />
            {customer.service_day}
          </span>
          {customer.pool_type && (
            <span className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded-md font-medium">
              <Droplets className="w-2.5 h-2.5 inline mr-0.5" />
              {customer.pool_type}
            </span>
          )}
          {customer.pool_gallons && (
            <span className="text-[10px] px-2 py-1 bg-slate-100 text-slate-700 rounded-md">
              {customer.pool_gallons?.toLocaleString()} gal
            </span>
          )}
          {customer.surface_type && (
            <span className="text-[10px] px-2 py-1 bg-slate-100 text-slate-700 rounded-md">
              {customer.surface_type}
            </span>
          )}
        </div>
      </Card>

      {/* Last Week's Notes */}
      {lastWeekLog && (lastWeekLog.notes || lastWeekLog.ph || lastWeekLog.chlorine) && (
        <Card className="p-4 mb-3 border-2 shadow-lg bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-200">
          <div className="flex items-center gap-1.5 mb-2">
            <FileText className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-slate-900">Last Week</h3>
            <span className="text-[10px] text-slate-600">
              ({format(new Date(lastWeekLog.service_date), "MMM dd")})
            </span>
          </div>

          {(lastWeekLog.ph || lastWeekLog.chlorine || lastWeekLog.alkalinity) && (
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {lastWeekLog.ph && (
                <span className="text-[10px] px-2 py-1 bg-white/60 text-slate-700 rounded-md font-medium">
                  pH: {lastWeekLog.ph}
                </span>
              )}
              {lastWeekLog.chlorine && (
                <span className="text-[10px] px-2 py-1 bg-white/60 text-slate-700 rounded-md font-medium">
                  Cl: {lastWeekLog.chlorine}
                </span>
              )}
              {lastWeekLog.alkalinity && (
                <span className="text-[10px] px-2 py-1 bg-white/60 text-slate-700 rounded-md font-medium">
                  Alk: {lastWeekLog.alkalinity}
                </span>
              )}
            </div>
          )}

          {lastWeekLog.notes && (
            <div className="bg-white/60 p-2.5 rounded-lg">
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                {lastWeekLog.notes}
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Service History */}
      <div className="mb-3">
        <h3 className="text-base font-bold text-slate-900">Service History</h3>
      </div>

      {logs.length === 0 ? (
        <Card className="p-8 text-center bg-slate-50 border-2 border-dashed border-slate-200">
          <div className="w-12 h-12 mx-auto mb-3 bg-slate-100 rounded-full flex items-center justify-center">
            <Calendar className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900 mb-1">
            No Service Logs Yet
          </h3>
          <p className="text-xs text-slate-600 mb-3">Start tracking services</p>
          <Button
            size="sm"
            onClick={() => navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`)}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Create First Log
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <ServiceLogCard
              key={log._id}
              log={log}
              onDelete={() => handleDeleteLog(log._id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}