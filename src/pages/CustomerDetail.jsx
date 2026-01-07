import { useState, useEffect, useCallback, useMemo } from "react";
import { useCustomers, useServiceLogsByCustomer, useServiceLogDelete, useCustomerUpdate } from "@/api/convexHooks";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl, formatServiceDate, parseLocalDate } from "@/utils";
import { ArrowLeft, MapPin, Phone, Mail, Droplets, Plus, Calendar, FileText, BarChart3, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import ServiceLogCard from "../components/servicelog/ServiceLogCard";
import PoolAnalysisPanel from "@/components/PoolAnalysisPanel";
import { SendReportDialog } from "@/components/service-reports";
import { ReportSettingsPanel } from "@/components/service-reports/ReportSettingsPanel";
import { formatSmsMessage, buildReportUrl } from "@/lib/smsReport";
import { toast } from "sonner";
import { subWeeks, startOfWeek, endOfWeek } from "date-fns";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { syncService } from "@/lib/sync/SyncService";
import { CustomerDetailSkeleton, ServiceLogCardSkeleton } from "@/components/ui/skeleton";

// Check if Convex is available (online mode)
const isConvexAvailable = !!(import.meta.env.VITE_CONVEX_URL && import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

/**
 * IMPLEMENTATION NOTE: SMS Report Sending
 * 
 * The SMS report sending feature is currently a stub implementation because the app
 * runs in offline mode (Dexie) without Convex integration.
 * 
 * To fully implement SMS sending:
 * 
 * 1. Add ConvexProvider to main.jsx:
 *    ```jsx
 *    import { ConvexProvider, ConvexReactClient } from "convex/react";
 *    const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
 *    // Wrap app with <ConvexProvider client={convex}>
 *    ```
 * 
 * 2. Use the Convex action at component level (not in callback):
 *    ```jsx
 *    import { useAction } from "convex/react";
 *    import { api } from "../../convex/_generated/api";
 *    const sendReport = useAction(api.serviceReports.sendReport);
 *    ```
 * 
 * 3. Sync service logs to Convex (currently only in Dexie):
 *    - Create a sync service that uploads Dexie logs to Convex
 *    - Store Convex IDs alongside Dexie IDs
 * 
 * 4. Configure Telnyx in Convex environment:
 *    - Set TELNYX_API_KEY, TELNYX_MESSAGING_PROFILE_ID, TELNYX_FROM_NUMBER
 * 
 * 5. Call the action in handleConfirmSendReport:
 *    ```jsx
 *    const result = await sendReport({ service_log_id: convexLogId });
 *    ```
 */

export default function CustomerDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const urlParams = new URLSearchParams(window.location.search);
  const customerIdParam = urlParams.get("id");
  const customerId = customerIdParam ? parseInt(customerIdParam, 10) : null;

  // Use navigation state for instant render if available
  const navigationCustomer = location.state?.customer;
  const navigationLastWeekLog = location.state?.lastWeekLog;

  const customers = useCustomers();
  const logs = useServiceLogsByCustomer(customerId);
  const deleteServiceLog = useServiceLogDelete();
  const updateCustomer = useCustomerUpdate();

  // Convex action for sending reports - always call hook unconditionally
  // Runtime check at line 181 validates isConvexAvailable before use
  const sendReportAction = useAction(api.serviceReports.sendReport);

  // Initialize with navigation state for instant render
  const [lastWeekLog, setLastWeekLog] = useState(navigationLastWeekLog || null);
  const [loading, setLoading] = useState(!navigationCustomer);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Report Settings Dialog state
  const [reportSettingsOpen, setReportSettingsOpen] = useState(false);
  const [reportSettingsLoading, setReportSettingsLoading] = useState(false);
  const [reportSettingsError, setReportSettingsError] = useState(null);

  // Send Report Dialog state
  const [sendReportDialogOpen, setSendReportDialogOpen] = useState(false);
  const [selectedLogForReport, setSelectedLogForReport] = useState(null);
  const [sendReportLoading, setSendReportLoading] = useState(false);
  const [sendReportError, setSendReportError] = useState(null);
  const [reportStatuses, setReportStatuses] = useState({});
  const [customNote, setCustomNote] = useState('');

  // Determine the current customer from the live query hook
  const customer = useMemo(() => {
    if (!customers || !customerId) return navigationCustomer || null;
    return customers.find((c) => c._id === customerId) || navigationCustomer || null;
  }, [customers, customerId, navigationCustomer]);

  useEffect(() => {
    if (customers && customerId) {
      setLoading(false);
    }
  }, [customers, customerId]);

  useEffect(() => {
    // Only calculate if we don't have lastWeekLog from navigation state
    if (logs && logs.length > 0 && !navigationLastWeekLog) {
      const lastWeekStart = startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });
      const lastWeekEnd = endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });

      const lastWeek = logs.find(log => {
        // Use parseLocalDate to avoid timezone issues with YYYY-MM-DD strings
        const logDate = parseLocalDate(log.service_date);
        return logDate && logDate >= lastWeekStart && logDate <= lastWeekEnd;
      });

      setLastWeekLog(lastWeek);
    }
  }, [logs, navigationLastWeekLog]);

  const handleDeleteLog = async (logId) => {
    await deleteServiceLog(logId);
  };

  // Handle opening the report settings dialog
  const handleOpenReportSettings = useCallback(() => {
    setReportSettingsError(null);
    setReportSettingsOpen(true);
  }, []);

  // Handle closing the report settings dialog
  const handleCloseReportSettings = useCallback(() => {
    setReportSettingsOpen(false);
    setReportSettingsError(null);
  }, []);

  // Handle saving report settings
  const handleSaveReportSettings = useCallback(async (settings) => {
    if (!customer) return;

    setReportSettingsLoading(true);
    setReportSettingsError(null);

    try {
      await updateCustomer({
        id: customer._id,
        report_settings: settings,
      });
      toast.success('Report settings saved!');
      handleCloseReportSettings();
    } catch (error) {
      console.error("Failed to save report settings:", error);
      setReportSettingsError(error.message || "Failed to save settings. Please try again.");
    } finally {
      setReportSettingsLoading(false);
    }
  }, [customer, updateCustomer, handleCloseReportSettings]);

  // Handle opening the send report dialog
  const handleOpenSendReport = useCallback((log) => {
    setSelectedLogForReport(log);
    setSendReportError(null);
    setCustomNote(''); // Reset custom note when opening dialog
    setSendReportDialogOpen(true);
  }, []);

  // Handle custom note change - Requirements: 2.1, 2.5
  const handleCustomNoteChange = useCallback((note) => {
    setCustomNote(note);
  }, []);

  /**
   * Determine pool status from service log readings
   * Returns 'good' if all readings are normal, 'needs_attention' if any issues
   * Requirements: 2.1, 4.1, 4.2
   */
  const getPoolStatus = useCallback((log) => {
    if (!log) return 'good';

    const readings = [
      log.ph,
      log.chlorine,
      log.alkalinity,
      log.stabilizer
    ];

    // Check if any reading indicates an issue
    const hasIssue = readings.some(r =>
      r === "low" || r === "high" || r === "critical"
    );

    return hasIssue ? 'needs_attention' : 'good';
  }, []);

  // Handle closing the send report dialog
  const handleCloseSendReport = useCallback(() => {
    setSendReportDialogOpen(false);
    setSelectedLogForReport(null);
    setSendReportError(null);
    setCustomNote(''); // Clear custom note state on cancel - Requirements: 4.5
  }, []);

  // Handle confirming the send report
  const handleConfirmSendReport = useCallback(async (deliveryMethod, customNoteParam) => {
    if (!selectedLogForReport || !customer) return;

    setSendReportLoading(true);
    setSendReportError(null);

    // Validate and sanitize custom note
    const customNote = typeof customNoteParam === 'string' ? customNoteParam.trim() : '';
    if (customNote.length > 500) {
      setSendReportError("Custom note is too long. Please keep it under 500 characters.");
      setSendReportLoading(false);
      return;
    }

    try {
      // Check if customer has required contact method
      if (deliveryMethod === 'sms' && !customer.phone) {
        setSendReportError("No phone number on file. Please add a phone number to send SMS reports.");
        setSendReportLoading(false);
        return;
      }

      if (deliveryMethod === 'email' && !customer.email) {
        setSendReportError("No email address on file. Please add an email address to send email reports.");
        setSendReportLoading(false);
        return;
      }

      // Ensure customer record is synced before sending (Requirement 4.3)
      // This is crucial if the email was just added locally
      if (deliveryMethod === 'email' || deliveryMethod === 'sms') {
        try {
          console.log(`Ensuring customer ${customer._id} is up-to-date in cloud before sending report...`);
          await syncService.syncRecord('customers', customer._id);
        } catch (syncError) {
          console.warn("Non-critical sync warning for customer:", syncError);
          // We continue anyway, as the backend might already have the data
          // or the record might already be syncing
        }
      }

      // Check if Convex is available (online mode required)
      console.log("Environment check:", {
        VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
        VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
        isConvexAvailable
      });

      if (!isConvexAvailable) {
        setSendReportError(`${deliveryMethod === 'sms' ? 'SMS' : 'Email'} reports require online mode with Convex. Please configure VITE_CONVEX_URL and VITE_CLERK_PUBLISHABLE_KEY environment variables.`);
        setSendReportLoading(false);
        return;
      }

      // Check if the service log has a Convex ID (required for sending reports)
      let serviceLogId = selectedLogForReport.convex_id;

      if (!serviceLogId) {
        // Try to sync the service log first (Requirements: 4.3 - Auto-sync before sending report)
        try {
          console.log("Service log missing convex_id, attempting sync for log ID:", selectedLogForReport._id || selectedLogForReport.id);
          toast.info("Syncing service log to cloud...");
          const logId = selectedLogForReport._id || selectedLogForReport.id;
          const syncResult = await syncService.syncRecord('serviceLogs', logId);

          console.log("Sync result:", syncResult);

          if (syncResult.success) {
            // Fetch the updated record directly from the database to get the convex_id
            // The logs array from the hook might not have updated yet in this render cycle
            const { db } = await import('@/db/chemcheck-db');
            const updatedLog = await db.serviceLogs.get(logId);
            serviceLogId = updatedLog?.convex_id;

            console.log("Service log ID after sync:", serviceLogId);

            if (!serviceLogId) {
              setSendReportError("Service log synced but ID not yet available. Please try again in a moment.");
              setSendReportLoading(false);
              return;
            }

            toast.success("Service log synced successfully!");
          } else {
            console.error("Sync failed:", syncResult);
            setSendReportError(syncResult.error || "Failed to sync service log. Please ensure you're online and try again.");
            setSendReportLoading(false);
            return;
          }
        } catch (syncError) {
          console.error("Sync error:", syncError);
          setSendReportError("Failed to sync service log. Please ensure you're online and try again.");
          setSendReportLoading(false);
          return;
        }
      }

      // Determine pool status for the email
      const poolStatus = getPoolStatus(selectedLogForReport);

      // Call the Convex action to send the report
      console.log("Calling sendReportAction with:", {
        service_log_id: serviceLogId,
        delivery_method: deliveryMethod,
        pool_status: poolStatus,
        custom_note: customNote,
      });

      const result = await sendReportAction({
        service_log_id: serviceLogId,
        delivery_method: deliveryMethod,
        pool_status: poolStatus,
        custom_note: customNote,
      });

      if (result.success) {
        toast.success(`Report sent successfully via ${deliveryMethod === 'sms' ? 'SMS' : 'email'}!`);

        // Update report status
        setReportStatuses(prev => ({
          ...prev,
          [selectedLogForReport._id]: {
            sentAt: Date.now(),
            method: deliveryMethod,
            reportToken: result.report_token,
          }
        }));

        // Clear custom note after successful send
        setCustomNote('');
        handleCloseSendReport();
      } else {
        console.error("Send report failed:", result);
        setSendReportError(result.error || "Failed to send report. Please try again.");
      }

    } catch (error) {
      console.error("Failed to send report:", error);
      setSendReportError(error.message || "Failed to send report. Please try again.");
    } finally {
      setSendReportLoading(false);
    }
  }, [selectedLogForReport, customer, sendReportAction, handleCloseSendReport, getPoolStatus]);

  // Generate SMS message preview
  const getMessagePreview = useCallback(() => {
    if (!selectedLogForReport || !customer) return "";

    const businessName = "Dominick Pool Solutions"; // TODO: Get from business settings
    const serviceDate = formatServiceDate(selectedLogForReport.service_date);

    // Use the getPoolStatus function for consistency
    const overallStatus = getPoolStatus(selectedLogForReport);

    // Generate a placeholder report link
    const reportLink = buildReportUrl(
      window.location.origin,
      "preview-token"
    );

    return formatSmsMessage(businessName, serviceDate, overallStatus, reportLink);
  }, [selectedLogForReport, customer, getPoolStatus]);

  if (loading) {
    return <CustomerDetailSkeleton />;
  }

  if (!customer) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-900">Customer not found</p>
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
            <div className="flex items-start gap-1.5 text-slate-900 mb-2">
              <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
              <p className="text-xs leading-relaxed">{customer.address}</p>
            </div>
          </div>
          <div className="flex gap-2 ml-2">
            {logs && logs.length >= 3 && (
              <Button
                size="sm"
                onClick={() => setShowAnalysis(true)}
                variant="outline"
                className="border-2 border-purple-200 text-purple-700 hover:bg-purple-50 h-8"
              >
                <BarChart3 className="w-3.5 h-3.5 mr-1" />
                Analysis
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleOpenReportSettings}
              variant="outline"
              className="border-2 border-slate-200 text-slate-700 hover:bg-slate-50 h-8"
              title="Customize what customers see on reports"
            >
              <Settings className="w-3.5 h-3.5 mr-1" />
              Report Settings
            </Button>
            <Button
              size="sm"
              onClick={() => navigate(createPageUrl("NewServiceLog") + `?customerId=${customer._id}`)}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg h-8"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Log
            </Button>
          </div>
        </div>

        {(customer.phone || customer.email) && (
          <div className="space-y-1.5 mb-3">
            {customer.phone && (
              <div className="flex items-center gap-1.5 text-xs text-slate-900">
                <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-1.5 text-xs text-slate-900">
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
              ({formatServiceDate(lastWeekLog.service_date)})
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
          <p className="text-xs text-slate-900 mb-3">Start tracking services</p>
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
              onSendReport={() => handleOpenSendReport(log)}
              reportStatus={reportStatuses[log._id]}
            />
          ))}
        </div>
      )}
      {showAnalysis && (
        <PoolAnalysisPanel
          customer={customer}
          serviceLogs={logs || []}
          onClose={() => setShowAnalysis(false)}
        />
      )}

      {/* Report Settings Dialog */}
      <ReportSettingsPanel
        isOpen={reportSettingsOpen}
        onClose={handleCloseReportSettings}
        onSave={handleSaveReportSettings}
        currentSettings={customer?.report_settings}
        customerName={customer?.full_name || 'Customer'}
        isLoading={reportSettingsLoading}
        error={reportSettingsError}
      />

      {/* Send Report Dialog - Requirements: 2.1, 2.2, 2.5, 4.1, 4.2, 4.5 */}
      <SendReportDialog
        isOpen={sendReportDialogOpen}
        onClose={handleCloseSendReport}
        onConfirm={handleConfirmSendReport}
        customerPhone={customer?.phone}
        customerEmail={customer?.email}
        customerName={customer?.full_name}
        serviceDate={selectedLogForReport ? formatServiceDate(selectedLogForReport.service_date) : undefined}
        messagePreview={getMessagePreview()}
        isLoading={sendReportLoading}
        error={sendReportError}
        isResend={selectedLogForReport && reportStatuses[selectedLogForReport._id]?.sentAt}
        poolStatus={getPoolStatus(selectedLogForReport)}
        customNote={customNote}
        onCustomNoteChange={handleCustomNoteChange}
      />
    </div>
  );
}