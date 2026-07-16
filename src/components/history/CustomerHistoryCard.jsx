import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronRight, MapPin, FileText, CheckCircle2, AlertTriangle, AlertCircle, XCircle, Trash2, Calendar as CalendarIcon, Lock, BarChart3, Camera, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import PoolAnalysisPanel from "@/components/PoolAnalysisPanel";
import { format, parseISO } from "date-fns";
import { ServicePhotoGallery } from "@/components/service-reports";
import { getPhotosByServiceLog } from "@/lib/proof-of-service";
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

// Helper functions for date formatting
function formatServiceDate(dateString) {
  try {
    const date = parseISO(dateString);
    return format(date, "MMM d");
  } catch (e) {
    return dateString;
  }
}

function formatServiceDateFull(dateString) {
  try {
    const date = parseISO(dateString);
    return format(date, "MMM d, yyyy");
  } catch (e) {
    return dateString;
  }
}

const levelConfig = {
  low: { icon: AlertTriangle, color: "text-watch", bg: "bg-[var(--status-watch-soft)]", border: "border-[var(--status-watch-line)]", label: "Low" },
  good: { icon: CheckCircle2, color: "text-ok", bg: "bg-[var(--status-ok-soft)]", border: "border-[var(--status-ok-line)]", label: "Good" },
  high: { icon: AlertCircle, color: "text-action", bg: "bg-[var(--status-action-soft)]", border: "border-[var(--status-action-line)]", label: "High" },
  critical: { icon: XCircle, color: "text-critical", bg: "bg-[var(--status-critical-soft)]", border: "border-[var(--status-critical-line)]", label: "Critical" }
};

// Get overall status for a log entry
function getLogStatus(log) {
  const levels = [log.ph, log.chlorine, log.alkalinity, log.stabilizer].filter(Boolean);
  if (levels.includes('critical')) return 'critical';
  if (levels.includes('high')) return 'high';
  if (levels.includes('low')) return 'low';
  return 'good';
}

