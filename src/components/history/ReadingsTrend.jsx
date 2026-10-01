import { useMemo, useState } from "react";
import { AlertTriangle, Info, TrendingDown, TrendingUp } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  buildReadingTrends,
  dayIndex,
  trendsToTableRows,
  TREND_RANGES,
} from "@/lib/readings/trends";

const W = 320;
const H = 120;
const PAD = { top: 10, right: 10, bottom: 18, left: 10 };

function formatValue(value, decimals) {
  if (value === undefined || value === null) return "";
  return Number(value).toFixed(decimals);
}

function formatShortDate(iso) {
  const [, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function MiniChart({ series, trends }) {
  const { points, target, decimals, unit, label } = series;
  const x0 = dayIndex(trends.start);
  const x1 = dayIndex(trends.end);
  const span = Math.max(1, x1 - x0);
  const sx = (iso) => PAD.left + ((dayIndex(iso) - x0) / span) * (W - PAD.left - PAD.right);

  const values = points.map((point) => point.value);
  let lo = Math.min(...values, target ? target.min : Infinity);
  let hi = Math.max(...values, target ? target.max : -Infinity);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const padY = (hi - lo) * 0.12;
  lo -= padY;
  hi += padY;
  const sy = (value) => PAD.top + (1 - (value - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${sx(point.date).toFixed(1)},${sy(point.value).toFixed(1)}`).join(" ");
  const latest = series.latest;
  const description = `${label} trend: ${points.length} reading${points.length === 1 ? "" : "s"} in ${trends.rangeDays} days` +
    (latest ? `, latest ${formatValue(latest.value, decimals)}${unit ? ` ${unit}` : ""} on ${latest.date}` : "") +
    (target ? `, target ${target.min} to ${target.max}` : "");

  return (
    <figure className="min-w-0 rounded-raised border border-line bg-surface-1 p-3">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{label}</span>
        {latest && (
          <span className={`font-data text-sm font-semibold tabular-nums ${latest.inRange === false ? "text-action" : "text-ink"}`}>
            {formatValue(latest.value, decimals)}{unit ? <span className="ml-0.5 text-[0.625rem] text-ink-muted">{unit}</span> : null}
          </span>
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={description}
        className="mt-1 block overflow-visible"
      >
        {target && (
          <rect
            x={PAD.left}
            y={sy(target.max)}
            width={W - PAD.left - PAD.right}
            height={Math.max(1, sy(target.min) - sy(target.max))}
            fill="var(--status-ok-soft)"
            stroke="var(--status-ok-line)"
            strokeDasharray="2 3"
            rx="2"
          />
        )}
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--line)" />
        {points.length > 1 && (
          <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {points.map((point) => (
          <circle
            key={point.date}
            cx={sx(point.date)}
            cy={sy(point.value)}
            r="3.5"
            fill={point.inRange === false ? "var(--status-action)" : "var(--brand)"}
            stroke="var(--surface-1)"
            strokeWidth="1.5"
          >
            <title>{`${point.date}: ${formatValue(point.value, decimals)}${unit ? ` ${unit}` : ""}`}</title>
          </circle>
        ))}
        {trends.doses.map((dose) => {
          const x = sx(dose.date);
          const y = H - PAD.bottom + 3;
          return (
            <polygon
              key={dose.date}
              data-testid="dose-marker"
              points={`${x - 4},${y + 8} ${x + 4},${y + 8} ${x},${y}`}
              fill={dose.onVisit ? "var(--status-info)" : "var(--ink-muted)"}
            >
              <title>{`${dose.date}: ${dose.entries.map((entry) => `${entry.chemical_type} ${entry.quantity}`).join(", ")}`}</title>
            </polygon>
          );
        })}
        <text x={PAD.left} y={H - 4} fontSize="9" fill="var(--ink-muted)">{formatShortDate(trends.start)}</text>
        <text x={W - PAD.right} y={H - 4} fontSize="9" fill="var(--ink-muted)" textAnchor="end">{formatShortDate(trends.end)}</text>
      </svg>
    </figure>
  );
}

function DriftIcon({ drift }) {
  if (drift === "rising") return <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />;
  if (drift === "falling") return <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />;
  return null;
}

/**
 * Inline SVG readings trend for one pool.
 *
 * Props:
 *  - serviceLogs, chemicalUsage: rows for this customer (optionally filtered by poolId)
 *  - poolId: restrict to one pool (optional)
 *  - poolType, surfaceType: pick target bands
 *  - title: heading text (default "Readings trend")
 *  - defaultRange: 30 | 90 | 365
 *  - now: ISO date for deterministic rendering in tests
 */
export default function ReadingsTrend({
  serviceLogs = [],
  chemicalUsage = [],
  poolId,
  poolType,
  surfaceType,
  title = "Readings trend",
  defaultRange = 90,
  now,
}) {
  const [range, setRange] = useState(defaultRange);
  const trends = useMemo(() => buildReadingTrends({
    serviceLogs,
    chemicalUsage,
    rangeDays: range,
    now,
    poolType,
    surfaceType,
    poolId,
  }), [serviceLogs, chemicalUsage, range, now, poolType, surfaceType, poolId]);

  const visible = trends.series.filter((series) => series.points.length > 0);
  const rows = useMemo(() => trendsToTableRows(trends), [trends]);
  const headingId = `readings-trend-${poolId ?? "all"}`;

  return (
    <section aria-labelledby={headingId} data-testid="readings-trend" className="rounded-sheet border border-line bg-surface-1 p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-lg font-semibold tracking-[-0.025em] text-ink">{title}</h3>
          <p className="mt-0.5 text-xs text-ink-muted" aria-live="polite">
            {trends.visitCount} visit{trends.visitCount === 1 ? "" : "s"} · {trends.doses.length} dose day{trends.doses.length === 1 ? "" : "s"} · last {range} days
          </p>
        </div>
        <SegmentedControl
          ariaLabel="Trend range"
          size="sm"
          fullWidth={false}
          value={range}
          onChange={setRange}
          options={TREND_RANGES.map((days) => ({ value: days, label: `${days}d` }))}
        />
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 rounded-control bg-surface-2 px-3 py-3 text-sm text-ink-muted">
          No numeric readings in this window. Log readings in numeric mode to see trends.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((series) => <MiniChart key={series.key} series={series} trends={trends} />)}
        </div>
      )}

      {visible.some((series) => series.drift === "rising" || series.drift === "falling" || series.outOfRangeStreak > 0) && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Drift summary">
          {visible.filter((series) => series.drift === "rising" || series.drift === "falling" || series.outOfRangeStreak > 0).map((series) => (
            <li key={series.key} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-secondary">
              <DriftIcon drift={series.drift} />
              {series.shortLabel}
              {series.drift === "rising" || series.drift === "falling" ? ` ${series.drift}` : ""}
              {series.outOfRangeStreak > 0 ? ` · out of range ×${series.outOfRangeStreak}` : ""}
            </li>
          ))}
        </ul>
      )}

      {trends.diagnostics.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Trend hints">
          {trends.diagnostics.map((hint) => (
            <li
              key={hint.id}
              className={`flex items-start gap-2 rounded-control border px-3 py-2 text-xs leading-5 ${hint.severity === "watch"
                ? "border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] text-ink"
                : "border-line bg-surface-2 text-ink-secondary"}`}
            >
              {hint.severity === "watch"
                ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-watch" aria-hidden="true" />
                : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />}
              <span>{hint.message}</span>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3 text-xs">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ink-secondary">Data table</summary>
        {rows.length === 0 ? (
          <p className="py-2 text-ink-muted">No rows in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">{title}: readings and chemicals by visit date</caption>
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th scope="col" className="py-1.5 pr-2 font-semibold">Date</th>
                  {trends.series.map((series) => (
                    <th key={series.key} scope="col" className="py-1.5 pr-2 font-semibold">{series.shortLabel}</th>
                  ))}
                  <th scope="col" className="py-1.5 font-semibold">Chemicals</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.date} className="border-b border-line">
                    <th scope="row" className="py-1.5 pr-2 font-data font-semibold tabular-nums text-ink">{row.date}</th>
                    {trends.series.map((series) => (
                      <td key={series.key} className="py-1.5 pr-2 font-data tabular-nums text-ink-secondary">
                        {row.values[series.key] === undefined ? "—" : formatValue(row.values[series.key], series.decimals)}
                      </td>
                    ))}
                    <td className="py-1.5 text-ink-secondary">{row.doses.length ? row.doses.join("; ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}
