import React, { useState, useEffect, useMemo } from "react";
import { useChemicalUsage, useCustomersFilter, useCurrentUser, useChemicalUsageDelete, useChemicalUsageUpdate } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Plus, Beaker, ChevronDown, Trash2, Edit2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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

export default function ChemicalUsagePage() {
  const navigate = useNavigate();
  const user = useCurrentUser();

  const allCustomers = useCustomersFilter({ created_by: user.email });
  const allRecords = useChemicalUsage("-created_date");
  const deleteChemicalUsage = useChemicalUsageDelete();
  const updateChemicalUsage = useChemicalUsageUpdate();

  const [usageRecords, setUsageRecords] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCustomers, setExpandedCustomers] = useState(new Set());
  const [deleteRecord, setDeleteRecord] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [savingNoteId, setSavingNoteId] = useState(null);

  useEffect(() => {
    if (allCustomers && allRecords) {
      setCustomers(allCustomers);
      setUsageRecords(allRecords);
      setLoading(false);
    }
  }, [allCustomers, allRecords]);

  const handleDelete = async () => {
    if (deleteRecord) {
      await deleteChemicalUsage({ id: deleteRecord._id });
      setDeleteRecord(null);
      toast.success("Chemical usage deleted");
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

  const handleEditNote = (record) => {
    setEditingNoteId(record._id);
    setEditingNoteValue(record.notes || "");
  };

  const handleCancelEdit = () => {
    setEditingNoteId(null);
    setEditingNoteValue("");
  };

  const handleSaveNote = async (recordId) => {
    setSavingNoteId(recordId);
    try {
      await updateChemicalUsage({
        id: recordId,
        notes: editingNoteValue,
      });
      toast.success("Notes updated successfully");
      setEditingNoteId(null);
      setEditingNoteValue("");
    } catch (error) {
      toast.error("Failed to update notes");
    } finally {
      setSavingNoteId(null);
    }
  };


  // Group records by customer
  const recordsByCustomer = useMemo(() => {
    const grouped = {};
    usageRecords.forEach(record => {
      if (!grouped[record.customer_id]) {
        grouped[record.customer_id] = [];
      }
      grouped[record.customer_id].push(record);
    });
    return grouped;
  }, [usageRecords]);

  const getCustomerName = (customerId) => {
    return customers.find(c => c._id === customerId)?.full_name || "Unknown Customer";
  };

  const customersWithUsage = Object.keys(recordsByCustomer).sort((a, b) => {
    return getCustomerName(a).localeCompare(getCustomerName(b));
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl shadow-lg">
            <Beaker className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Chemical Usage</h2>
            <p className="text-sm text-slate-600">Track extra chemicals for billing</p>
          </div>
        </div>
        <Button
          onClick={() => navigate(createPageUrl("NewChemicalUsage"))}
          className="w-full sm:w-auto bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white shadow-lg"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Chemical Usage
        </Button>
      </div>

      {/* Total Count */}
      <Card className="p-6 mb-6 border-2 shadow-lg bg-gradient-to-br from-purple-50 to-pink-50">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Beaker className="w-6 h-6 text-purple-600" />
            <span className="text-lg font-semibold text-slate-700">Total Chemical Records</span>
          </div>
          <div className="text-4xl font-bold text-purple-600">
            {usageRecords.length}
          </div>
          <div className="text-sm text-slate-600 mt-1">
            {customersWithUsage.length} customer{customersWithUsage.length !== 1 ? 's' : ''}
          </div>
        </div>
      </Card>

      {/* Customer List */}
      {customersWithUsage.length === 0 ? (
        <Card className="p-12 text-center bg-slate-50 border-2 border-dashed border-slate-200">
          <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
            <Beaker className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            No Chemical Usage Records
          </h3>
          <p className="text-slate-600 mb-4">Start tracking extra chemicals used</p>
          <Button
            onClick={() => navigate(createPageUrl("NewChemicalUsage"))}
            className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Chemical Usage
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {customersWithUsage.map((customerId) => {
            const customerRecords = recordsByCustomer[customerId];
            const isExpanded = expandedCustomers.has(customerId);
            const customerName = getCustomerName(customerId);

            return (
              <Card key={customerId} className="overflow-hidden border-2 shadow-sm">
                <div
                  onClick={() => toggleCustomer(customerId)}
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 active:bg-slate-100"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center text-white font-bold">
                      {customerName.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">{customerName}</h3>
                      <p className="text-sm text-slate-600">
                        {customerRecords.length} record{customerRecords.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50">
                    <div className="p-4 space-y-2">
                      {customerRecords.map((record) => (
                        <Card key={record._id} className="p-3 bg-white border">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold text-slate-900">
                                  {record.chemical_type}
                                </span>
                                <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">
                                  {record.quantity}
                                </span>
                              </div>
                              <div className="text-xs text-slate-600 mb-1">
                                {format(parseISO(record.created_date), "MMM dd, yyyy 'at' h:mm a")}
                              </div>

                              {/* Notes Section */}
                              <div className="mt-2">
                                {editingNoteId === record._id ? (
                                  <div className="space-y-2">
                                    <Textarea
                                      value={editingNoteValue}
                                      onChange={(e) => setEditingNoteValue(e.target.value)}
                                      placeholder="Add notes..."
                                      rows={2}
                                      className="text-xs border-2 focus:border-purple-500 rounded-lg"
                                    />
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => handleSaveNote(record._id)}
                                        disabled={savingNoteId === record._id}
                                        className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                                      >
                                        {savingNoteId === record._id ? (
                                          <>Saving...</>
                                        ) : (
                                          <>
                                            <Save className="w-3 h-3 mr-1" />
                                            Save
                                          </>
                                        )}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleCancelEdit}
                                        disabled={savingNoteId === record._id}
                                        className="h-7 text-xs"
                                      >
                                        <X className="w-3 h-3 mr-1" />
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-start justify-between gap-2">
                                    {record.notes ? (
                                      <p className="text-xs text-slate-600 flex-1">{record.notes}</p>
                                    ) : (
                                      <p className="text-xs text-slate-400 italic flex-1">No notes</p>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleEditNote(record)}
                                      className="h-6 w-6 p-0 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteRecord(record);
                              }}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteRecord} onOpenChange={() => setDeleteRecord(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chemical Usage?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this chemical usage record? This action cannot be undone.
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