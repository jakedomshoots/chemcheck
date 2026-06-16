import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, FileText, CheckCircle2, AlertTriangle, AlertCircle, XCircle, ChevronDown, Trash2, Lock, Camera, Send, CheckCheck, Loader2, RefreshCw } from "lucide-react";
import { formatServiceDateFull } from "@/utils";
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
import { ServicePhotoGallery } from "@/components/service-reports";
import { SyncStatusBadge } from "@/components/sync/SyncStatusIndicator";
import { useRecordSyncStatus } from "@/hooks/useSyncState";
import { getPhotosByServiceLog } from "@/lib/proof-of-service";

const levelConfig = {
  low: { icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50/80", border: "border-yellow-200" },
  good: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50/80", border: "border-emerald-200" },
  high: { icon: AlertCircle, color: "text-orange-600", bg: "bg-orange-50/80", border: "border-orange-200" },
  critical: { icon: XCircle, color: "text-red-600", bg: "bg-red-50/80", border: "border-red-200" }
};

/**
 * Helper function to calculate photo counts from an array of photos
 * Exported for testing purposes
 * 
 * @param {Array} photos - Array of photo objects with category property
 * @returns {{ before: number, after: number, total: number }}
 */
export function calculatePhotoCounts(photos) {
  if (!Array.isArray(photos)) {
    return { before: 0, after: 0, total: 0 };
  }
  
  const before = photos.filter(p => p.category === 'before').length;
  const after = photos.filter(p => p.category === 'after').length;
  
  return {
    before,
    after,
    total: photos.length,
  };
}

/**
 * Helper function to format the report sent date
 * Exported for testing purposes
 * 
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted date string
 */
export function formatReportSentDate(timestamp) {
  if (!timestamp || typeof timestamp !== 'number') {
    return '';
  }
  
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    return '';
  }
  
  const now = new Date();
  const options = { 
    month: 'short', 
    day: 'numeric',
  };
  
  // Include year if not current year
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }
  
  return date.toLocaleDateString('en-US', options);
}

/**
 * ServiceLogCard Component
 * 
 * Displays a service log entry with chemical readings, notes, photos, and report status.
 * 
 * Requirements:
 * - 1.1: Display photo indicator showing count of before/after photos
 * - 1.2: Display PhotoGallery when card is expanded
 * - 1.5: Hide photo indicator when no photos exist
 * - 2.1: Provide "Send Report" button
 * - 5.1: Display "Report Sent" indicator with sent date
 * 
 * @param {Object} props
 * @param {Object} props.log - The service log data
 * @param {Function} props.onDelete - Callback when delete is confirmed
 * @param {Function} [props.onSendReport] - Callback when Send Report is clicked
 * @param {Function} [props.onRetryReport] - Callback when a failed report should be retried
 * @param {Object} [props.reportStatus] - Report status { status?: 'sent'|'queued'|'sending'|'failed', sentAt?: number, method?: string }
 */
