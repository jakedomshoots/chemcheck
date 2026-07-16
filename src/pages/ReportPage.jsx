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

function getReadingStatus(value) {
  if (!value) {
    return { color: 'text-ink-muted', bgColor: 'bg-surface-2', label: 'Not tested', icon: 'unknown' };
  }
  
  switch (value.toLowerCase()) {
    case 'good':
    case 'ok':
      return { color: 'text-ok', bgColor: 'bg-[var(--status-ok-soft)]', label: 'Good', icon: 'check' };
    case 'low':
      return { color: 'text-watch', bgColor: 'bg-[var(--status-watch-soft)]', label: 'Low', icon: 'warning' };
    case 'high':
      return { color: 'text-watch', bgColor: 'bg-[var(--status-watch-soft)]', label: 'High', icon: 'warning' };
    case 'critical':
      return { color: 'text-critical', bgColor: 'bg-[var(--status-critical-soft)]', label: 'Critical', icon: 'critical' };
    default:
      return { color: 'text-ink-secondary', bgColor: 'bg-surface-2', label: value, icon: 'unknown' };
  }
}

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

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-surface-0 px-3 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-10 w-48 rounded-full" />
        <div className="overflow-hidden rounded-sheet border border-line bg-surface-1 p-5 shadow-card ">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-7 w-64" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-24 w-full rounded-raised" />
            <Skeleton className="h-32 w-full rounded-raised" />
            <Skeleton className="h-48 w-full rounded-raised" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4 py-10">
      <div className="max-w-md overflow-hidden rounded-sheet border border-line bg-surface-1 p-8 text-center shadow-card ">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--status-critical-soft)]">
          <AlertTriangle className="h-7 w-7 text-critical" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-ink">Report Not Found</h2>
        <p className="mt-2 text-sm font-medium text-ink-muted">{message}</p>
      </div>
    </div>
  );
}

