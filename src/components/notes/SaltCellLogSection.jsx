import { useState, useMemo } from "react";
import { db, getTodayDate } from "@/db/chemcheck-db";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Zap,
  Plus,
  ChevronDown,
  Trash2,
  Droplets,
  User
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

const conditionConfig = {
  good: {
    label: "Light Buildup",
    color: "text-emerald-600",
    bg: "bg-emerald-100",
  },
  moderate: {
    label: "Moderate Buildup",
    color: "text-amber-600",
    bg: "bg-amber-100",
  },
  heavy: {
    label: "Heavy Buildup",
    color: "text-red-600",
    bg: "bg-red-100",
  },
};

export function SaltCellLogSection({ customers }) {
  const [showForm, setShowForm] = useState(false);
  const [deleteLog, setDeleteLog] = useState(null);
  const [expandedCustomers, setExpandedCustomers] = useState(new Set());

  const [formData, setFormData] = useState({
    customer_id: "",
    cleaning_date: getTodayDate(),
    condition: "good",
    notes: "",
  });

  // Get salt cell logs from Dexie
  const saltCellLogs = useLiveQuery(
    () => db.saltCellLogs.orderBy('cleaning_date').reverse().toArray(),
    []
  );

  // Filter to only salt pool customers
  const saltPoolCustomers = useMemo(() => {
    return customers?.filter(c => c.pool_type === 'Salt') || [];
  }, [customers]);

  // Group logs by customer
  const logsByCustomer = useMemo(() => {
    if (!saltCellLogs) return {};
    const grouped = {};
    saltCellLogs.forEach(log => {
      if (!grouped[log.customer_id]) {
        grouped[log.customer_id] = [];
      }
      grouped[log.customer_id].push(log);
    });
    return grouped;
  }, [saltCellLogs]);

  // Get total log count
  const totalLogs = saltCellLogs?.length || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Store customer_id as string for consistency
    const customerId = formData.customer_id;

    await db.saltCellLogs.add({
      customer_id: customerId,
      cleaning_date: formData.cleaning_date,
      condition: formData.condition,
      notes: formData.notes || undefined,
      sync_status: 'pending',
      local_updated_at: Date.now(),
      createdAt: new Date().toISOString(),
    });

    // Auto-expand the customer we just added to
    setExpandedCustomers(prev => new Set([...prev, customerId]));

    setShowForm(false);
    setFormData({
      customer_id: "",
      cleaning_date: getTodayDate(),
      condition: "good",
      notes: "",
    });
    toast.success("Salt cell cleaning logged");
  };

  const handleDelete = async () => {
    if (deleteLog) {
      await db.saltCellLogs.delete(deleteLog.id);
      setDeleteLog(null);
      toast.success("Log deleted");
    }
  };

  const toggleCustomer = (customerId) => {
    const newExpanded = new Set(expandedCustomers);
    if (newExpanded.has(customerId)) {
      newExpanded.delete(customerId);
    } else {
      newExpanded.add(customerId);
    }
    setExpandedCustomers(newExpanded);
  };

  if (saltPoolCustomers.length === 0) {
    return null; // Don't show section if no salt pool customers
  }

  return (
    <div className="mt-8">
      {/* Section Divider */}
      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t-2 border-cyan-200"></div>
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-4 flex items-center gap-2">
            <div className="p-1.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-700">Salt Cell Cleaning Log</span>
          </span>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Salt Cell Cleanings</h3>
            <p className="text-sm text-slate-600">
              {saltPoolCustomers.length} salt pool{saltPoolCustomers.length !== 1 ? 's' : ''} • {totalLogs} cleaning{totalLogs !== 1 ? 's' : ''} logged
            </p>
          </div>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          size="sm"
          className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg"
        >
          <Plus className="w-4 h-4 mr-2" />
          {showForm ? "Cancel" : "Log Cleaning"}
        </Button>
      </div>

      {/* Add Form */}
      {showForm && (
        <Card className="p-6 mb-4 border-2 shadow-lg bg-gradient-to-br from-cyan-50 to-blue-50">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="salt-customer">Customer *</Label>
                <Select
                  value={formData.customer_id}
                  onValueChange={(value) => setFormData({ ...formData, customer_id: value })}
                  required
                >
                  <SelectTrigger
                    aria-label="Customer"
                    className="mt-1 bg-white text-slate-900 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
                  >
                    <SelectValue placeholder="Select salt pool customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {saltPoolCustomers.map(customer => (
                      <SelectItem key={customer.id || customer._id} value={String(customer.id || customer._id)}>
                        <div className="flex items-center gap-2">
                          <Droplets className="w-3 h-3 text-cyan-500" />
                          {customer.full_name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="cleaning-date">Cleaning Date *</Label>
                <Input
                  id="cleaning-date"
                  type="date"
                  value={formData.cleaning_date}
                  onChange={(e) => setFormData({ ...formData, cleaning_date: e.target.value })}
                  required
                  className="mt-1 border-2 focus:border-cyan-500 rounded-xl"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="condition">Scale Condition</Label>
              <Select
                value={formData.condition}
                onValueChange={(value) => setFormData({ ...formData, condition: value })}
              >
                <SelectTrigger
                  aria-label="Scale Condition"
                  className="mt-1 bg-white text-slate-900 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(conditionConfig).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${config.bg}`}></span>
                        {config.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="salt-notes">Notes (optional)</Label>
              <Textarea
                id="salt-notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Any observations about the cell condition..."
                rows={2}
                className="mt-1 border-2 focus:border-cyan-500 rounded-xl"
              />
            </div>

            <Button
              type="submit"
              disabled={!formData.customer_id}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white"
            >
              Save Cleaning Log
            </Button>
          </form>
        </Card>
      )}

      {/* Customer-grouped Logs - Only show customers with at least one cleaning log */}
      <div className="space-y-2">
        {saltPoolCustomers
          .filter((customer) => {
            const customerId = String(customer.id || customer._id);
            return (logsByCustomer[customerId] || []).length > 0;
          })
          .map((customer) => {
            const customerId = String(customer.id || customer._id);
            const customerLogs = logsByCustomer[customerId] || [];
            const isExpanded = expandedCustomers.has(customerId);
            const logCount = customerLogs.length;

            return (
              <Card key={customerId} className="overflow-hidden border shadow-sm">
                {/* Customer Header */}
                <div
                  onClick={() => toggleCustomer(customerId)}
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50 active:bg-slate-100"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className="p-2 bg-cyan-100 rounded-lg">
                      <User className="w-4 h-4 text-cyan-600" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-slate-900">{customer.full_name}</span>
                      <p className="text-xs text-slate-500">
                        {logCount === 0
                          ? "No cleanings logged"
                          : `${logCount} cleaning${logCount !== 1 ? 's' : ''} logged`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {logCount > 0 && (
                      <span className="text-xs px-2 py-1 rounded-full bg-cyan-100 text-cyan-700 font-medium">
                        {logCount}
                      </span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {/* Expanded Logs */}
                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50">
                    {customerLogs.length > 0 ? (
                      <div className="divide-y divide-slate-200">
                        {customerLogs.map((log) => {
                          const condition = conditionConfig[log.condition] || conditionConfig.good;

                          return (
                            <div key={log.id} className="p-3 flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 flex-1">
                                <div className={`p-1.5 rounded-lg ${condition.bg} mt-0.5`}>
                                  <Zap className={`w-3 h-3 ${condition.color}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium text-slate-900">
                                      {format(parseISO(log.cleaning_date), "MMM dd, yyyy")}
                                    </span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${condition.bg} ${condition.color}`}>
                                      {condition.label}
                                    </span>
                                  </div>
                                  {log.notes && (
                                    <p className="text-xs text-slate-600 mt-1">{log.notes}</p>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteLog(log);
                                }}
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 h-7 w-7 flex-shrink-0"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 text-center">
                        <p className="text-sm text-slate-500">No cleanings logged for this customer</p>
                        <Button
                          onClick={() => {
                            setFormData(prev => ({ ...prev, customer_id: customerId }));
                            setShowForm(true);
                          }}
                          size="sm"
                          variant="outline"
                          className="mt-2"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Log First Cleaning
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteLog} onOpenChange={() => setDeleteLog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cleaning Log?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this salt cell cleaning log? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
