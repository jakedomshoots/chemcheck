import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, ChevronRight, Search } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCustomers, useServiceLogs } from '@/api/convexHooks';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { IconBadge, PoolIcon } from '@/components/ui/iconography';
import { APP_ROUTES } from '@/lib/routeConfig';
import { calculateServiceLogLsi, formatLsi } from '@/lib/lsi';

const STATUS_COPY = {
  aggressive: { label: 'Aggressive', detail: 'Water may seek calcium from plaster and equipment.', tone: 'text-action', soft: 'bg-[var(--status-action-soft)] border-[var(--status-action-line)]' },
  balanced: { label: 'Balanced', detail: 'Calcium carbonate saturation is in the target range.', tone: 'text-ok', soft: 'bg-[var(--status-ok-soft)] border-[var(--status-ok-line)]' },
  'scale-forming': { label: 'Scale-forming', detail: 'Water may deposit calcium scale on surfaces and equipment.', tone: 'text-watch', soft: 'bg-[var(--status-watch-soft)] border-[var(--status-watch-line)]' },
};

function formatVisitDate(date) {
  try {
    return format(parseISO(date), 'MMM d, yyyy');
  } catch {
    return date;
  }
}

function LsiRail({ value, compact = false }) {
  const position = Math.max(0, Math.min(100, ((value + 0.6) / 1.2) * 100));
  return (
    <div className={compact ? 'w-28' : 'w-full'} aria-label={`LSI ${formatLsi(value)}`}>
      <div className="relative h-2 overflow-visible rounded-full bg-[linear-gradient(to_right,var(--status-action-soft)_0_25%,var(--status-ok-soft)_25%_75%,var(--status-watch-soft)_75%_100%)]">
        <span className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow-sm" style={{ left: `${position}%` }} />
      </div>
      {!compact && (
        <div className="mt-2 flex justify-between text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          <span>Aggressive</span><span>Balanced</span><span>Scale</span>
        </div>
      )}
    </div>
  );
}

function ResultBadge({ output }) {
  if (!output.result) {
    return <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-muted">Needs readings</span>;
  }
  const copy = STATUS_COPY[output.result.status];
  return (
    <span className={`rounded-full border px-2.5 py-1 font-data text-xs font-semibold tabular-nums ${copy.soft} ${copy.tone}`}>
      {formatLsi(output.result.value)}
    </span>
  );
}

function CustomerOverview({ customers, logs, onSelect }) {
  const [query, setQuery] = useState('');
  const logsByCustomer = useMemo(() => {
    const grouped = new Map();
    logs.forEach((log) => {
      if (!grouped.has(log.customer_id)) grouped.set(log.customer_id, []);
      grouped.get(log.customer_id).push(log);
    });
    return grouped;
  }, [logs]);

  const rows = useMemo(() => customers
    .filter((customer) => customer.full_name.toLowerCase().includes(query.trim().toLowerCase()))
    .map((customer) => {
      const customerLogs = logsByCustomer.get(customer._id) || [];
      const latest = customerLogs[0];
      return { customer, latest, output: latest ? calculateServiceLogLsi(latest) : null };
    })
    .sort((a, b) => a.customer.full_name.localeCompare(b.customer.full_name)), [customers, logsByCustomer, query]);

  const scoredCount = rows.filter((row) => row.output?.result).length;
  const attentionCount = rows.filter((row) => row.output?.result && row.output.result.status !== 'balanced').length;

  return (
    <>
      <div className="grid grid-cols-3 overflow-hidden rounded-raised border border-line bg-surface-1 shadow-card">
        {[
          ['Customers', rows.length],
          ['With LSI', scoredCount],
          ['Attention', attentionCount],
        ].map(([label, value], index) => (
          <div key={label} className={`px-3 py-3 text-center ${index ? 'border-l border-line' : ''}`}>
            <p className="font-data text-xl font-semibold tabular-nums text-ink">{value}</p>
            <p className="mt-0.5 text-[0.6875rem] font-semibold text-ink-muted">{label}</p>
          </div>
        ))}
      </div>

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a customer"
          aria-label="Find a customer"
          className="h-12 rounded-card border-line bg-surface-1 pl-10 shadow-sm"
        />
      </div>

      <Card className="mt-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-0 shadow-card">
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <PoolIcon name="empty" className="mx-auto h-8 w-8 text-ink-muted" />
            <p className="mt-3 text-sm font-semibold text-ink">No customers found</p>
            <p className="mt-1 text-xs text-ink-muted">Try another name or add a customer first.</p>
          </div>
        ) : rows.map(({ customer, latest, output }, index) => (
          <button
            key={customer._id}
            type="button"
            onClick={() => onSelect(customer._id)}
            className={`flex min-h-20 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${index ? 'border-t border-line' : ''}`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-softer text-brand-ink">
              <PoolIcon name="waterLevel" className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{customer.full_name}</span>
              <span className="mt-0.5 block truncate text-xs text-ink-muted">
                {latest ? `Latest visit ${formatVisitDate(latest.service_date)}` : 'No logged visits'}
              </span>
              {output?.result && <span className="mt-2 block"><LsiRail value={output.result.value} compact /></span>}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {output ? <ResultBadge output={output} /> : <span className="text-xs font-semibold text-ink-muted">No visits</span>}
              <ChevronRight className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            </span>
          </button>
        ))}
      </Card>
    </>
  );
}

