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
  low: { icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50/80", border: "border-yellow-200", label: "Low" },
  good: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50/80", border: "border-emerald-200", label: "Good" },
  high: { icon: AlertCircle, color: "text-orange-600", bg: "bg-orange-50/80", border: "border-orange-200", label: "High" },
  critical: { icon: XCircle, color: "text-red-600", bg: "bg-red-50/80", border: "border-red-200", label: "Critical" }
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

      try {
        const fetchedPhotos = await getPhotosByServiceLog(serviceLogId);

        // Check if request was aborted before updating state
        if (abortController.signal.aborted) {
          return;
        }

        // Transform to ServicePhoto format expected by gallery
        const transformedPhotos = fetchedPhotos.map(photo => ({
          id: photo.id,
          url: photo.dataUrl,
          category: photo.category,
          timestamp: photo.timestamp,
        }));

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
    <div className={`border-2 rounded-lg overflow-hidden transition-all ${isOpen ? 'border-cyan-300' : 'border-slate-200'}`}>
      {/* Collapsed Header - Always Visible */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${isOpen ? 'bg-cyan-50/50' : 'bg-white hover:bg-slate-50'}`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-cyan-600 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
          )}

          <CalendarIcon className="w-4 h-4 text-cyan-600 flex-shrink-0" />

          <span className="font-medium text-sm text-slate-900">
            {formatServiceDateFull(log.service_date)}
          </span>

          {/* Status Badge */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${statusConfig.bg} ${statusConfig.border} border`}>
            <StatusIcon className={`w-3 h-3 ${statusConfig.color}`} />
            <span className={`text-[10px] font-medium ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
          </div>

          {/* Service Type Badge */}
          {log.service_type && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50/80 border border-blue-200">
              <ClipboardList className="w-3 h-3 text-blue-600" />
              <span className="text-[10px] font-medium text-blue-600 truncate max-w-[100px]">
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
                ? 'bg-cyan-50 text-cyan-700'
                : 'bg-slate-50 text-slate-400'
                }`}
              title={hasPhotos ? `${photoCount} photo${photoCount !== 1 ? 's' : ''}` : 'No photos'}
            >
              <Camera className="w-3 h-3" />
              <span className="text-[10px] font-medium">{photoCount}</span>
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
        <div className="p-3 pt-0 bg-white border-t border-slate-100">
          {/* Photo Summary */}
          {hasPhotos && (
            <div className="flex items-center gap-3 mb-3 p-2 bg-slate-50/80 rounded-lg border border-slate-200">
              <div className="flex items-center gap-1.5 text-cyan-700">
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
                    <div className="flex items-center gap-1 mb-0.5">
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
          )}

          {/* Notes */}
          {log.notes && (
            <div className="flex items-start gap-2 p-2 bg-amber-50/60 rounded-lg border border-amber-200 mb-2">
              <FileText className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-700 leading-relaxed">{log.notes}</p>
            </div>
          )}

          {/* Gate Code */}
          {log.gate_code && (
            <div className="flex items-center gap-2 p-2 bg-purple-50/60 rounded-lg border border-purple-200 mb-2">
              <Lock className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />
              <p className="text-xs text-slate-700">Gate: <span className="font-semibold text-purple-700">{log.gate_code}</span></p>
            </div>
          )}

          {/* Photo Gallery */}
          {photos.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200/60">
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
              className="h-7 text-xs text-red-500 hover:text-red-700 hover:bg-red-50/50"
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
      <Card className="overflow-hidden transition-all duration-200 border-2 bg-white/60 border-slate-200/60 hover:border-cyan-300 shadow-sm">
        {/* Customer Header */}
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-4 cursor-pointer flex items-center justify-between active:bg-slate-50/50"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base text-slate-900">{customerName}</h3>
              <div className="flex items-center gap-1.5 text-slate-500 mt-0.5">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <p className="text-xs truncate">{customerAddress}</p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs px-2 py-0.5 bg-cyan-100/80 text-cyan-700 rounded-md font-medium">
                  {displayLogCount} log{displayLogCount !== 1 ? 's' : ''}
                </span>
                {lastServiceDate ? (
                  <span className="text-xs text-slate-600">
                    Last: {formatServiceDate(lastServiceDate)}
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">
                    No logs
                  </span>
                )}
              </div>
            </div>
          </div>

          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="border-t border-slate-200/60 bg-slate-50/40 p-4">
            {/* Service Logs - Collapsible List */}
            <div className="space-y-2 mb-4 max-h-[400px] overflow-y-auto">
              {safeLogs.length === 0 ? (
                <div className="p-3 text-xs text-slate-500 bg-white border border-dashed border-slate-200 rounded-lg">
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
            <div className="pt-2 border-t border-slate-200/60">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAnalysis(true);
                  }}
                  variant="outline"
                  className="text-sm h-9 border-2 border-purple-200 text-purple-700 hover:bg-purple-50"
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
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white text-sm h-9"
                >
                  View Details
                </Button>
              </div>
              {safeLogs.length < 3 && (
                <p className="text-xs text-slate-500 text-center mt-2">
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
              className="bg-red-600 hover:bg-red-700 text-white text-sm"
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
