import React, { useState, useEffect, useMemo } from "react";
import { useChemicalUsage, useCustomersFilter, useCurrentUser, useChemicalUsageDelete, useChemicalUsageUpdate } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Plus, TestTube, ChevronDown, Trash2, Edit2, Save, X, Download, ChevronLeft, ChevronRight } from "lucide-react";
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
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import { format, parseISO, startOfMonth, endOfMonth, addMonths, isWithinInterval } from "date-fns";
import AddChemicalForm from "@/components/servicelog/AddChemicalForm";
import { ChemicalBeakerLoader } from "@/components/ui/loader";

function downloadHtmlReport(filename, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function ChemicalUsagePage() {
  const navigate = useNavigate();
  const user = useCurrentUser();

  // Only pass created_by once we actually have a user, so we don't briefly
  // query under DEFAULT_USER and then refetch under the real user's data (flicker).
  const customers = useCustomersFilter(user?.email ? { created_by: user.email } : undefined);
  const usageRecords = useChemicalUsage("-created_date");
  const deleteChemicalUsage = useChemicalUsageDelete();
  const updateChemicalUsage = useChemicalUsageUpdate();

  // Dexie's useLiveQuery returns undefined until the first read completes;
  // undefined is the real "still loading" signal — no mirror state needed.
  const loading = !customers || !usageRecords;

  const [expandedCustomers, setExpandedCustomers] = useState(new Set());
  const [deleteRecord, setDeleteRecord] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteValue, setEditingNoteValue] = useState("");
  const [savingNoteId, setSavingNoteId] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);

  const baseDate = addMonths(new Date(), monthOffset);
  const currentMonthStart = startOfMonth(baseDate);
  const currentMonthEnd = endOfMonth(baseDate);
  const isCurrentMonth = monthOffset === 0;

  const formatUsageDate = (dateString) => {
    if (!dateString) return "-";
    try {
      return format(parseISO(dateString), "MMM dd, yyyy 'at' h:mm a");
    } catch (error) {
      console.error("Invalid date:", dateString);
      return "-";
    }
  };

  const monthlyRecords = useMemo(() => {
    return usageRecords.filter(record => {
      if (!record.created_date) return false;
      try {
        const recordDate = parseISO(record.created_date);
        return isWithinInterval(recordDate, { start: currentMonthStart, end: currentMonthEnd });
      } catch (error) {
        console.error("Invalid date:", record.created_date);
        return false;
      }
    });
  }, [usageRecords, currentMonthStart, currentMonthEnd]);

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
  const recordsByCustomer = useMemo(() => {
    const grouped = {};
    monthlyRecords.forEach(record => {
      if (!grouped[record.customer_id]) {
        grouped[record.customer_id] = [];
      }
      grouped[record.customer_id].push(record);
    });
    return grouped;
  }, [monthlyRecords]);

  const getCustomerName = (customerId) => {
    const idToCheck = typeof customerId === 'string' ? parseInt(customerId, 10) : customerId;
    return customers.find(c => c._id === idToCheck)?.full_name || "Unknown Customer";
  };

  const customersWithUsage = Object.keys(recordsByCustomer).sort((a, b) => {
    return getCustomerName(a).localeCompare(getCustomerName(b));
  });

  const hasMonthlyRecords = monthlyRecords.length > 0;
  const selectedMonthLabel = `${format(currentMonthStart, "MMMM yyyy")}`;

  const generateChemicalPDF = () => {
    if (monthlyRecords.length === 0) return;

    setGenerating(true);

    const reportHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Chemical Usage Report - ${format(currentMonthStart, "MMMM yyyy")}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Arial', sans-serif;
              padding: 24px;
              font-size: 12px;
              color: #0f172a;
              background: #f8fafc;
            }
            .header {
              text-align: center;
              margin-bottom: 24px;
            }
            .header h1 {
              font-size: 28px;
              color: #7c3aed;
              margin-bottom: 6px;
            }
            .header p {
              color: #475569;
              font-size: 13px;
            }
            .customer-section {
              background: white;
              border: 2px solid #e2e8f0;
              border-radius: 12px;
              padding: 16px;
              margin-bottom: 18px;
              page-break-inside: avoid;
            }
            .customer-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 12px;
            }
            .customer-header h2 {
              font-size: 18px;
              color: #0f172a;
            }
            .customer-header p {
              font-size: 11px;
              color: #475569;
            }
            .customer-header span {
              font-size: 11px;
              color: #7c3aed;
              font-weight: 600;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            th {
              text-align: left;
              padding: 8px;
              background: #f1f5f9;
              font-size: 11px;
              color: #475569;
              border-bottom: 2px solid #e2e8f0;
            }
            td {
              padding: 8px;
              font-size: 11px;
              border-bottom: 1px solid #e2e8f0;
              vertical-align: top;
            }
            .chem-pill {
              display: inline-block;
              padding: 2px 8px;
              border-radius: 999px;
              background: #f3e8ff;
              color: #6d28d9;
              font-weight: 600;
            }
            .notes {
              color: #475569;
              white-space: pre-wrap;
            }
            .empty-message {
              text-align: center;
              color: #94a3b8;
              font-style: italic;
            }
            .close-button {
              position: fixed;
              top: 20px;
              right: 20px;
              background: #7c3aed;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 999px;
              font-size: 13px;
              cursor: pointer;
              box-shadow: 0 10px 15px rgba(124, 58, 237, 0.2);
            }
            .close-button:hover {
              background: #6d28d9;
            }
            @media print {
              body { padding: 12px; }
              .close-button { display: none; }
            }
          </style>
        </head>
        <body>
          <button class="close-button" onclick="window.print(); setTimeout(() => window.close(), 500);">🖨️ Print Report</button>
          <div class="header">
            <h1>Monthly Chemical Usage</h1>
            <p><strong>Month:</strong> ${format(currentMonthStart, "MMMM yyyy")}</p>
            <p><strong>Generated:</strong> ${format(new Date(), "PPpp")}</p>
          </div>

          ${customersWithUsage.map(customerId => {
      const idToCheck = parseInt(customerId, 10);
      const customer = customers.find(c => c._id === idToCheck) || {};
      const records = recordsByCustomer[customerId] || [];
      const customerAddress = customer.address || "No address on file";

      return `
              <div class="customer-section">
                <div class="customer-header">
                  <div>
                    <h2>${customer.full_name || "Unknown Customer"}</h2>
                    <p>${customerAddress}</p>
                  </div>
                  <span>${records.length} entr${records.length === 1 ? "y" : "ies"}</span>
                </div>
                ${records.length === 0 ? `
                  <p class="empty-message">No usage recorded</p>
                ` : `
                  <table>
                    <thead>
                      <tr>
                        <th style="width: 22%;">Date</th>
                        <th style="width: 28%;">Chemical</th>
                        <th style="width: 12%;">Qty</th>
                        <th style="width: 38%;">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${records.map(record => `
                        <tr>
                          <td>${formatUsageDate(record.created_date)}</td>
                          <td><span class="chem-pill">${record.chemical_type || "Unknown"}</span></td>
                          <td>${record.quantity || "-"}</td>
                          <td class="notes">${record.notes ? record.notes : "-"}</td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                `}
              </div>
            `;
    }).join("")}
        </body>
      </html>
    `;
    downloadHtmlReport(`chemical-usage-${format(currentMonthStart, "yyyy-MM")}.html`, reportHTML);
    setGenerating(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <ChemicalBeakerLoader />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-sans">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Chemical Usage</h2>
            <p className="text-sm font-medium text-slate-600">Track extra chemicals for billing</p>
          </div>
        </div>

        <Drawer open={isAddSheetOpen} onOpenChange={setIsAddSheetOpen}>
          <DrawerTrigger asChild>
            <Button
              className="w-full sm:w-auto bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white shadow-lg font-semibold"
            >
              <Plus className="w-5 h-5 mr-2 stroke-[1.75]" />
              Add Chemical Usage
            </Button>
          </DrawerTrigger>
          <DrawerContent className="max-h-[92dvh] overflow-hidden">
            <div className="mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col">
              <DrawerHeader>
                <DrawerTitle>Add Chemical Usage</DrawerTitle>
                <DrawerDescription>Record extra chemicals used for billing purposes.</DrawerDescription>
              </DrawerHeader>
              <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
                <AddChemicalForm
                  onSuccess={() => setIsAddSheetOpen(false)}
                  onCancel={() => setIsAddSheetOpen(false)}
                />
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      <div className="space-y-3 mb-6">
        <Card className="p-4 border-2 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected Month</p>
              <p className="text-lg font-bold tracking-tight text-slate-900">{selectedMonthLabel}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => setMonthOffset(monthOffset - 1)}
                variant="outline"
                size="sm"
                className="border-2 rounded-xl font-medium"
              >
                <ChevronLeft className="w-4 h-4 mr-1 stroke-[1.75]" />
                Previous
              </Button>
              {!isCurrentMonth && (
                <Button
                  onClick={() => setMonthOffset(0)}
                  variant="outline"
                  size="sm"
                  className="border-2 rounded-xl border-purple-500 text-purple-600 font-medium"
                >
                  Current Month
                </Button>
              )}
              <Button
                onClick={() => setMonthOffset(monthOffset + 1)}
                variant="outline"
                size="sm"
                className="border-2 rounded-xl font-medium"
                disabled={isCurrentMonth}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1 stroke-[1.75]" />
              </Button>
            </div>
          </div>
        </Card>

        <Button
          onClick={generateChemicalPDF}
          disabled={generating || !hasMonthlyRecords}
          className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg text-sm h-10 font-semibold"
        >
          <Download className="w-4 h-4 mr-2 stroke-[1.75]" />
          {generating ? "Generating..." : "Download Monthly Chemical Log"}
        </Button>
      </div>

      <Card className="p-6 mb-6 border-2 shadow-lg bg-gradient-to-br from-purple-50 to-pink-50">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <TestTube className="w-6 h-6 text-purple-600 stroke-[1.75]" />
            <span className="text-lg font-semibold text-slate-700">Monthly Chemical Records</span>
          </div>
          <div className="text-4xl font-bold tracking-tight text-purple-600">
            {monthlyRecords.length}
          </div>
          <div className="text-sm font-medium text-slate-600 mt-1">
            {customersWithUsage.length} customer{customersWithUsage.length !== 1 ? 's' : ''}
          </div>
        </div>
      </Card>

      {customersWithUsage.length === 0 ? (
        <Card className="p-12 text-center bg-slate-50 border-2 border-dashed border-slate-200">
          <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
            <TestTube className="w-8 h-8 text-slate-400 stroke-[1.75]" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            No Chemical Usage Records This Month
          </h3>
          <p className="text-slate-600 mb-4 font-medium">Switch months or add usage entries to build a reportable log.</p>
          <Button
            onClick={() => setIsAddSheetOpen(true)}
            className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-semibold"
          >
            <Plus className="w-4 h-4 mr-2 stroke-[1.75]" />
            Add Chemical Usage
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {customersWithUsage.map((customerId) => {
            const customerRecords = recordsByCustomer[customerId] || [];
            const isExpanded = expandedCustomers.has(customerId);
            const customerName = getCustomerName(customerId);

            return (
              <Card key={customerId} className="overflow-hidden border-2 shadow-sm">
                <div
                  onClick={() => toggleCustomer(customerId)}
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 active:bg-slate-100"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <h3 className="font-bold text-slate-900 tracking-tight">{customerName}</h3>
                      <p className="text-sm font-medium text-slate-600">
                        {customerRecords.length} record{customerRecords.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-slate-400 stroke-[1.75] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
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
                                {formatUsageDate(record.created_date)}
                              </div>

                              <div className="mt-2">
                                {editingNoteId === record._id ? (
                                  <div className="space-y-2">
                                    <Textarea
                                      value={editingNoteValue}
                                      onChange={(e) => setEditingNoteValue(e.target.value)}
                                      onFocus={(e) => {
                                        window.setTimeout(() => {
                                          e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" });
                                        }, 250);
                                      }}
                                      placeholder="Add notes..."
                                      rows={2}
                                      className="text-xs border-2 focus:border-purple-500 rounded-lg"
                                    />
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => handleSaveNote(record._id)}
                                        disabled={savingNoteId === record._id}
                                        className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white font-semibold"
                                      >
                                        {savingNoteId === record._id ? (
                                          <>Saving...</>
                                        ) : (
                                          <>
                                            <Save className="w-3 h-3 mr-1 stroke-[1.75]" />
                                            Save
                                          </>
                                        )}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleCancelEdit}
                                        disabled={savingNoteId === record._id}
                                        className="h-7 text-xs font-medium"
                                      >
                                        <X className="w-3 h-3 mr-1 stroke-[1.75]" />
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
                                      <Edit2 className="w-3 h-3 stroke-[1.75]" />
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
                              <Trash2 className="w-3.5 h-3.5 stroke-[1.75]" />
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
              className="bg-red-600 hover:bg-red-700 text-white font-semibold"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
