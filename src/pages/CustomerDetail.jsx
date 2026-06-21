import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useCustomers, useServiceLogsByCustomer, useServiceLogDelete, useCustomerUpdate } from "@/api/convexHooks";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl, formatServiceDate, parseLocalDate } from "@/utils";
import { MapPin, Phone, Mail, Droplets, Plus, Calendar, FileText, BarChart3, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BackButton } from "@/components/navigation/BackButton";
import ServiceLogCard from "../components/servicelog/ServiceLogCard";
import PoolAnalysisPanel from "@/components/PoolAnalysisPanel";
import { SendReportDialog } from "@/components/service-reports";
import { ReportSettingsPanel } from "@/components/service-reports/ReportSettingsPanel";
import { formatSmsMessage, buildReportUrl } from "@/lib/smsReport";
import { syncPhotosForServiceLog, getPhotos } from "@/lib/proof-of-service";
import {
  addToReportQueue,
  getReportQueue,
  removeFromReportQueue,
  updateReportQueueItem,
  MAX_REPORT_SEND_RETRIES,
} from "@/lib/reportQueue";
import { toast } from "sonner";
import { subWeeks, startOfWeek, endOfWeek } from "date-fns";
import { useAction, useConvex, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { syncService } from "@/lib/sync/SyncService";
import { CustomerDetailSkeleton } from "@/components/ui/skeleton";
import { userManager } from "@/lib/userManager";
import { getEmailDeliveryValidationError } from "@/lib/emailValidation";

const isConvexAvailable = !!(import.meta.env.VITE_CONVEX_URL && import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function toFriendlySendError(error) {
  const raw = typeof error === "string" ? error : error?.message || "";
  if (!raw) return "Failed to send report. Please try again.";

  const normalized = raw.toLowerCase();
  if (normalized.includes("unauthenticated")) return "You're signed out. Please log in again and resend.";
  if (normalized.includes("access denied")) return "You don't have permission to send this report.";
  if (normalized.includes("service log not found")) return "This service visit is missing from cloud sync. Please sync and try again.";
  if (normalized.includes("app_url")) return "Email system is not fully configured yet. Please set APP_URL before sending.";
  if (normalized.includes("network") || normalized.includes("fetch")) return "Network issue while sending. Check connection and try again.";
  return raw;
}

function isNetworkError(error) {
  if (!navigator.onLine) return true;
  if (error && error.name === 'TypeError') return true;
  const message = typeof error === "string" ? error : error?.message || "";
  const normalized = message.toLowerCase();
  return normalized.includes("network") || normalized.includes("fetch") || normalized.includes("failed to fetch");
}

export default function CustomerDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  // Parse URL params once per URL change, not on every render
  const customerId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("id");
    return raw ? parseInt(raw, 10) : null;
  }, [window.location.search]);

  const navigationCustomer = location.state?.customer;
  const navigationLastWeekLog = location.state?.lastWeekLog;

  const customers = useCustomers();
  const logs = useServiceLogsByCustomer(customerId);
  const deleteServiceLog = useServiceLogDelete();
  const updateCustomer = useCustomerUpdate();

  const convex = useConvex();
  const sendReportAction = useAction(api.serviceReports.sendReport);
  const convexBusiness = useQuery(api.businesses.getCurrent);

  const [lastWeekLog, setLastWeekLog] = useState(navigationLastWeekLog || null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const [reportSettingsOpen, setReportSettingsOpen] = useState(false);
  const [reportSettingsLoading, setReportSettingsLoading] = useState(false);
  const [reportSettingsError, setReportSettingsError] = useState(null);

  const [sendReportDialogOpen, setSendReportDialogOpen] = useState(false);
  const [selectedLogForReport, setSelectedLogForReport] = useState(null);
  const [sendReportLoading, setSendReportLoading] = useState(false);
  const [sendReportError, setSendReportError] = useState(null);
  const [reportStatuses, setReportStatuses] = useState({});
  const [customNote, setCustomNote] = useState('');
  const [attachedPhotosPreview, setAttachedPhotosPreview] = useState([]);

  const processingQueueRef = useRef(false);
  const processQueueRef = useRef(null);

  const customer = useMemo(() => {
    if (!customers || !customerId) return navigationCustomer || null;
    return customers.find((c) => c._id === customerId) || navigationCustomer || null;
  }, [customers, customerId, navigationCustomer]);
  // Derive loading from whether we have a customer record yet.
  // (Previously a useEffect flipped this, which created a render-pause flicker.)
  const loading = !customer;
  const businessName = useMemo(() => {
    const convexName = convexBusiness?.name?.trim();
    if (convexName) return convexName;

    const localBusinessName = userManager.getCurrentBusiness()?.name?.trim();
    if (localBusinessName) return localBusinessName;

    return "ChemCheck Pool Service";
  }, [convexBusiness?.name]);

  useEffect(() => {
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

  useEffect(() => {
    let isMounted = true;

    const loadAttachedPhotosPreview = async () => {
      if (!selectedLogForReport) {
        if (isMounted) setAttachedPhotosPreview([]);
        return;
      }

      try {
        const localLogId = selectedLogForReport._id || selectedLogForReport.id;
        const convexLogId = selectedLogForReport.convex_id;
        const localCustomerId = customer?._id || customer?.id;

        if (!localLogId || !localCustomerId) {
          if (isMounted) setAttachedPhotosPreview([]);
          return;
        }

        const allCustomerPhotos = await getPhotos(String(localCustomerId));
        const acceptableLogIds = new Set([
          String(localLogId),
          convexLogId ? String(convexLogId) : null,
        ].filter(Boolean));

        const localPhotos = allCustomerPhotos.filter((photo) => (
          photo.serviceLogId !== null && acceptableLogIds.has(String(photo.serviceLogId))
        ));

        if (!isMounted) return;

        setAttachedPhotosPreview(
          localPhotos
            .filter((photo) => Boolean(photo.dataUrl))
            .map((photo) => ({
              id: photo.id,
              category: photo.category,
              url: photo.dataUrl,
              timestamp: photo.timestamp,
            }))
        );
      } catch (error) {
        console.warn("Failed to load local photo preview for report send:", error);
        if (isMounted) setAttachedPhotosPreview([]);
      }
    };

    loadAttachedPhotosPreview();
    return () => {
      isMounted = false;
    };
  }, [selectedLogForReport, customer]);

  // Load any queued/failed report sends from localStorage and replay them when
  // the device comes back online.
  useEffect(() => {
    const queue = getReportQueue();
    if (queue.length > 0) {
      const restoredStatuses = {};
      queue.forEach((item) => {
        const logId = String(item.localServiceLogId);
        const isFailed = item.status === 'failed' || (item.retryCount || 0) >= MAX_REPORT_SEND_RETRIES;
        restoredStatuses[logId] = {
          status: isFailed ? 'failed' : 'queued',
          retryCount: item.retryCount || 0,
          method: item.deliveryMethod,
          queuedAt: item.timestamp,
        };
      });
      setReportStatuses((prev) => ({ ...prev, ...restoredStatuses }));
    }

    const handleOnline = () => {
      processQueueRef.current?.();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  const handleDeleteLog = async (logId) => {
    await deleteServiceLog(logId);
  };

  const handleOpenReportSettings = useCallback(() => {
    setReportSettingsError(null);
    setReportSettingsOpen(true);
  }, []);

  const handleCloseReportSettings = useCallback(() => {
    setReportSettingsOpen(false);
    setReportSettingsError(null);
  }, []);

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

  const handleOpenSendReport = useCallback((log) => {
    setSelectedLogForReport(log);
    setSendReportError(null);
    setCustomNote('');
    setSendReportDialogOpen(true);
  }, []);

  const handleCustomNoteChange = useCallback((note) => {
    setCustomNote(note);
  }, []);

  const getPoolStatus = useCallback((log) => {
    if (!log) return 'good';

    const readings = [
      log.ph,
      log.chlorine,
      log.alkalinity,
      log.stabilizer
    ];

    const hasIssue = readings.some(r =>
      r === "low" || r === "high" || r === "critical"
    );

    return hasIssue ? 'needs_attention' : 'good';
  }, []);

  const handleCloseSendReport = useCallback(() => {
    setSendReportDialogOpen(false);
    setSelectedLogForReport(null);
    setSendReportError(null);
    setCustomNote('');
    setAttachedPhotosPreview([]);
  }, []);

  const sendReportForLog = useCallback(async (customerArg, logArg, deliveryMethod, customNote) => {
    try {
      if (deliveryMethod === 'sms' && !customerArg.phone) {
        return { success: false, error: "No phone number on file. Please add a phone number to send SMS reports." };
      }

      if (deliveryMethod === 'email') {
        const emailError = getEmailDeliveryValidationError(customerArg.email);
        if (emailError) {
          return { success: false, error: emailError };
        }
      }

      if (deliveryMethod === 'email' || deliveryMethod === 'sms') {
        let customerSyncProblem = null;
        try {
          console.log(`Ensuring customer ${customerArg._id} is up-to-date in cloud before sending report...`);
          const customerSync = await syncService.syncRecord('customers', customerArg._id || customerArg.id);
          if (!customerSync.success) {
            customerSyncProblem = customerSync.error || "Customer contact info failed to sync.";
          }
        } catch (syncError) {
          console.error("Customer sync failed before sending report:", syncError);
          customerSyncProblem = "Customer info couldn't sync to cloud.";
        }

        if (customerSyncProblem) {
          if (deliveryMethod === 'email') {
            console.warn("Continuing email send with recipient override after customer sync issue:", customerSyncProblem);
            toast.warning("Customer cloud sync is delayed. Sending with the current email anyway.");
          } else {
            return { success: false, error: `${customerSyncProblem} Please check your connection and retry.` };
          }
        }
      }

      console.log("Environment check:", {
        VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
        VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
        isConvexAvailable
      });

      if (!isConvexAvailable) {
        return { success: false, error: `${deliveryMethod === 'sms' ? 'SMS' : 'Email'} reports require online mode with Convex. Please configure VITE_CONVEX_URL and VITE_CLERK_PUBLISHABLE_KEY environment variables.` };
      }

      let serviceLogId = logArg.convex_id;

      if (!serviceLogId) {
        try {
          console.log("Service log missing convex_id, attempting sync for log ID:", logArg._id || logArg.id);
          toast.info("Syncing service log to cloud...");
          const logId = logArg._id || logArg.id;
          const syncResult = await syncService.syncRecord('serviceLogs', logId);

          console.log("Sync result:", syncResult);

          if (syncResult.success) {
            const { db } = await import('@/db/chemcheck-db');
            const updatedLog = await db.serviceLogs.get(logId);
            serviceLogId = updatedLog?.convex_id;

            console.log("Service log ID after sync:", serviceLogId);

            if (!serviceLogId) {
              return { success: false, error: "Service log synced but ID not yet available. Please try again in a moment." };
            }

            toast.success("Service log synced successfully!");
          } else {
            console.error("Sync failed:", syncResult);
            return { success: false, error: syncResult.error || "Failed to sync service log. Please ensure you're online and try again." };
          }
        } catch (syncError) {
          console.error("Sync error:", syncError);
          return { success: false, error: "Failed to sync service log. Please ensure you're online and try again." };
        }
      }

      const localLogId = logArg._id || logArg.id;
      const localCustomerId = customerArg._id || customerArg.id;
      let customerConvexId = customerArg.convex_id;

      try {
        if (!customerConvexId && localCustomerId) {
          const { db } = await import('@/db/chemcheck-db');
          const updatedCustomer = await db.customers.get(localCustomerId);
          customerConvexId = updatedCustomer?.convex_id;
        }

        if (!customerConvexId) {
          if (deliveryMethod === 'email') {
            toast.warning("Customer sync is still catching up, so new photos may be missing from this email.");
          } else {
            return { success: false, error: "Customer sync is incomplete, so report photos can't be attached yet. Please try again in a moment." };
          }
        } else {
          const photoSyncResults = await syncPhotosForServiceLog({
            localServiceLogId: String(localLogId),
            localCustomerId: String(localCustomerId),
            convexServiceLogId: String(serviceLogId),
            convexCustomerId: String(customerConvexId),
            convexClient: {
              mutation: async (name, args = {}) => {
                if (name === 'servicePhotos:generateUploadUrl') {
                  return convex.mutation(api.servicePhotos.generateUploadUrl, {});
                }
                if (name === 'servicePhotos:uploadPhoto') {
                  return convex.mutation(api.servicePhotos.uploadPhoto, args);
                }
                throw new Error(`Unsupported photo sync mutation: ${name}`);
              },
            },
          });

          const failedPhotoSyncs = photoSyncResults.filter((result) => !result.success);
          if (failedPhotoSyncs.length > 0) {
            if (deliveryMethod === 'email') {
              toast.warning("Some photos couldn't sync in time. This email may show fewer photos.");
            } else {
              return { success: false, error: "Some service photos failed to sync. Please retry so photos are included in the customer report." };
            }
          }

          if (photoSyncResults.length > 0 && failedPhotoSyncs.length === 0) {
            toast.success(`Synced ${photoSyncResults.length} photo${photoSyncResults.length === 1 ? '' : 's'} for this report.`);
          }
        }
      } catch (photoSyncError) {
        console.error("Photo sync error before report send:", photoSyncError);
        if (deliveryMethod === 'email') {
          toast.warning("Couldn't sync all photos before sending. We'll still send the report.");
        } else {
          return { success: false, error: "Couldn't attach service photos yet. Please check your connection and try again." };
        }
      }

      const poolStatus = getPoolStatus(logArg);

      console.log("Calling sendReportAction with:", {
        service_log_id: serviceLogId,
        delivery_method: deliveryMethod,
        pool_status: poolStatus,
        custom_note: customNote,
        report_base_url: window.location.origin,
      });

      const result = await sendReportAction({
        service_log_id: serviceLogId,
        delivery_method: deliveryMethod,
        pool_status: poolStatus,
        custom_note: customNote,
        recipient_email: deliveryMethod === 'email' ? customerArg.email?.trim() : undefined,
        report_base_url: window.location.origin,
      });

      if (result.success) {
        if (result.was_duplicate) {
          toast.info("This report was already sent less than a minute ago. No duplicate email was sent.");
        } else {
          const destination = deliveryMethod === 'email' ? customerArg.email : customerArg.phone;
          toast.success(`Report sent via ${deliveryMethod === 'sms' ? 'SMS' : 'email'} to ${destination}.`);
        }

        console.log("Report send result:", {
          deliveryMethod,
          recipient: deliveryMethod === 'email' ? customerArg.email : customerArg.phone,
          messageId: result.message_id,
          wasDuplicate: result.was_duplicate,
          reportToken: result.report_token,
        });

        return { success: true, result, deliveryMethod };
      } else {
        console.error("Send report failed:", result);
        return { success: false, error: toFriendlySendError(result.error), rawError: result.error };
      }
    } catch (error) {
      console.error("Failed to send report:", error);
      return { success: false, error: toFriendlySendError(error), rawError: error };
    }
  }, [convex, sendReportAction, getPoolStatus]);

  const processQueue = useCallback(async () => {
    if (processingQueueRef.current || !navigator.onLine || !isConvexAvailable) return;

    const queue = getReportQueue();
    const pending = queue.filter((item) =>
      (item.retryCount || 0) < MAX_REPORT_SEND_RETRIES && item.status !== 'failed'
    );
    if (pending.length === 0) return;

    processingQueueRef.current = true;

    for (const item of pending) {
      const logId = String(item.localServiceLogId);
      const customerId = String(item.localCustomerId);

      setReportStatuses((prev) => ({
        ...prev,
        [logId]: { status: 'sending', method: item.deliveryMethod },
      }));

      let log = logs?.find((l) => String(l._id || l.id) === logId);
      let cust = customer?._id && String(customer._id || customer.id) === customerId
        ? customer
        : customers?.find((c) => String(c._id || c.id) === customerId);

      if (!log || !cust) {
        try {
          const { db } = await import('@/db/chemcheck-db');
          if (!log) log = await db.serviceLogs.get(Number(item.localServiceLogId));
          if (!cust) cust = await db.customers.get(Number(item.localCustomerId));
        } catch (dbError) {
          console.warn("Failed to load queued report records from local DB:", dbError);
        }
      }

      if (!log || !cust) {
        console.warn("Cannot replay queued report: log or customer missing", item);
        removeFromReportQueue(item.id);
        setReportStatuses((prev) => ({
          ...prev,
          [logId]: { status: 'failed', retryCount: MAX_REPORT_SEND_RETRIES },
        }));
        continue;
      }

      const result = await sendReportForLog(cust, log, item.deliveryMethod, item.customNote || '');

      if (result.success) {
        removeFromReportQueue(item.id);
        setReportStatuses((prev) => ({
          ...prev,
          [logId]: {
            status: 'sent',
            sentAt: Date.now(),
            method: item.deliveryMethod,
            reportToken: result.result.report_token,
          },
        }));
        toast.success(`Queued report sent via ${item.deliveryMethod === 'sms' ? 'SMS' : 'email'}.`);
      } else {
        const nextRetry = (item.retryCount || 0) + 1;
        const failed = nextRetry >= MAX_REPORT_SEND_RETRIES;
        updateReportQueueItem(item.id, {
          retryCount: nextRetry,
          status: failed ? 'failed' : 'queued',
          lastError: result.error,
        });
        setReportStatuses((prev) => ({
          ...prev,
          [logId]: {
            status: failed ? 'failed' : 'queued',
            retryCount: nextRetry,
            method: item.deliveryMethod,
          },
        }));
        if (failed) {
          toast.error(`Report could not be sent after ${MAX_REPORT_SEND_RETRIES} attempts. Tap Retry to try again.`);
        }
      }
    }

    processingQueueRef.current = false;
  }, [logs, customers, customer, sendReportForLog]);

  useEffect(() => {
    processQueueRef.current = processQueue;
    if (navigator.onLine) {
      processQueue();
    }
  }, [processQueue]);

  const handleConfirmSendReport = useCallback(async (deliveryMethod, customNoteParam) => {
    if (!selectedLogForReport || !customer) return;

    setSendReportLoading(true);
    setSendReportError(null);

    const customNote = typeof customNoteParam === 'string' ? customNoteParam.trim() : '';
    if (customNote.length > 500) {
      setSendReportError("Custom note is too long. Please keep it under 500 characters.");
      setSendReportLoading(false);
      return;
    }

    if (deliveryMethod === 'sms' && !customer.phone) {
      setSendReportError("No phone number on file. Please add a phone number to send SMS reports.");
      setSendReportLoading(false);
      return;
    }

    if (deliveryMethod === 'email') {
      const emailError = getEmailDeliveryValidationError(customer.email);
      if (emailError) {
        setSendReportError(emailError);
        setSendReportLoading(false);
        return;
      }
    }

    const localLogId = selectedLogForReport._id || selectedLogForReport.id;
    const localCustomerId = customer._id || customer.id;

    if (!navigator.onLine) {
      addToReportQueue({
        localCustomerId,
        localServiceLogId: localLogId,
        deliveryMethod,
        customNote,
        customerEmail: customer.email,
        customerPhone: customer.phone,
      });
      setReportStatuses((prev) => ({
        ...prev,
        [String(localLogId)]: {
          status: 'queued',
          retryCount: 0,
          method: deliveryMethod,
          queuedAt: Date.now(),
        },
      }));
      toast.info("You appear offline. This report has been queued and will send when connectivity returns.");
      handleCloseSendReport();
      setSendReportLoading(false);
      return;
    }

    const result = await sendReportForLog(customer, selectedLogForReport, deliveryMethod, customNote);

    if (result.success) {
      setReportStatuses((prev) => ({
        ...prev,
        [String(localLogId)]: {
          status: 'sent',
          sentAt: Date.now(),
          method: deliveryMethod,
          reportToken: result.result.report_token,
        },
      }));
      // If a queued send for this log existed, clear it so it doesn't duplicate.
      getReportQueue()
        .filter((item) => String(item.localServiceLogId) === String(localLogId))
        .forEach((item) => removeFromReportQueue(item.id));
      setCustomNote('');
      handleCloseSendReport();
    } else if (isNetworkError(result.rawError)) {
      addToReportQueue({
        localCustomerId,
        localServiceLogId: localLogId,
        deliveryMethod,
        customNote,
        customerEmail: customer.email,
        customerPhone: customer.phone,
      });
      setReportStatuses((prev) => ({
        ...prev,
        [String(localLogId)]: {
          status: 'queued',
          retryCount: 0,
          method: deliveryMethod,
          queuedAt: Date.now(),
        },
      }));
      toast.info("Send failed due to a network issue. Report queued and will retry when connectivity returns.");
      handleCloseSendReport();
    } else {
      setSendReportError(result.error);
    }

    setSendReportLoading(false);
  }, [selectedLogForReport, customer, sendReportForLog, handleCloseSendReport]);

  const handleRetryReport = useCallback((log) => {
    const localLogId = log._id || log.id;
    const queue = getReportQueue();
    const item = queue.find((i) => String(i.localServiceLogId) === String(localLogId));

    if (!item) {
      handleOpenSendReport(log);
      return;
    }

    updateReportQueueItem(item.id, { retryCount: 0, status: 'queued' });
    setReportStatuses((prev) => ({
      ...prev,
      [String(localLogId)]: {
        status: 'queued',
        retryCount: 0,
        method: item.deliveryMethod,
        queuedAt: item.timestamp,
      },
    }));

    if (navigator.onLine) {
      processQueueRef.current?.();
    } else {
      toast.info("You are offline. Report re-queued and will send when connectivity returns.");
    }
  }, [handleOpenSendReport]);

  const getMessagePreview = useCallback(() => {
    if (!selectedLogForReport || !customer) return "";

    const serviceDate = formatServiceDate(selectedLogForReport.service_date);

    const overallStatus = getPoolStatus(selectedLogForReport);
    const selectedLogId = selectedLogForReport._id || selectedLogForReport.id;
    const reportToken = selectedLogId ? reportStatuses[selectedLogId]?.reportToken : undefined;
    const reportLink = reportToken ? buildReportUrl(window.location.origin, reportToken) : undefined;

    return formatSmsMessage(businessName, serviceDate, overallStatus, reportLink);
  }, [selectedLogForReport, customer, getPoolStatus, businessName, reportStatuses]);

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
      <BackButton
        fallback={createPageUrl("Clients")}
        label="Back"
        size="sm"
        className="mb-3 -ml-2"
      />

      <Card className="p-4 mb-3 border-2 shadow-lg">
        <div className="mb-3">
          <h2 className="text-lg font-bold text-slate-900 mb-1">
            {customer.full_name}
          </h2>
          <div className="flex items-start gap-1.5 text-slate-900">
            <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
            <p className="text-xs leading-relaxed">{customer.address}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
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
              onRetryReport={() => handleRetryReport(log)}
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

      <ReportSettingsPanel
        isOpen={reportSettingsOpen}
        onClose={handleCloseReportSettings}
        onSave={handleSaveReportSettings}
        currentSettings={customer?.report_settings}
        customerName={customer?.full_name || 'Customer'}
        isLoading={reportSettingsLoading}
        error={reportSettingsError}
      />

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
        isResend={selectedLogForReport && reportStatuses[selectedLogForReport._id || selectedLogForReport.id]?.sentAt}
        poolStatus={getPoolStatus(selectedLogForReport)}
        customNote={customNote}
        onCustomNoteChange={handleCustomNoteChange}
        attachedPhotos={attachedPhotosPreview}
      />
    </div>
  );
}
