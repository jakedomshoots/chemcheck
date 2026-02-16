/**
 * Public Report Page Component
 * 
 * Displays a service report to customers via a public link (no auth required).
 * Security relies on unguessable tokens (122-bit entropy).
 * Respects customer-specific report customization settings.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Droplets, 
  Calendar, 
  User, 
  FileText, 
  AlertTriangle,
  CheckCircle2,
  Clock,
  Image,
  Minus
} from 'lucide-react';

// ============================================
// Helper Functions
// ============================================

/**
 * Format service date for display
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Formatted date string
 */
function formatDisplayDate(dateString) {
  try {
    const [year, month, day] = dateString.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Get status color and label for chemical readings
 * @param {string|null} value - Chemical reading value
 * @returns {Object} Status object with color, bgColor, label, and icon
 */
function getReadingStatus(value) {
  if (!value) {
    return { color: 'text-slate-500', bgColor: 'bg-slate-100', label: 'Not tested', icon: 'unknown' };
  }
  
  switch (value.toLowerCase()) {
    case 'good':
    case 'ok':
      return { color: 'text-green-700', bgColor: 'bg-green-100', label: 'Good', icon: 'check' };
    case 'low':
      return { color: 'text-amber-700', bgColor: 'bg-amber-100', label: 'Low', icon: 'warning' };
    case 'high':
      return { color: 'text-amber-700', bgColor: 'bg-amber-100', label: 'High', icon: 'warning' };
    case 'critical':
      return { color: 'text-red-700', bgColor: 'bg-red-100', label: 'Critical', icon: 'critical' };
    default:
      return { color: 'text-slate-700', bgColor: 'bg-slate-100', label: value, icon: 'unknown' };
  }
}

/**
 * Format duration in milliseconds to human readable string
 * @param {number|undefined} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
function formatDuration(ms) {
  if (!ms) return '';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

// ============================================
// Sub-components
// ============================================

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-slate-100 p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-slate-100 flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Report Not Found</h2>
          <p className="text-sm text-slate-600">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ChemicalReadingCard({ label, value, unit }) {
  const status = getReadingStatus(value);
  
  return (
    <div className={`p-3 rounded-lg ${status.bgColor}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        {status.icon === 'check' && (
          <CheckCircle2 className={`w-4 h-4 ${status.color}`} />
        )}
        {status.icon === 'warning' && (
          <AlertTriangle className={`w-4 h-4 ${status.color}`} />
        )}
        {status.icon === 'critical' && (
          <AlertTriangle className={`w-4 h-4 ${status.color}`} />
        )}
        {status.icon === 'unknown' && (
          <Minus className={`w-4 h-4 ${status.color}`} />
        )}
      </div>
      <div className={`text-sm font-semibold mt-1 ${status.color}`}>
        {status.label}
        {unit && value && <span className="text-xs font-normal ml-1">{unit}</span>}
      </div>
    </div>
  );
}

function PhotoGallerySection({ title, photos, badgeColor }) {
  if (photos.length === 0) return null;
  
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full text-white ${badgeColor}`}>
          {title}
        </span>
        <span className="text-xs text-slate-500">
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
        </span>
      </div>
      {/* Responsive grid: 2 cols on mobile, 3 on tablet+ - Requirements: 3.6 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="relative aspect-square rounded-lg overflow-hidden bg-slate-100"
          >
            {photo.url ? (
              <img
                src={photo.url}
                alt={`${title} photo`}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                // Optimize for LCP by providing size hints
                width="300"
                height="300"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Image className="w-8 h-8 text-slate-400" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export default function ReportPage() {
  const { reportId } = useParams();
  const getReportByToken = useAction(api.serviceReports.getReportByToken);
  const [reportResult, setReportResult] = useState(undefined);

  // Fetch report data using action (public endpoint is implemented as Convex action)
  useEffect(() => {
    let cancelled = false;

    const loadReport = async () => {
      if (!reportId) {
        if (!cancelled) {
          setReportResult({
            found: false,
            error: 'Report link is invalid.',
          });
        }
        return;
      }

      setReportResult(undefined);

      try {
        const result = await getReportByToken({ token: reportId });
        if (!cancelled) {
          setReportResult(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load report.';
        if (!cancelled) {
          setReportResult({
            found: false,
            error: message,
          });
        }
      }
    };

    loadReport();

    return () => {
      cancelled = true;
    };
  }, [reportId, getReportByToken]);

  // Loading state
  if (reportResult === undefined) {
    return <LoadingSkeleton />;
  }

  // Error state - invalid or expired token
  if (!reportResult.found) {
    return <ErrorState message={reportResult.error || 'Report not found. The link may be invalid.'} />;
  }

  const report = reportResult.report;
  const beforeCount = report?.photos?.before?.length || 0;
  const afterCount = report?.photos?.after?.length || 0;
  const hasNotes = Boolean(report?.notes && report.notes.trim().length > 0);
  const hasReadings = Boolean(
    report?.chemicalReadings
    && (report.chemicalReadings.ph
      || report.chemicalReadings.chlorine
      || report.chemicalReadings.alkalinity
      || report.chemicalReadings.stabilizer
      || report.chemicalReadings.salt)
  );
  const confidenceScore = (
    (beforeCount > 0 && afterCount > 0 ? 45 : 0)
    + (hasReadings ? 35 : 0)
    + (hasNotes ? 20 : 0)
  );
  const confidenceLabel = confidenceScore >= 80 ? 'High' : confidenceScore >= 50 ? 'Medium' : 'Basic';
  const beforeAfterNarrative = beforeCount > 0 && afterCount > 0
    ? `Documented before-and-after proof with ${beforeCount + afterCount} service photo${beforeCount + afterCount === 1 ? '' : 's'}.`
    : 'Photo documentation is partial for this service.';

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-slate-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            <Droplets className="w-5 h-5 text-cyan-600" />
            <span className="font-semibold text-slate-900">{report.businessName}</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <Card className="overflow-hidden border-cyan-200 bg-gradient-to-r from-cyan-50 via-white to-blue-50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Service Summary</p>
              <Badge className="bg-cyan-100 text-cyan-700 hover:bg-cyan-100">
                Confidence: {confidenceLabel}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Overall</p>
                <p className={`text-sm font-semibold ${report.overallStatus === 'good' ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {report.overallStatus === 'good' ? 'All Good' : 'Needs Attention'}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Before</p>
                <p className="text-sm font-semibold text-slate-900">{beforeCount}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">After</p>
                <p className="text-sm font-semibold text-slate-900">{afterCount}</p>
              </div>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{beforeAfterNarrative}</p>
          </CardContent>
        </Card>

        {/* Service Summary Card - Requirements: 3.2 */}
        {report.settings?.show_overall_status !== false && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">Service Report</CardTitle>
                  <p className="text-sm text-slate-600 mt-1">
                    for {report.customerName}
                  </p>
                </div>
                <Badge
                  className={
                    report.overallStatus === 'good'
                      ? 'bg-green-100 text-green-700 hover:bg-green-100'
                      : 'bg-amber-100 text-amber-700 hover:bg-amber-100'
                  }
                >
                  {report.overallStatus === 'good' ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      All Good
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Needs Attention
                    </>
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Service Date and Technician - Requirements: 3.2 */}
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span>{formatDisplayDate(report.serviceDate)}</span>
                </div>
                {report.settings?.show_technician_name !== false && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <User className="w-4 h-4 text-slate-400" />
                    <span>{report.technicianName}</span>
                  </div>
                )}
                {report.settings?.show_service_duration !== false && report.serviceDuration && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Clock className="w-4 h-4 text-slate-400" />
                    <span>{formatDuration(report.serviceDuration)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Chemical Readings Card - Requirements: 3.3 */}
        {report.settings?.show_chemical_readings !== false && report.chemicalReadings && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Droplets className="w-4 h-4 text-cyan-600" />
                Chemical Readings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                <ChemicalReadingCard label="pH Level" value={report.chemicalReadings.ph} />
                <ChemicalReadingCard label="Chlorine" value={report.chemicalReadings.chlorine} />
                <ChemicalReadingCard label="Alkalinity" value={report.chemicalReadings.alkalinity} />
                <ChemicalReadingCard label="Stabilizer" value={report.chemicalReadings.stabilizer} />
                {report.chemicalReadings.salt !== null && report.chemicalReadings.salt !== undefined && (
                  <ChemicalReadingCard 
                    label="Salt" 
                    value={report.chemicalReadings.salt.toString()} 
                    unit="ppm"
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Service Notes - Requirements: 3.4 */}
        {report.settings?.show_service_notes !== false && report.notes && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-600" />
                Service Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {report.notes}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Photo Gallery - Requirements: 3.5 */}
        {(report.photos.before.length > 0 || report.photos.after.length > 0) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Image className="w-4 h-4 text-slate-600" />
                Service Photos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <PhotoGallerySection
                title="Before"
                photos={report.photos.before}
                badgeColor="bg-amber-500"
              />
              <PhotoGallerySection
                title="After"
                photos={report.photos.after}
                badgeColor="bg-green-500"
              />
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <footer className="text-center py-6">
          <p className="text-xs text-slate-500">
            Powered by ChemCheck Pool Software built by Dominick Pool Solutions
          </p>
        </footer>
      </main>
    </div>
  );
}
