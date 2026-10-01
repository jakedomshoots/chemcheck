import { useState } from "react";
import { CheckCircle2, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { formatVisitDate } from "@/lib/portal";

const READING_LABELS = { ph: "pH", chlorine: "Chlorine", alkalinity: "Alkalinity", stabilizer: "Stabilizer" };

function readingTone(value) {
  if (!value) return "text-ink-muted";
  const normalized = String(value).toLowerCase();
  if (normalized === "good" || normalized === "ok") return "text-ok";
  if (normalized === "critical") return "text-critical";
  return "text-watch";
}

function formatDuration(ms) {
  if (!ms) return null;
  const minutes = Math.round(ms / 60000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** One service visit on the customer portal. Hidden sections are already null from the server. */
export function PortalVisitCard({ visit }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = `visit-${visit.id}`;
  const hasDetail = Boolean(visit.readings || visit.notes || visit.photos.length > 0 || visit.technician || visit.duration_ms);

  return (
    <li className="rounded-card border border-line bg-surface-1">
      <button
        type="button"
        aria-expanded={hasDetail ? expanded : undefined}
        aria-controls={hasDetail ? panelId : undefined}
        onClick={() => hasDetail && setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-ink">{formatVisitDate(visit.date)}</span>
          <span className="block text-xs text-ink-muted">
            {visit.service_type || "Service visit"}
            {visit.technician ? ` · ${visit.technician}` : ""}
          </span>
        </span>
        {visit.overall_status && (
          <span className={`flex shrink-0 items-center gap-1 text-xs font-semibold ${visit.overall_status === "good" ? "text-ok" : "text-watch"}`}>
            {visit.overall_status === "good" ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            {visit.overall_status === "good" ? "All good" : "Needs attention"}
          </span>
        )}
      </button>

      {hasDetail && expanded && (
        <div id={panelId} className="space-y-3 border-t border-line px-4 py-3">
          {visit.readings && (
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {Object.entries(READING_LABELS).map(([key, label]) => (
                <div key={key} className="rounded-card bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-ink-muted">{label}</dt>
                  <dd className={`font-semibold capitalize ${readingTone(visit.readings[key])}`}>{visit.readings[key] || "Not tested"}</dd>
                </div>
              ))}
              {visit.readings.salt !== null && visit.readings.salt !== undefined && (
                <div className="rounded-card bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-ink-muted">Salt</dt>
                  <dd className="font-data font-semibold text-ink">{visit.readings.salt} ppm</dd>
                </div>
              )}
            </dl>
          )}
          {visit.duration_ms ? <p className="text-xs text-ink-muted">Time on site: {formatDuration(visit.duration_ms)}</p> : null}
          {visit.notes && <p className="whitespace-pre-wrap text-sm text-ink-secondary">{visit.notes}</p>}
          {visit.photos.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-ink-muted">
                <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                Photos
              </p>
              <ul className="grid grid-cols-3 gap-2">
                {visit.photos.map((photo) => (
                  <li key={photo.id}>
                    <a href={photo.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-card border border-line">
                      <img src={photo.url} alt={`${photo.category} photo from ${formatVisitDate(visit.date)}`} loading="lazy" className="aspect-square w-full object-cover" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default PortalVisitCard;