export default function ServiceLogCard({ log, onDelete, onSendReport, onRetryReport, reportStatus }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [photoCounts, setPhotoCounts] = useState({ before: 0, after: 0, total: 0 });
  
  // Track if initial photo count has been fetched to prevent re-runs
  const countFetchedRef = useRef(false);

  // Get sync status for this service log
  const { syncStatus, loading: syncLoading, retry: retrySyncStatus } = useRecordSyncStatus('serviceLogs', log._id || log.id);

  // Lazy load photos only when card is expanded (performance optimization)
  useEffect(() => {
    // Only load photos when expanded - saves resources for collapsed cards
    if (!isExpanded) return;
    
    const loadPhotos = async () => {
      if (!log._id && !log.id) return;
      
      const serviceLogId = String(log._id || log.id);
      
      try {
        const fetchedPhotos = await getPhotosByServiceLog(serviceLogId);
        
        // Transform to ServicePhoto format expected by gallery
        const transformedPhotos = fetchedPhotos.map(photo => ({
          id: photo.id,
          url: photo.dataUrl,
          category: photo.category,
          timestamp: photo.timestamp,
        }));
        
        setPhotos(transformedPhotos);
        
        // Use the exported helper to calculate counts (eliminates duplication)
        setPhotoCounts(calculatePhotoCounts(transformedPhotos));
      } catch (error) {
        console.error('Failed to load photos:', error);
        setPhotos([]);
        setPhotoCounts({ before: 0, after: 0, total: 0 });
      }
    };

    loadPhotos();
  }, [log._id, log.id, isExpanded]);

  // Quick photo count check for indicator (runs once per card)
  // Note: This still fetches full photo data - a dedicated count API would be more efficient
  useEffect(() => {
    // Skip if we already have photos loaded or count was already fetched
    if (photos.length > 0 || countFetchedRef.current) return;
    
    const checkPhotoCount = async () => {
      if (!log._id && !log.id) return;
      
      const serviceLogId = String(log._id || log.id);
      
      try {
        const fetchedPhotos = await getPhotosByServiceLog(serviceLogId);
        setPhotoCounts(calculatePhotoCounts(fetchedPhotos));
        countFetchedRef.current = true;
      } catch (error) {
        // Silently fail - photo count is not critical
      }
    };

    checkPhotoCount();
  }, [log._id, log.id]);

  const readings = [
    { label: "pH", value: log.ph, type: "level" },
    { label: "Cl", value: log.chlorine, type: "level" },
    { label: "Alk", value: log.alkalinity, type: "level" },
    { label: "Stab", value: log.stabilizer, type: "level" },
    { label: "Salt", value: log.salt, type: "number", unit: "PPM" }
  ].filter(r => r.value);

  const getWorstStatus = () => {
    const levelStatuses = readings.filter(r => r.type === "level").map(r => r.value);
    if (levelStatuses.includes('critical')) return 'critical';
    if (levelStatuses.includes('high')) return 'high';
    if (levelStatuses.includes('low')) return 'low';
    return 'good';
  };

  const worstStatus = getWorstStatus();
  const summaryConfig = levelConfig[worstStatus];
  const SummaryIcon = summaryConfig.icon;

  const handleDelete = () => {
    setShowDeleteDialog(false);
    onDelete();
  };

  const handleSendReport = (e) => {
    e.stopPropagation();
    if (onSendReport) {
      onSendReport();
    }
  };

  const hasPhotos = photoCounts.total > 0;

  const reportStatusKey = reportStatus?.status;
  const isReportSent = reportStatusKey === 'sent' || (!reportStatusKey && reportStatus?.sentAt);
  const isReportQueued = reportStatusKey === 'queued';
  const isReportSending = reportStatusKey === 'sending';
  const isReportFailed = reportStatusKey === 'failed';

  const handleRetryReport = (e) => {
    e.stopPropagation();
    if (onRetryReport) {
      onRetryReport();
    } else if (onSendReport) {
      onSendReport();
    }
  };

  return (
    <>
      <Card className="overflow-hidden transition-all duration-200 border-2 hover:border-cyan-300 active:border-cyan-400 shadow-sm bg-white/60">
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-3 cursor-pointer flex items-center justify-between active:bg-slate-50/50"
        >
          <div className="flex items-center gap-2 flex-1">
            <div className={`p-1.5 ${summaryConfig.bg} rounded-lg`}>
              <Calendar className="w-3.5 h-3.5 text-cyan-600" />
            </div>
            <div>
              <span className="font-semibold text-sm text-slate-900">
                {formatServiceDateFull(log.service_date)}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <SummaryIcon className={`w-2.5 h-2.5 ${summaryConfig.color}`} />
                <span className={`text-[10px] font-medium ${summaryConfig.color}`}>
                  {readings.filter(r => r.type === "level").length} reading{readings.filter(r => r.type === "level").length !== 1 ? 's' : ''}
                </span>
                
                {/* Photo Indicator - Requirements: 1.1, 1.5 */}
                {hasPhotos && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-slate-500 ml-1">
                    <Camera className="w-2.5 h-2.5" />
                    <span data-testid="photo-count-indicator">
                      {photoCounts.before > 0 && photoCounts.after > 0 
                        ? `${photoCounts.before}/${photoCounts.after}`
                        : photoCounts.total
                      }
                    </span>
                  </span>
                )}

                {/* Report Status Indicators - Requirements: 5.1, Phase 2.5 */}
                {isReportSending && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-blue-600 ml-1" data-testid="report-sending-indicator">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    <span>Sending...</span>
                  </span>
                )}
                {isReportQueued && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-600 ml-1" data-testid="report-queued-indicator">
                    <AlertCircle className="w-2.5 h-2.5" />
                    <span>Queued</span>
                  </span>
                )}
                {isReportFailed && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-600 ml-1" data-testid="report-failed-indicator">
                    <XCircle className="w-2.5 h-2.5" />
                    <span>Failed</span>
                  </span>
                )}
                {isReportSent && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-green-600 ml-1" data-testid="report-sent-indicator">
                    <CheckCheck className="w-2.5 h-2.5" />
                    <span>Sent {formatReportSentDate(reportStatus.sentAt)}</span>
                  </span>
                )}

                {/* Sync Status Badge */}
                {!syncLoading && syncStatus && (
                  <div className="ml-1">
                    <SyncStatusBadge
                      status={syncStatus.status}
                      onRetry={syncStatus.status === 'error' ? retrySyncStatus : undefined}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteDialog(true);
              }}
              className="text-red-500 hover:text-red-700 hover:bg-red-50/50 h-8 w-8"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-slate-200/60">
            <div className="p-3 space-y-2 bg-slate-50/40">
              <div className="grid grid-cols-3 gap-1.5">
                {readings.map((reading) => {
                  if (reading.type === "number") {
                    return (
                      <div key={reading.label} className="bg-blue-50/60 border border-blue-200 rounded-lg p-2">
                        <div className="text-[10px] text-slate-600 font-medium mb-0.5">{reading.label}</div>
                        <div className="text-xs font-semibold text-blue-700">
                          {reading.value} {reading.unit}
                        </div>
                      </div>
                    );
                  }

                  const config = levelConfig[reading.value] || levelConfig.good;
                  const Icon = config.icon;
                  return (
                    <div key={reading.label} className={`${config.bg} ${config.border} border rounded-lg p-2`}>
                      <div className="flex items-center gap-0.5 mb-0.5">
                        <Icon className={`w-2.5 h-2.5 ${config.color}`} />
                        <div className="text-[10px] text-slate-600 font-medium">{reading.label}</div>
                      </div>
                      <div className={`text-xs font-semibold ${config.color} capitalize`}>
                        {reading.value}
                      </div>
                    </div>
                  );
                })}
              </div>

              {log.notes && (
                <div className="flex items-start gap-1.5 p-2.5 bg-amber-50/60 rounded-lg border border-amber-200">
                  <FileText className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-700 leading-relaxed">{log.notes}</p>
                </div>
              )}

              {log.gate_code && (
                <div className="flex items-start gap-1.5 p-2.5 bg-purple-50/60 rounded-lg border border-purple-200">
                  <Lock className="w-3.5 h-3.5 text-purple-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-700 leading-relaxed">Gate Code: <span className="font-semibold text-purple-700">{log.gate_code}</span></p>
                </div>
              )}

              {/* Photo Gallery - Requirements: 1.2 */}
              {hasPhotos && (
                <div className="mt-3 pt-3 border-t border-slate-200/60">
                  <ServicePhotoGallery photos={photos} />
                </div>
              )}

              {/* Send Report Button - Requirements: 2.1, Phase 2.5 retry */}
              {onSendReport && (
                <div className="mt-3 pt-3 border-t border-slate-200/60 flex justify-end">
                  <Button
                    variant={isReportSent ? "outline" : isReportFailed ? "outline" : "default"}
                    size="sm"
                    onClick={isReportFailed ? handleRetryReport : handleSendReport}
                    disabled={isReportSending}
                    className={isReportSent
                      ? "border-green-200 text-green-700 hover:bg-green-50"
                      : isReportFailed
                        ? "border-red-200 text-red-700 hover:bg-red-50"
                        : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white"
                    }
                  >
                    {isReportSending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        Sending...
                      </>
                    ) : isReportFailed ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        Retry Report
                      </>
                    ) : isReportSent ? (
                      <>
                        <Send className="w-3.5 h-3.5 mr-1.5" />
                        Resend Report
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5 mr-1.5" />
                        Send Report
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="max-w-[90%] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Delete Service Log?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              Delete log from {formatServiceDateFull(log.service_date)}? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white text-sm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