function ChemicalReadingCard({ label, value, unit }) {
  const status = getReadingStatus(value);

  return (
    <div className={`rounded-card border border-line p-3 shadow-card ${status.bgColor}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{label}</span>
        {status.icon === 'check' && (
          <CheckCircle2 className={`h-4 w-4 shrink-0 ${status.color}`} aria-hidden="true" />
        )}
        {status.icon === 'warning' && (
          <AlertTriangle className={`h-4 w-4 shrink-0 ${status.color}`} aria-hidden="true" />
        )}
        {status.icon === 'critical' && (
          <AlertTriangle className={`h-4 w-4 shrink-0 ${status.color}`} aria-hidden="true" />
        )}
        {status.icon === 'unknown' && (
          <Minus className={`h-4 w-4 shrink-0 ${status.color}`} aria-hidden="true" />
        )}
      </div>
      <div className={`mt-1 text-sm font-semibold ${status.color}`}>
        {status.label}
        {unit && value && <span className="ml-1 text-xs font-normal opacity-80">{unit}</span>}
      </div>
    </div>
  );
}

function PhotoGallerySection({ title, photos, badgeColor }) {
  if (photos.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white ${badgeColor}`}>
          {title}
        </span>
        <span className="text-xs font-medium text-ink-muted">
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="relative aspect-square overflow-hidden rounded-card border border-line bg-surface-2 shadow-sm"
          >
            {photo.url ? (
              <img
                src={photo.url}
                alt={`${title} photo`}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                width="300"
                height="300"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Image className="h-8 w-8 text-ink-muted" aria-hidden="true" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReportPage() {
  const { reportId } = useParams();
  const getReportByToken = useAction(api.serviceReports.getReportByToken);
  const [reportResult, setReportResult] = useState(undefined);

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

  if (reportResult === undefined) {
    return <LoadingSkeleton />;
  }

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
    <div className="min-h-screen bg-surface-0 font-sans">
      <header className="sticky top-0 z-10 border-b border-line bg-surface-1 ">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
            <Droplets className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight text-ink">
            {report.businessName}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-3 px-3 pb-10 pt-4 sm:px-6 sm:pt-6">
        <Card className="overflow-hidden rounded-sheet border border-line bg-surface-1 shadow-card ">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
                Service Summary
              </p>
              <Badge className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-ink hover:bg-brand-soft">
                Confidence: {confidenceLabel}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-card border border-line bg-surface-1 p-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Overall</p>
                <p className={`mt-1 text-sm font-semibold ${report.overallStatus === 'good' ? 'text-ok' : 'text-watch'}`}>
                  {report.overallStatus === 'good' ? 'All Good' : 'Needs Attention'}
                </p>
              </div>
              <div className="rounded-card border border-line bg-surface-1 p-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Before</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-ink">{beforeCount}</p>
              </div>
              <div className="rounded-card border border-line bg-surface-1 p-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">After</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-ink">{afterCount}</p>
              </div>
            </div>
            <p className="text-sm font-medium leading-relaxed text-ink-secondary">
              {beforeAfterNarrative}
            </p>
          </CardContent>
        </Card>

        {report.settings?.show_overall_status !== false && (
          <Card className="overflow-hidden rounded-sheet border border-line bg-surface-1 shadow-card ">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
                    Service Report
                  </p>
                  <CardTitle className="mt-2 truncate text-2xl font-semibold tracking-[-0.04em] text-ink">
                    {report.customerName}
                  </CardTitle>
                </div>
                <Badge
                  className={
                    report.overallStatus === 'good'
                      ? 'rounded-full bg-[var(--status-ok-soft)] px-2.5 py-1 text-xs font-semibold text-ok hover:bg-[var(--status-ok-soft)]'
                      : 'rounded-full bg-[var(--status-watch-soft)] px-2.5 py-1 text-xs font-semibold text-watch hover:bg-[var(--status-watch-soft)]'
                  }
                >
                  {report.overallStatus === 'good' ? (
                    <>
                      <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
                      All Good
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
                      Needs Attention
                    </>
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <div className="flex items-center gap-2 text-ink-secondary">
                  <Calendar className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                  <span>{formatDisplayDate(report.serviceDate)}</span>
                </div>
                {report.settings?.show_technician_name !== false && (
                  <div className="flex items-center gap-2 text-ink-secondary">
                    <User className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                    <span>{report.technicianName}</span>
                  </div>
                )}
                {report.settings?.show_service_duration !== false && report.serviceDuration && (
                  <div className="flex items-center gap-2 text-ink-secondary">
                    <Clock className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                    <span>{formatDuration(report.serviceDuration)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {report.settings?.show_chemical_readings !== false && report.chemicalReadings && (
          <Card className="overflow-hidden rounded-sheet border border-line bg-surface-1 shadow-card ">
            <CardHeader className="pb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
                Readings
              </p>
              <CardTitle className="mt-2 flex items-center gap-2 text-lg font-semibold tracking-[-0.035em] text-ink">
                <Droplets className="h-4 w-4 text-brand-ink" aria-hidden="true" />
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

        {report.settings?.show_service_notes !== false && report.notes && (
          <Card className="overflow-hidden rounded-sheet border border-line bg-surface-1 shadow-card ">
            <CardHeader className="pb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
                Notes
              </p>
              <CardTitle className="mt-2 flex items-center gap-2 text-lg font-semibold tracking-[-0.035em] text-ink">
                <FileText className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                Service Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-ink-secondary">
                {report.notes}
              </p>
            </CardContent>
          </Card>
        )}
        {(report.photos.before.length > 0 || report.photos.after.length > 0) && (
          <Card className="overflow-hidden rounded-sheet border border-line bg-surface-1 shadow-card ">
            <CardHeader className="pb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
                Gallery
              </p>
              <CardTitle className="mt-2 flex items-center gap-2 text-lg font-semibold tracking-[-0.035em] text-ink">
                <Image className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                Service Photos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <PhotoGallerySection
                title="Before"
                photos={report.photos.before}
                badgeColor="bg-[var(--status-watch-soft)]0"
              />
              <PhotoGallerySection
                title="After"
                photos={report.photos.after}
                badgeColor="bg-[var(--status-ok-soft)]0"
              />
            </CardContent>
          </Card>
        )}

        <footer className="px-2 py-6 text-center">
          <p className="text-xs font-medium text-ink-muted">
            Powered by ChemCheck Pool Software built by Dominick Pool Solutions
          </p>
        </footer>
      </main>
    </div>
  );
}
