import React, { useState, useMemo } from "react";
import { useChemicalUsage, useCustomersFilter, useCurrentUser, useChemicalUsageDelete, useChemicalUsageUpdate } from "@/api/convexHooks";
import { ChevronDown, Trash2, Edit2, Save, X, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { PoolIcon, IconBadge } from "@/components/ui/iconography";
import { Button } from "@/components/ui/button";
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
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import { format, parseISO, startOfMonth, endOfMonth, addMonths, isWithinInterval } from "date-fns";
import AddChemicalForm from "@/components/servicelog/AddChemicalForm";
import { ChemicalBeakerLoader } from "@/components/ui/loader";
import { scrollElementIntoView } from "@/lib/scrollMotion";

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
  const user = useCurrentUser();
  // query under DEFAULT_USER and then refetch under the real user's data (flicker).
  const customers = useCustomersFilter(user?.email ? { created_by: user.email } : undefined);
  const usageRecords = useChemicalUsage("-created_date");
  const deleteChemicalUsage = useChemicalUsageDelete();
  const updateChemicalUsage = useChemicalUsageUpdate();

  // Dexie's useLiveQuery returns undefined until the first read completes;
  // undefined is the real "still loading" signal; no mirror state needed.
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
              font-family: 'Outfit', 'Segoe UI', system-ui, sans-serif;
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
              letter-spacing: -0.03em;
              color: #0891b2;
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
              color: #0891b2;
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
              background: #ecfeff;
              color: #155e75;
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
              background: #0891b2;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 999px;
              font-size: 13px;
              cursor: pointer;
              box-shadow: 0 10px 15px rgba(8, 145, 178, 0.2);
            }
            .close-button:hover {
              background: #0e7490;
            }
            @media print {
              body { padding: 12px; }
              .close-button { display: none; }
            }
          </style>
        </head>
        <body>
          <button class="close-button" onclick="window.print(); setTimeout(() => window.close(), 500);">Print Report</button>
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
    <main className="relative mx-auto max-w-7xl px-3 pb-32 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Chemical Usage">
      <div className="mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card ">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-3xl font-semibold leading-tight tracking-[-0.045em] text-ink sm:text-4xl">
              Chemical Usage
            </h2>
            <p className="mt-1 text-sm font-medium text-ink-muted">
              Track extra chemicals for billing
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0">
            <Drawer open={isAddSheetOpen} onOpenChange={setIsAddSheetOpen}>
              <DrawerTrigger asChild>
                <Button className="h-12 w-full rounded-card bg-brand px-4 text-sm font-semibold text-white shadow-cta hover:bg-brand-strong sm:w-auto">
                  <PoolIcon name="add" className="mr-2 h-4 w-4" />
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
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-raised border border-line bg-surface-1 p-4 shadow-card ">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">Selected Month</p>
          <p className="mt-1 text-lg font-semibold tracking-[-0.025em] text-ink tabular-nums">{selectedMonthLabel}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => setMonthOffset(monthOffset - 1)}
              variant="outline"
              size="sm"
              className="h-9 rounded-full border border-line bg-surface-1 px-3 text-xs font-semibold text-ink shadow-sm hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
            >
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
              Previous
            </Button>
            {!isCurrentMonth && (
              <Button
                onClick={() => setMonthOffset(0)}
                variant="outline"
                size="sm"
                className="h-9 rounded-full border border-[var(--status-info-line)] bg-brand-softer px-3 text-xs font-semibold text-brand-ink shadow-sm hover:bg-brand-soft"
              >
                Current Month
              </Button>
            )}
            <Button
              onClick={() => setMonthOffset(monthOffset + 1)}
              variant="outline"
              size="sm"
              disabled={isCurrentMonth}
              className="h-9 rounded-full border border-line bg-surface-1 px-3 text-xs font-semibold text-ink shadow-sm hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink disabled:border-line disabled:bg-surface-2 disabled:text-ink-muted"
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-raised border border-line bg-surface-1 p-4 shadow-card ">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-softer text-brand-ink shadow-inner">
              <PoolIcon name="chemicals" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">Monthly Chemical Records</p>
              <p className="mt-0.5 text-sm font-medium text-ink-muted">
                Across {customersWithUsage.length} customer{customersWithUsage.length !== 1 ? 's' : ''}
              </p>
            </div>
            <p className="ml-auto text-2xl font-semibold tabular-nums text-ink">{monthlyRecords.length}</p>
          </div>
          <Button
            onClick={generateChemicalPDF}
            disabled={generating || !hasMonthlyRecords}
            className="mt-3 h-10 w-full rounded-card bg-ink px-3 text-sm font-semibold text-surface-0 shadow-raised hover:bg-brand-strong disabled:bg-surface-2 disabled:text-ink-muted disabled:shadow-none"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {generating ? "Generating..." : "Download Monthly Chemical Log"}
          </Button>
        </div>
      </div>

      {customersWithUsage.length === 0 ? (
        <div className="rounded-sheet border border-dashed border-line bg-surface-2 px-5 py-10 text-center shadow-sm">
          <IconBadge name="chemicals" size="lg" tone="slate" className="mx-auto mb-4" iconClassName="h-7 w-7" />
          <h3 className="mb-1 text-lg font-semibold tracking-[-0.025em] text-ink">
            No Chemical Usage Records This Month
          </h3>
          <p className="mx-auto mb-5 max-w-sm text-sm font-medium text-ink-muted">
            Switch months or add usage entries to build a reportable log.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {customersWithUsage.map((customerId) => {
            const customerRecords = recordsByCustomer[customerId] || [];
            const isExpanded = expandedCustomers.has(customerId);
            const customerName = getCustomerName(customerId);

            return (
              <div
                key={customerId}
                className="overflow-hidden rounded-raised border border-line bg-surface-1 shadow-card"
              >
                <button
                  type="button"
                  onClick={() => toggleCustomer(customerId)}
                  aria-expanded={isExpanded}
                  className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-brand-softer active:bg-brand-softer"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold tracking-[-0.02em] text-ink">
                        {customerName}
                      </h3>
                      <p className="text-xs font-medium text-ink-muted">
                        {customerRecords.length} record{customerRecords.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-ink-muted transition-transform ${isExpanded ? 'rotate-180 text-brand-ink' : ''}`}
                    aria-hidden="true"
                  />
                </button>

                {isExpanded && (
                  <div className="border-t border-line bg-surface-2">
                    <div className="space-y-2 p-3">
                      {customerRecords.map((record) => (
                        <div
                          key={record._id}
                          className="rounded-2xl border border-line bg-surface-1 p-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-ink">
                                  {record.chemical_type}
                                </span>
                                <span className="rounded-full bg-brand-softer px-2 py-0.5 text-xs font-semibold text-brand-ink">
                                  {record.quantity}
                                </span>
                              </div>
                              <div className="mt-0.5 text-xs font-medium text-ink-muted">
                                {formatUsageDate(record.created_date)}
                              </div>

                              <div className="mt-2">
                                {editingNoteId === record._id ? (
                                  <div className="space-y-2">
                                    <Textarea
                                      value={editingNoteValue}
                                      onChange={(e) => setEditingNoteValue(e.target.value)}
                                      onFocus={(e) => {
                                        const field = e.currentTarget;
                                        window.setTimeout(() => {
                                          scrollElementIntoView(field, { block: "center" });
                                        }, 250);
                                      }}
                                      placeholder="Add notes..."
                                      rows={2}
                                      className="rounded-xl border border-line bg-white text-xs focus:border-ring focus-visible:ring-ring"
                                    />
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => handleSaveNote(record._id)}
                                        disabled={savingNoteId === record._id}
                                        className="h-8 rounded-full bg-ink px-3 text-xs font-semibold text-surface-0 hover:bg-brand-strong"
                                      >
                                        {savingNoteId === record._id ? (
                                          <>Saving...</>
                                        ) : (
                                          <>
                                            <Save className="mr-1 h-3 w-3" aria-hidden="true" />
                                            Save
                                          </>
                                        )}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleCancelEdit}
                                        disabled={savingNoteId === record._id}
                                        className="h-8 rounded-full border border-line bg-surface-1 px-3 text-xs font-semibold text-ink hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
                                      >
                                        <X className="mr-1 h-3 w-3" aria-hidden="true" />
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-start justify-between gap-2">
                                    {record.notes ? (
                                      <p className="flex-1 text-xs leading-relaxed text-ink-secondary">{record.notes}</p>
                                    ) : (
                                      <p className="flex-1 text-xs italic text-ink-muted">No notes</p>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleEditNote(record)}
                                      aria-label={`Edit notes for ${record.chemical_type} ${record.quantity}`}
                                      className="h-11 w-11 shrink-0 rounded-full p-0 text-brand-ink hover:bg-brand-softer hover:text-brand-ink"
                                    >
                                      <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
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
                              aria-label={`Delete ${record.chemical_type} ${record.quantity} record`}
                              className="h-11 w-11 shrink-0 rounded-full p-0 text-critical hover:bg-[var(--status-critical-soft)] hover:text-critical"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
              className="bg-destructive font-semibold text-white hover:bg-destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
