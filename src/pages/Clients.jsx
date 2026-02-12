import { useState, useEffect, useMemo, useCallback } from "react";
import { useCustomersFilter, useCurrentUser, useCustomerUpdate, useCustomerDelete } from "@/api/convexHooks";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Plus, Users, Search, ArrowUp, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import ClientListItem from "../components/clients/ClientListItem";
import { toast } from "sonner";
import { getEffectiveWorkingDays } from "@/lib/workingDays";

export default function Clients() {
  const navigate = useNavigate();
  const user = useCurrentUser();

  // Get business settings for working days
  const convexBusiness = useQuery(api.businesses.getCurrent);

  const allCustomers = useCustomersFilter({ created_by: user.email });
  const updateCustomer = useCustomerUpdate();
  const deleteCustomerMutation = useCustomerDelete();

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState("Monday");
  const [deleteCustomer, setDeleteCustomer] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [reorderMode, setReorderMode] = useState(false);
  const [movingCustomerId, setMovingCustomerId] = useState(null);

  // Get working days from cloud settings with local fallback for offline/dev mode.
  const daysOfWeek = useMemo(() => {
    return getEffectiveWorkingDays(convexBusiness);
  }, [convexBusiness]);

  const validWorkingDays = daysOfWeek;

  // Update activeDay if it's not in the working days list
  useEffect(() => {
    if (validWorkingDays.length > 0 && !validWorkingDays.includes(activeDay)) {
      setActiveDay(validWorkingDays[0]);
    }
  }, [validWorkingDays, activeDay]);

  useEffect(() => {
    if (allCustomers && convexBusiness !== undefined) {
      setLoading(true);

      // Initialize sort_order if needed
      const dayGroups = {};
      allCustomers.forEach(customer => {
        if (!dayGroups[customer.service_day]) {
          dayGroups[customer.service_day] = [];
        }
        dayGroups[customer.service_day].push(customer);
      });

      const updatePromises = [];
      for (const day in dayGroups) {
        const dayCustomers = dayGroups[day];
        dayCustomers.forEach((customer, index) => {
          if (customer.sort_order === undefined || customer.sort_order === null) {
            updatePromises.push(
              updateCustomer({ id: customer._id, sort_order: index })
            );
            customer.sort_order = index;
          }
        });
      }

      if (updatePromises.length > 0) {
        Promise.all(updatePromises).then(() => {
          // Data will auto-refresh via Convex reactivity
        });
      }

      const sorted = [...allCustomers].sort((a, b) => {
        if (a.service_day !== b.service_day) {
          return a.service_day.localeCompare(b.service_day);
        }
        return (a.sort_order || 0) - (b.sort_order || 0);
      });

      setCustomers(sorted);
      setLoading(false);
    }
  }, [allCustomers, convexBusiness, updateCustomer]);

  const handleDelete = async () => {
    if (deleteCustomer) {
      await deleteCustomerMutation({ id: deleteCustomer._id });
      setDeleteCustomer(null);
    }
  };

  const handleEdit = useCallback((customer) => {
    navigate(createPageUrl("EditClient") + `?id=${customer._id}`);
  }, [navigate]);

  const handleMoveUp = async (customer) => {
    if (movingCustomerId) return;
    setMovingCustomerId(customer._id);

    try {
      const dayCustomers = customers.filter(c => c.service_day === customer.service_day);
      const currentIndex = dayCustomers.findIndex(c => c._id === customer._id);

      if (currentIndex <= 0) {
        setMovingCustomerId(null);
        return;
      }

      const customerAbove = dayCustomers[currentIndex - 1];
      const tempOrder = customer.sort_order;

      await Promise.all([
        updateCustomer({ id: customer._id, sort_order: customerAbove.sort_order }),
        updateCustomer({ id: customerAbove._id, sort_order: tempOrder })
      ]);

      toast.success("Customer moved up");
    } catch (error) {
      console.error("Error moving customer:", error);
      toast.error("Failed to move customer");
    } finally {
      setMovingCustomerId(null);
    }
  };

  const handleMoveDown = async (customer) => {
    if (movingCustomerId) return;
    setMovingCustomerId(customer._id);

    try {
      const dayCustomers = customers.filter(c => c.service_day === customer.service_day);
      const currentIndex = dayCustomers.findIndex(c => c._id === customer._id);

      if (currentIndex >= dayCustomers.length - 1) {
        setMovingCustomerId(null);
        return;
      }

      const customerBelow = dayCustomers[currentIndex + 1];
      const tempOrder = customer.sort_order;

      await Promise.all([
        updateCustomer({ id: customer._id, sort_order: customerBelow.sort_order }),
        updateCustomer({ id: customerBelow._id, sort_order: tempOrder })
      ]);

      toast.success("Customer moved down");
    } catch (error) {
      console.error("Error moving customer:", error);
      toast.error("Failed to move customer");
    } finally {
      setMovingCustomerId(null);
    }
  };

  // Memoized filtered customers by day
  const getCustomersByDay = useCallback((day) => {
    return customers
      .filter((c) => c.service_day === day)
      .filter((c) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return c.full_name.toLowerCase().includes(query) ||
          c.address.toLowerCase().includes(query);
      });
  }, [customers, searchQuery]);

  // Memoized customer counts
  const customerCounts = useMemo(() => {
    const counts = {};
    customers.forEach(c => {
      counts[c.service_day] = (counts[c.service_day] || 0) + 1;
    });
    return counts;
  }, [customers]);

  // Check for orphaned customers (customers with service days not in working days)
  const orphanedCustomers = useMemo(() => {
    return customers.filter(c => !daysOfWeek.includes(c.service_day));
  }, [customers, daysOfWeek]);

  // Calculate total visible customers (excluding orphaned ones)
  const visibleCustomerCount = useMemo(() => {
    return customers.filter(c => daysOfWeek.includes(c.service_day)).length;
  }, [customers, daysOfWeek]);

  if (loading || convexBusiness === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Clients</h2>
            <p className="text-sm text-slate-900">
              {visibleCustomerCount} clients scheduled
              {orphanedCustomers.length > 0 && (
                <span className="text-amber-600 ml-1">
                  ({orphanedCustomers.length} not on working days)
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          {!reorderMode ? (
            <>
              <Button
                onClick={() => setReorderMode(true)}
                variant="outline"
                className="flex-1 sm:flex-none border-2 rounded-xl hover:border-blue-500"
              >
                <ArrowUp className="w-4 h-4 mr-2" />
                Reorder
              </Button>
              <Button
                onClick={() => navigate(createPageUrl("NewClient"))}
                className="flex-1 sm:flex-none bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg"
              >
                <Plus className="w-5 h-5 mr-2" />
                Add Client
              </Button>
            </>
          ) : (
            <Button
              onClick={() => setReorderMode(false)}
              className="w-full sm:w-auto bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg"
            >
              <Check className="w-4 h-4 mr-2" />
              Done Reordering
            </Button>
          )}
        </div>
      </div>

      {reorderMode && (
        <Card className="p-4 mb-4 bg-blue-50 border-2 border-blue-200">
          <p className="text-sm text-blue-900 font-medium">
            ⬆️⬇️ Reorder Mode - Use arrows to move customers up or down
          </p>
        </Card>
      )}

      {orphanedCustomers.length > 0 && (
        <Card className="p-4 mb-4 bg-amber-50 border-2 border-amber-200">
          <div className="flex items-start gap-3">
            <div className="p-1 bg-amber-500 rounded-full">
              <Users className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900 mb-1">
                ⚠️ {orphanedCustomers.length} customer{orphanedCustomers.length !== 1 ? 's' : ''} not scheduled on working days
              </p>
              <p className="text-xs text-amber-800">
                These customers have service days outside your current working schedule: {orphanedCustomers.map(c => c.full_name).join(', ')}
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Update their service days in Settings → Schedule or edit individual customers.
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search clients by name or address..."
          className="pl-10 border-2 focus:border-cyan-500 rounded-xl bg-white"
        />
      </div>

      <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
        <div className="overflow-x-auto mb-6">
          <TabsList className="inline-flex w-full sm:w-auto min-w-full sm:min-w-0 bg-slate-100 p-1 rounded-2xl">
            {validWorkingDays.map((day) => {
              const count = customerCounts[day] || 0;
              return (
                <TabsTrigger
                  key={day}
                  value={day}
                  className="flex-1 sm:flex-none rounded-xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-cyan-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all whitespace-nowrap px-3 relative"
                >
                  <span>{day.substring(0, 3)}</span>
                  {count > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-white/20 rounded-full">
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {validWorkingDays.map((day) => {
          const dayCustomers = getCustomersByDay(day);
          return (
            <TabsContent key={day} value={day}>
              {dayCustomers.length === 0 ? (
                <Card className="p-12 text-center bg-slate-50 border-2 border-dashed border-slate-200">
                  <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
                    <Users className="w-8 h-8 text-slate-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    {searchQuery ? "No Matching Clients" : `No Clients for ${day}`}
                  </h3>
                  <p className="text-slate-900 mb-4">
                    {searchQuery ? "Try adjusting your search" : "Add clients to this day's route"}
                  </p>
                </Card>
              ) : (
                <div className="space-y-2">
                  {dayCustomers.map((customer, index) => (
                    <ClientListItem
                      key={customer._id}
                      customer={customer}
                      onDelete={setDeleteCustomer}
                      onEdit={handleEdit}
                      onClick={(c) => navigate(createPageUrl("CustomerDetail") + `?id=${c._id}`)}
                      reorderMode={reorderMode}
                      onMoveUp={handleMoveUp}
                      onMoveDown={handleMoveDown}
                      isFirst={index === 0}
                      isLast={index === dayCustomers.length - 1}
                      isMoving={movingCustomerId === customer._id}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <AlertDialog open={!!deleteCustomer} onOpenChange={() => setDeleteCustomer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete <strong>{deleteCustomer?.full_name}</strong> and all their service logs? This action cannot be undone.
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