// Collapsible Log Entry Component
function LogEntry({ log, onDelete }) {
  // Debug log for service type visibility
  // console.log("[LogEntry] Rendering log:", log._id, "Service Type:", log.service_type);

  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [photosLoaded, setPhotosLoaded] = useState(false);

  const status = getLogStatus(log);
  const statusConfig = levelConfig[status];
  const StatusIcon = statusConfig.icon;

  // Use loaded photos count if available, otherwise fall back to database count
  const photoCount = photosLoaded ? photos.length : (log.photo_count || 0);
  const hasPhotos = photoCount > 0;

  // Load photos when component mounts (not just when expanded)
  React.useEffect(() => {
    if (photosLoaded) return;

    const abortController = new AbortController();

    const loadPhotos = async () => {
      if (!log._id && !log.id) return;

      const serviceLogId = String(log._id || log.id);
      console.log('[CustomerHistoryCard LogEntry] Loading photos for service log:', serviceLogId);

      try {
        const fetchedPhotos = await getPhotosByServiceLog(serviceLogId);

        // Check if request was aborted before updating state
        if (abortController.signal.aborted) {
          console.log('[CustomerHistoryCard LogEntry] Photo loading aborted');
          return;
        }

        console.log('[CustomerHistoryCard LogEntry] Fetched photos:', fetchedPhotos.length);

        // Transform to ServicePhoto format expected by gallery
        const transformedPhotos = fetchedPhotos.map(photo => ({
          id: photo.id,
          url: photo.dataUrl,
          category: photo.category,
          timestamp: photo.timestamp,
        }));

        console.log('[CustomerHistoryCard LogEntry] Transformed photos:', transformedPhotos.length);
        setPhotos(transformedPhotos);
        setPhotosLoaded(true);
      } catch (error) {
        // Don't log errors if the request was aborted
        if (!abortController.signal.aborted) {
          console.error('[CustomerHistoryCard LogEntry] Failed to load photos:', error);
          setPhotos([]);
          setPhotosLoaded(true);
        }
      }
    };

    loadPhotos();

    // Cleanup function to abort in-flight requests
    return () => {
      abortController.abort();
    };
  }, [photosLoaded, log._id, log.id]);

  const readings = [
    { label: "pH", value: log.ph, type: "level" },
    { label: "Cl", value: log.chlorine, type: "level" },
    { label: "Alk", value: log.alkalinity, type: "level" },
    { label: "Stab", value: log.stabilizer, type: "level" },
    { label: "Salt", value: log.salt, type: "number", unit: "PPM" }
  ].filter(r => r.value);

  return (
    <div className={`border-2 rounded-lg overflow-hidden transition-all ${isOpen ? 'border-[var(--status-info-line)]' : 'border-line'}`}>
      {/* Collapsed Header - Always Visible */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${isOpen ? 'bg-brand-softer' : 'bg-white hover:bg-surface-2'}`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-brand-ink flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-ink-muted flex-shrink-0" />
          )}

          <CalendarIcon className="w-4 h-4 text-brand-ink flex-shrink-0" />

          <span className="font-medium text-sm text-ink">
            {formatServiceDateFull(log.service_date)}
          </span>

          {/* Status Badge */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${statusConfig.bg} ${statusConfig.border} border`}>
            <StatusIcon className={`w-3 h-3 ${statusConfig.color}`} />
            <span className={`text-xs font-medium ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
          </div>

          {/* Service Type Badge */}
          {log.service_type && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--status-info-soft)] border border-[var(--status-info-line)]">
              <ClipboardList className="w-3 h-3 text-info" />
              <span className="text-xs font-medium text-info truncate max-w-[100px]">
                {log.service_type}
              </span>
            </div>
          )}
        </div>

        {/* Photo Indicator (when collapsed) */}
        {!isOpen && (
          <div className="flex items-center gap-2 mr-2">
            {/* Photo Count Indicator */}
            <div
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${hasPhotos
                ? 'bg-brand-softer text-brand-ink'
                : 'bg-surface-2 text-ink-muted'
                }`}
              title={hasPhotos ? `${photoCount} photo${photoCount !== 1 ? 's' : ''}` : 'No photos'}
            >
              <Camera className="w-3 h-3" />
              <span className="text-xs font-medium">{photoCount}</span>
            </div>

            {/* Chemical Status Dots */}
            {readings.slice(0, 3).map((reading) => {
              if (reading.type === "number") return null;
              const config = levelConfig[reading.value] || levelConfig.good;
              return (
                <div key={reading.label} className={`w-2 h-2 rounded-full ${config.color.replace('text-', 'bg-')}`} title={`${reading.label}: ${reading.value}`} />
              );
            })}
          </div>
        )}
      </div>

      {/* Expanded Content */}
      {isOpen && (
        <div className="p-3 pt-0 bg-white border-t border-line">
          {/* Photo Summary */}
          {hasPhotos && (
            <div className="flex items-center gap-3 mb-3 p-2 bg-surface-2 rounded-lg border border-line">
              <div className="flex items-center gap-1.5 text-brand-ink">
                <Camera className="w-4 h-4" />
                <span className="text-xs font-medium">
                  {photoCount} photo{photoCount !== 1 ? 's' : ''}
                  {log.has_before_photos && log.has_after_photos && ' (before & after)'}
                  {log.has_before_photos && !log.has_after_photos && ' (before)'}
                  {!log.has_before_photos && log.has_after_photos && ' (after)'}
                </span>
              </div>
            </div>
          )}

          {/* Chemical Readings Grid */}
          {readings.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {readings.map((reading) => {
                if (reading.type === "number") {
                  return (
                    <div key={reading.label} className="bg-[var(--status-info-soft)] border border-[var(--status-info-line)] rounded-lg p-2">
                      <div className="text-xs text-ink-secondary font-medium mb-0.5">{reading.label}</div>
                      <div className="text-xs font-semibold text-info">
                        {reading.value} {reading.unit}
                      </div>
                    </div>
                  );
                }

                const config = levelConfig[reading.value] || levelConfig.good;
                const Icon = config.icon;
                return (
                  <div key={reading.label} className={`${config.bg} ${config.border} border rounded-lg p-2`}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <Icon className={`w-2.5 h-2.5 ${config.color}`} />
                      <div className="text-xs text-ink-secondary font-medium">{reading.label}</div>
                    </div>
                    <div className={`text-xs font-semibold ${config.color} capitalize`}>
                      {reading.value}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Notes */}
          {log.notes && (
            <div className="flex items-start gap-2 p-2 bg-[var(--status-watch-soft)] rounded-lg border border-[var(--status-watch-line)] mb-2">
              <FileText className="w-3.5 h-3.5 text-watch flex-shrink-0 mt-0.5" />
              <p className="text-xs text-ink-secondary leading-relaxed">{log.notes}</p>
            </div>
          )}

          {/* Gate Code */}
          {log.gate_code && (
            <div className="flex items-center gap-2 p-2 bg-brand-softer/60 rounded-lg border border-[var(--status-info-line)] mb-2">
              <Lock className="w-3.5 h-3.5 text-brand-ink flex-shrink-0" />
              <p className="text-xs text-ink-secondary">Gate: <span className="font-semibold text-brand-ink">{log.gate_code}</span></p>
            </div>
          )}

          {/* Photo Gallery */}
          {photos.length > 0 && (
            <div className="mt-3 pt-3 border-t border-line">
              <ServicePhotoGallery photos={photos} />
            </div>
          )}

          {/* Delete Button */}
          <div className="flex justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(log._id || log.id);
              }}
              className="h-7 text-xs text-critical hover:text-critical hover:bg-[var(--status-critical-soft)]"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Delete Log
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CustomerHistoryCard({ customer, logs, totalLogCount, lastServiceDate, onDeleteLog, onClick }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [deleteLogId, setDeleteLogId] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const safeLogs = Array.isArray(logs) ? logs : [];
  const customerName = customer?.full_name || "Unknown Customer";
  const customerAddress = customer?.address || "No address";

  // Use totalLogCount if provided, otherwise fall back to logs.length
  const displayLogCount = totalLogCount ?? safeLogs.length;

  const handleDeleteConfirm = () => {
    if (deleteLogId) {
      onDeleteLog(deleteLogId);
      setDeleteLogId(null);
    }
  };

  return (
    <>
      <Card className="overflow-hidden transition-all duration-200 border-2 bg-surface-1 border-line hover:border-[var(--status-info-line)] shadow-sm">
        {/* Customer Header */}
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-4 cursor-pointer flex items-center justify-between active:bg-surface-2"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base text-ink">{customerName}</h3>
              <div className="flex items-center gap-1.5 text-ink-muted mt-0.5">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <p className="text-xs truncate">{customerAddress}</p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs px-2 py-0.5 bg-brand-soft text-brand-ink rounded-md font-medium">
                  {displayLogCount} log{displayLogCount !== 1 ? 's' : ''}
                </span>
                {lastServiceDate ? (
                  <span className="text-xs text-ink-secondary">
                    Last: {formatServiceDate(lastServiceDate)}
                  </span>
                ) : (
                  <span className="text-xs text-ink-muted">
                    No logs
                  </span>
                )}
              </div>
            </div>
          </div>

          <ChevronDown className={`w-5 h-5 text-ink-muted transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="border-t border-line bg-surface-2 p-4">
            {/* Service Logs - Collapsible List */}
            <div className="space-y-2 mb-4 max-h-[400px] overflow-y-auto">
              {safeLogs.length === 0 ? (
                <div className="p-3 text-xs text-ink-muted bg-white border border-dashed border-line rounded-lg">
                  No service logs match this filter.
                </div>
              ) : (
                safeLogs.map((log) => (
                  <LogEntry
                    key={log._id || log.id || `${log.customer_id}-${log.service_date}`}
                    log={log}
                    onDelete={(id) => setDeleteLogId(id)}
                  />
                ))
              )}
            </div>

            {/* Action Buttons */}
            <div className="pt-2 border-t border-line">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAnalysis(true);
                  }}
                  variant="outline"
                  className="text-sm h-9 border-2 border-[var(--status-info-line)] text-brand-ink hover:bg-brand-softer"
                  disabled={safeLogs.length < 3}
                >
                  <BarChart3 className="w-4 h-4 mr-1" />
                  Pool Analysis
                </Button>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClick();
                  }}
                  className="bg-brand hover:bg-brand-strong text-white text-sm h-9"
                >
                  View Details
                </Button>
              </div>
              {safeLogs.length < 3 && (
                <p className="text-xs text-ink-muted text-center mt-2">
                  Pool analysis requires at least 3 service visits
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteLogId} onOpenChange={() => setDeleteLogId(null)}>
        <AlertDialogContent className="max-w-[90%] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Delete Service Log?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This action cannot be undone. Are you sure you want to delete this log?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive hover:bg-destructive text-white text-sm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pool Analysis Panel */}
      {showAnalysis && (
        <PoolAnalysisPanel
          customer={customer}
          serviceLogs={safeLogs}
          onClose={() => setShowAnalysis(false)}
        />
      )}
    </>
  );
}
