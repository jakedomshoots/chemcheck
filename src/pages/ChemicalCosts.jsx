import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatBlock } from "@/components/ui/stat-block";
import { Skeleton } from "@/components/ui/skeleton";
import { ChemicalBeakerLoader } from "@/components/ui/loader";
import { Settings, TrendingUp, Users, Beaker } from "lucide-react";
import { createPageUrl } from "@/utils";
import { formatCurrency, isIsoDate, RANGE_PRESETS, resolveRange } from "@/lib/chemicalCosts";
import { formatAmount } from "@/lib/quantityParser";

const TOP_N = 10;

function technicianLabel(email) {
  if (!email || email === "unknown") return "Unassigned";
  return email.includes("@") ? email.split("@")[0] : email;
}

function monthLabel(key) {
  const [year, month] = String(key).split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return Number.isNaN(date.getTime()) ? key : date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function EmptyState({ title, body }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface-2/60 px-4 py-6 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 text-sm text-ink-secondary">{body}</p>}
    </div>
  );
}

function DataTable({ caption, columns, rows, renderRow, emptyTitle, emptyBody }) {
  if (!rows || rows.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />;
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[32rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={`px-3 py-2 ${column.align === "right" ? "text-right" : ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{rows.map(renderRow)}</tbody>
      </table>
    </div>
  );
}

function RangePicker({ preset, onPreset, custom, onCustom, rangeError }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">Date range</legend>
      <div role="group" aria-label="Date range presets" className="flex flex-wrap gap-2">
        {RANGE_PRESETS.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={preset === option.id ? "default" : "outline"}
            aria-pressed={preset === option.id}
            onClick={() => onPreset(option.id)}
            className={`h-9 rounded-full px-3 text-xs font-semibold ${preset === option.id ? "bg-brand text-white hover:bg-brand-strong" : "border-line bg-surface-1 text-ink-secondary"}`}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="cost-range-start" className="mb-1 block text-sm font-medium text-ink-secondary">Start</Label>
            <Input id="cost-range-start" type="date" value={custom.start} max={custom.end} onChange={(event) => onCustom({ ...custom, start: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="cost-range-end" className="mb-1 block text-sm font-medium text-ink-secondary">End</Label>
            <Input id="cost-range-end" type="date" value={custom.end} min={custom.start} onChange={(event) => onCustom({ ...custom, end: event.target.value })} />
          </div>
          {rangeError && <p role="alert" className="text-sm text-critical sm:col-span-2">{rangeError}</p>}
        </div>
      )}
    </fieldset>
  );
}

function CustomerBreakdown({ customers }) {
  const [open, setOpen] = useState(() => new Set());
  if (!customers || customers.length === 0) {
    return <EmptyState title="No chemical usage in this range" body="Log chemicals from a service visit and costs will appear here." />;
  }
  const toggle = (key) => {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  return (
    <ul className="space-y-2">
      {customers.map((customer) => {
        const expanded = open.has(customer.key);
        const panelId = `cost-customer-${customer.key.replace(/[^a-zA-Z0-9]/g, "")}`;
        return (
          <li key={customer.key} className="rounded-card border border-line bg-surface-1">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => toggle(customer.key)}
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">{customer.label}</span>
                <span className="block text-xs text-ink-muted">
                  {customer.visits} {customer.visits === 1 ? "visit" : "visits"}
                  {customer.service_day ? ` · ${customer.service_day}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-data text-sm font-semibold text-ink">{formatCurrency(customer.total_cost)}</span>
                <span className="block text-xs text-ink-muted">{formatCurrency(customer.cost_per_visit)} / visit</span>
              </span>
            </button>
            {expanded && (
              <div id={panelId} className="border-t border-line px-3 py-3">
                {customer.chemicals.length === 0 ? (
                  <p className="text-sm text-ink-secondary">No chemicals recorded.</p>
                ) : (
                  <ul className="divide-y divide-line text-sm">
                    {customer.chemicals.map((chemical) => (
                      <li key={chemical.chemical_type} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="text-ink-secondary">
                          {chemical.chemical_type}
                          {chemical.unit && chemical.amount > 0 ? (
                            <span className="ml-2 text-xs text-ink-muted">{formatAmount(chemical.amount, chemical.unit)}</span>
                          ) : null}
                        </span>
                        <span className="font-data text-ink">
                          {chemical.priced_rows === 0 ? <span className="text-xs text-watch">No price</span> : formatCurrency(chemical.total_cost)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function ChemicalCostsPage() {
  const [preset, setPreset] = useState("this_month");
  const [custom, setCustom] = useState(() => resolveRange("last_30"));

  const range = useMemo(() => (preset === "custom" ? custom : resolveRange(preset)), [preset, custom]);
  const rangeError = !isIsoDate(range.start) || !isIsoDate(range.end)
    ? "Choose a start and end date."
    : range.start > range.end
      ? "Start date must be on or before the end date."
      : null;

  const summary = useQuery(api.chemicalCosts.summary, rangeError ? "skip" : { start: range.start, end: range.end, top_n: TOP_N });
  const loading = !rangeError && summary === undefined;

  return (
    <div className="mx-auto max-w-5xl px-3 pb-28 pt-4 font-sans sm:px-4 lg:px-6">
      <header className="mb-5 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">Margins</p>
        <h1 className="text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">Chemical Costs</h1>
        <p className="mt-1 text-sm font-medium text-ink-muted">What each pool, route day and technician is costing you in chemicals.</p>
      </header>

      <Card className="mb-4 rounded-sheet border border-line bg-surface-1 p-4 shadow-card">
        <RangePicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} rangeError={rangeError} />
      </Card>

      {loading && (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <div className="flex items-center gap-3 text-sm text-ink-secondary">
            <ChemicalBeakerLoader className="h-6 w-6" />
            Crunching costs…
          </div>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {summary && (
        <div className="space-y-4">
          <Card className="rounded-sheet border border-line bg-surface-1 p-2 shadow-card">
            <div className="grid grid-cols-2 divide-x divide-line sm:grid-cols-4">
              <StatBlock label="Total cost" value={formatCurrency(summary.totals.total_cost)} tone="brand" dataTestId="stat-total-cost" />
              <StatBlock label="Visits" value={summary.totals.visits} tone="neutral" dataTestId="stat-visits" />
              <StatBlock label="Cost per visit" value={formatCurrency(summary.totals.cost_per_visit)} tone="info" dataTestId="stat-cost-per-visit" />
              <StatBlock label="Unpriced entries" value={summary.totals.unpriced_rows} tone={summary.totals.unpriced_rows > 0 ? "watch" : "ok"} dataTestId="stat-unpriced" />
            </div>
          </Card>

          {(summary.unpriced_chemicals.length > 0 || !summary.has_prices) && (
            <div role="status" className="flex flex-col gap-2 rounded-card border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
              <p>
                {summary.has_prices
                  ? `No price set for: ${summary.unpriced_chemicals.join(", ")}.`
                  : "Add chemical prices to see costs."}
              </p>
              <Button asChild size="sm" variant="outline" className="h-9 rounded-full border-line bg-surface-1 px-3 text-xs font-semibold">
                <Link to={`${createPageUrl("Settings")}?section=services`}>
                  <Settings className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Edit prices
                </Link>
              </Button>
            </div>
          )}

          {summary.truncated && (
            <p role="status" className="text-xs text-ink-muted">Showing the first part of a very large range. Narrow the dates for complete totals.</p>
          )}

          <section aria-labelledby="top-pools-heading" className="space-y-3">
            <h2 id="top-pools-heading" className="flex items-center gap-2 text-lg font-semibold text-ink">
              <TrendingUp className="h-5 w-5 text-ink-muted" aria-hidden="true" />
              Most expensive pools
            </h2>
            <DataTable
              caption="Top pools by chemical cost"
              columns={[
                { key: "rank", label: "#" },
                { key: "pool", label: "Pool" },
                { key: "visits", label: "Visits", align: "right" },
                { key: "cost", label: "Cost", align: "right" },
                { key: "per", label: "Per visit", align: "right" },
              ]}
              rows={summary.top_pools}
              emptyTitle="No pools to rank yet"
              emptyBody="Costs show up here once chemicals are logged for a customer."
              renderRow={(pool, index) => (
                <tr key={pool.key} className="bg-surface-1">
                  <td className="px-3 py-2 font-data text-ink-muted">{index + 1}</td>
                  <td className="px-3 py-2">
                    <span className="block font-medium text-ink">{pool.label}</span>
                    {pool.service_day && <span className="block text-xs text-ink-muted">{pool.service_day}</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-data text-ink">{pool.visits}</td>
                  <td className="px-3 py-2 text-right font-data font-semibold text-ink">{formatCurrency(pool.total_cost)}</td>
                  <td className="px-3 py-2 text-right font-data text-ink">{formatCurrency(pool.cost_per_visit)}</td>
                </tr>
              )}
            />
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section aria-labelledby="per-tech-heading" className="space-y-3">
              <h2 id="per-tech-heading" className="flex items-center gap-2 text-lg font-semibold text-ink">
                <Users className="h-5 w-5 text-ink-muted" aria-hidden="true" />
                By technician
              </h2>
              <DataTable
                caption="Chemical cost by technician"
                columns={[
                  { key: "tech", label: "Technician" },
                  { key: "visits", label: "Visits", align: "right" },
                  { key: "cost", label: "Cost", align: "right" },
                  { key: "per", label: "Per visit", align: "right" },
                ]}
                rows={summary.by_technician}
                emptyTitle="No technician activity"
                renderRow={(tech) => (
                  <tr key={tech.key} className="bg-surface-1">
                    <td className="px-3 py-2 font-medium text-ink" title={tech.key}>{technicianLabel(tech.key)}</td>
                    <td className="px-3 py-2 text-right font-data text-ink">{tech.visits}</td>
                    <td className="px-3 py-2 text-right font-data font-semibold text-ink">{formatCurrency(tech.total_cost)}</td>
                    <td className="px-3 py-2 text-right font-data text-ink">{formatCurrency(tech.cost_per_visit)}</td>
                  </tr>
                )}
              />
            </section>

            <section aria-labelledby="per-day-heading" className="space-y-3">
              <h2 id="per-day-heading" className="text-lg font-semibold text-ink">By route day and month</h2>
              <DataTable
                caption="Chemical cost by route day"
                columns={[
                  { key: "day", label: "Route day" },
                  { key: "visits", label: "Visits", align: "right" },
                  { key: "cost", label: "Cost", align: "right" },
                ]}
                rows={summary.by_route_day}
                emptyTitle="No route days"
                renderRow={(day) => (
                  <tr key={day.key} className="bg-surface-1">
                    <td className="px-3 py-2 font-medium text-ink">{day.label}</td>
                    <td className="px-3 py-2 text-right font-data text-ink">{day.visits}</td>
                    <td className="px-3 py-2 text-right font-data font-semibold text-ink">{formatCurrency(day.total_cost)}</td>
                  </tr>
                )}
              />
              <DataTable
                caption="Chemical cost by month"
                columns={[
                  { key: "month", label: "Month" },
                  { key: "visits", label: "Visits", align: "right" },
                  { key: "cost", label: "Cost", align: "right" },
                ]}
                rows={summary.by_month}
                emptyTitle="No months"
                renderRow={(month) => (
                  <tr key={month.key} className="bg-surface-1">
                    <td className="px-3 py-2 font-medium text-ink">{monthLabel(month.key)}</td>
                    <td className="px-3 py-2 text-right font-data text-ink">{month.visits}</td>
                    <td className="px-3 py-2 text-right font-data font-semibold text-ink">{formatCurrency(month.total_cost)}</td>
                  </tr>
                )}
              />
            </section>
          </div>

          <section aria-labelledby="per-chemical-heading" className="space-y-3">
            <h2 id="per-chemical-heading" className="flex items-center gap-2 text-lg font-semibold text-ink">
              <Beaker className="h-5 w-5 text-ink-muted" aria-hidden="true" />
              By chemical
            </h2>
            <DataTable
              caption="Chemical cost by product"
              columns={[
                { key: "chem", label: "Chemical" },
                { key: "amount", label: "Amount", align: "right" },
                { key: "cost", label: "Cost", align: "right" },
              ]}
              rows={summary.by_chemical}
              emptyTitle="No chemicals logged"
              renderRow={(chemical) => (
                <tr key={chemical.chemical_type} className="bg-surface-1">
                  <td className="px-3 py-2 font-medium text-ink">{chemical.chemical_type}</td>
                  <td className="px-3 py-2 text-right font-data text-ink">{chemical.unit && chemical.amount > 0 ? formatAmount(chemical.amount, chemical.unit) : "—"}</td>
                  <td className="px-3 py-2 text-right font-data font-semibold text-ink">
                    {chemical.priced_rows === 0 ? <span className="text-xs font-medium text-watch">No price</span> : formatCurrency(chemical.total_cost)}
                  </td>
                </tr>
              )}
            />
          </section>

          <section aria-labelledby="per-customer-heading" className="space-y-3">
            <h2 id="per-customer-heading" className="text-lg font-semibold text-ink">Per customer</h2>
            <CustomerBreakdown customers={summary.by_customer} />
          </section>
        </div>
      )}
    </div>
  );
}
