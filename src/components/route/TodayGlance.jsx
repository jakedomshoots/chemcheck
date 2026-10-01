import { memo } from "react";
import { format } from "date-fns";
import { CheckCircle2, Clock3, MapPin, Navigation } from "lucide-react";
import { buildNavigationUrl } from "@/lib/mapNavigation";

function formatRemaining(totalMinutes) {
  const safe = Number.isFinite(totalMinutes) ? Math.max(0, Math.round(totalMinutes)) : 0;
  if (safe < 60) return `${safe} min`;
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

/**
 * TodayGlance — the day in one card, the web/PWA stand-in for an iOS widget
 * or Live Activity. Stops done / remaining, the next stop with a maps link,
 * the estimated finish time, and a progress bar.
 *
 * Purely presentational: Home computes the numbers (see
 * `estimateRouteFinishTime`) and the same values feed
 * `buildTodayGlancePayload` for a future native widget.
 */
const TodayGlance = memo(function TodayGlance({
  total = 0,
  completed = 0,
  skipped = 0,
  nextStop = null,
  finishAt = null,
  remainingMinutes = 0,
  className = "",
}) {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(safeTotal, Math.max(0, completed));
  const remaining = Math.max(0, safeTotal - safeCompleted - Math.max(0, skipped));
  const progress = safeTotal > 0 ? Math.round((safeCompleted / safeTotal) * 100) : 0;
  const allDone = safeTotal > 0 && safeCompleted === safeTotal;
  const nothingPending = remaining === 0;
  const address = String(nextStop?.address || "").trim();
  const mapsUrl = address ? buildNavigationUrl(address) : "";
  const finishLabel = finishAt instanceof Date && Number.isFinite(finishAt.getTime())
    ? format(finishAt, "h:mm a")
    : null;

  if (safeTotal === 0) return null;

  return (
    <section
      data-testid="today-glance"
      aria-labelledby="today-glance-title"
      className={`mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="today-glance-title" className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-muted">
            At a glance
          </h3>
          <p className="mt-1 flex items-baseline gap-1.5 text-ink" aria-live="polite" aria-atomic="true">
            <span className="font-data text-2xl font-semibold tabular-nums tracking-[-0.03em]">
              {safeCompleted}
              <span className="text-ink-muted">/{safeTotal}</span>
            </span>
            <span className="text-sm font-medium text-ink-secondary">
              done · {remaining} remaining
            </span>
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-muted">Est. finish</p>
          <p className="mt-1 flex items-center justify-end gap-1 font-data text-base font-semibold tabular-nums text-ink">
            <Clock3 className="h-4 w-4 text-brand-ink" aria-hidden="true" />
            {nothingPending ? (
              <span>Done</span>
            ) : finishLabel ? (
              <span>
                {finishLabel}
                <span className="sr-only"> (about {formatRemaining(remainingMinutes)} left)</span>
              </span>
            ) : (
              <span>—</span>
            )}
          </p>
        </div>
      </div>

      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label="Route progress"
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={safeCompleted}
        aria-valuetext={`${safeCompleted} of ${safeTotal} stops done`}
      >
        <div
          className="route-progress-bar h-full rounded-full bg-brand"
          style={{ "--route-progress": progress }}
        />
      </div>

      {allDone ? (
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-ok">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Every stop is logged.
        </p>
      ) : nextStop ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-card border border-line bg-surface-2 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-muted">Next stop</p>
            <p className="truncate text-sm font-semibold text-ink" data-testid="today-glance-next-name">
              {nextStop.full_name || "Customer"}
            </p>
            {address ? (
              <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs font-medium text-ink-secondary">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="truncate">{address}</span>
              </p>
            ) : (
              <p className="mt-0.5 text-xs font-medium text-ink-muted">No address on file</p>
            )}
          </div>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${nextStop.full_name || "next stop"} in Maps`}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-control bg-brand px-3 text-xs font-semibold text-white shadow-cta transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Navigation className="h-4 w-4" aria-hidden="true" />
              Open in Maps
            </a>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm font-medium text-ink-secondary">
          Nothing pending — remaining stops are skipped for this week.
        </p>
      )}
    </section>
  );
});

export default TodayGlance;