function VisitHistory({ customer, logs, onBack }) {
  const rows = logs.filter((log) => log.customer_id === customer._id);
  const latestScored = rows.map((log) => ({ log, output: calculateServiceLogLsi(log) })).find((row) => row.output.result);

  return (
    <>
      <button type="button" onClick={onBack} className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-sm font-semibold text-ink-secondary hover:bg-surface-2">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All customers
      </button>

      {latestScored ? (
        <Card className={`rounded-sheet border p-5 shadow-card ${STATUS_COPY[latestScored.output.result.status].soft}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">Latest calculated visit</p>
              <p className={`mt-2 font-data text-4xl font-semibold tracking-[-0.04em] tabular-nums ${STATUS_COPY[latestScored.output.result.status].tone}`}>
                {formatLsi(latestScored.output.result.value)}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">{STATUS_COPY[latestScored.output.result.status].label}</p>
            </div>
            <span className="rounded-full bg-surface-1/80 px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-secondary">
              {latestScored.output.result.confidence === 'detailed' ? 'Detailed' : 'Estimated'}
            </span>
          </div>
          <div className="mt-5"><LsiRail value={latestScored.output.result.value} /></div>
          <p className="mt-4 text-xs leading-5 text-ink-secondary">{STATUS_COPY[latestScored.output.result.status].detail}</p>
        </Card>
      ) : (
        <Card className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card">
          <p className="text-sm font-semibold text-ink">No calculable visits yet</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">Log numeric pH, alkalinity, CYA, hardness and water temperature on the next service visit.</p>
        </Card>
      )}

      <div className="mt-5">
        <h2 className="text-lg font-semibold tracking-[-0.025em] text-ink">Visit history</h2>
        <p className="mt-1 text-xs text-ink-muted">Every service visit stays visible, including incomplete readings.</p>
      </div>

      <div className="mt-3 space-y-3">
        {rows.length === 0 ? (
          <Card className="rounded-sheet border border-line bg-surface-1 p-6 text-center shadow-card">
            <p className="text-sm font-semibold text-ink">No service visits logged</p>
          </Card>
        ) : rows.map((log) => {
          const output = calculateServiceLogLsi(log);
          const copy = output.result ? STATUS_COPY[output.result.status] : null;
          return (
            <Card key={log._id} className="rounded-raised border border-line bg-surface-1 p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{formatVisitDate(log.service_date)}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{log.service_type || 'Service visit'}</p>
                </div>
                <ResultBadge output={output} />
              </div>
              {output.result ? (
                <>
                  <div className="mt-4"><LsiRail value={output.result.value} /></div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <span><b className="block font-data text-ink">{log.ph_value}</b><span className="text-ink-muted">pH</span></span>
                    <span><b className="block font-data text-ink">{log.alkalinity_value} ppm</b><span className="text-ink-muted">Total alk.</span></span>
                    <span><b className="block font-data text-ink">{log.hardness_value} ppm</b><span className="text-ink-muted">{log.hardness_source === 'calcium' ? 'Calcium' : 'Total hard.'}</span></span>
                  </div>
                  <p className={`mt-3 text-xs font-semibold ${copy.tone}`}>{copy.label} · {output.result.confidence === 'detailed' ? 'detailed' : 'estimated'}</p>
                  {(output.assumedTemperature || output.assumedTds) && (
                    <p className="mt-1 text-[0.6875rem] text-ink-muted">
                      Estimated inputs: {[
                        output.assumedTemperature ? `${output.assumedTemperature}°F water` : null,
                        output.assumedTds ? `${output.assumedTds.toLocaleString()} ppm TDS` : null,
                      ].filter(Boolean).join(' · ')}.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-3 rounded-control bg-surface-2 px-3 py-2 text-xs leading-5 text-ink-muted">
                  Missing {output.missing.join(', ')}. This visit is not assigned an LSI value.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

export default function LsiDashboard() {
  const customers = useCustomers() || [];
  const logs = useServiceLogs('-service_date') || [];
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const customerId = Number(searchParams.get('customerId'));
  const customer = customers.find((item) => item._id === customerId);

  const selectCustomer = (id) => navigate(`${APP_ROUTES.LSI}?customerId=${encodeURIComponent(id)}`);
  const showOverview = () => navigate(APP_ROUTES.LSI);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-4 sm:px-6 lg:px-8">
      <section className="mb-5 rounded-sheet border border-line bg-surface-1 p-5 shadow-card" aria-labelledby="lsi-page-title">
        <div className="flex items-start gap-3">
          <IconBadge name="lsi" size="md" />
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-brand-ink">Water balance</p>
            <h1 id="lsi-page-title" className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-ink">LSI history</h1>
            <p className="mt-1 text-sm leading-5 text-ink-secondary">
              {customer ? customer.full_name : 'Choose a customer to review the balance of every logged visit.'}
            </p>
          </div>
        </div>
      </section>

      {customer
        ? <VisitHistory customer={customer} logs={logs} onBack={showOverview} />
        : <CustomerOverview customers={customers} logs={logs} onSelect={selectCustomer} />}

      <p className="mx-auto mt-5 max-w-xl text-center text-[0.6875rem] leading-5 text-ink-muted">
        LSI is a water-balance indicator, not a chemical dosing instruction. Estimated results use total hardness and/or an assumed TDS; detailed results use measured calcium hardness and TDS.
      </p>
    </main>
  );
}
