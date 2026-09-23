import { useMemo, useState } from 'react';
import { ChevronDown, Gauge, Info, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { calculateServiceLogLsi, formatLsi } from '@/lib/lsi';

function ReadingInput({ id, label, value, onChange, unit, min, max, step = 1, hint }) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs font-semibold text-ink-secondary">{label}</Label>
      <div className="relative mt-1.5">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 rounded-control border-line bg-surface-1 pr-12 font-data text-sm"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.6875rem] font-semibold text-ink-muted">
          {unit}
        </span>
      </div>
      {hint && <p className="mt-1 text-[0.6875rem] leading-4 text-ink-muted">{hint}</p>}
    </div>
  );
}

const resultTone = {
  aggressive: 'border-[var(--status-action-line)] bg-[var(--status-action-soft)] text-action',
  balanced: 'border-[var(--status-ok-line)] bg-[var(--status-ok-soft)] text-ok',
  'scale-forming': 'border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] text-watch',
};

const resultLabel = {
  aggressive: 'Aggressive',
  balanced: 'Balanced',
  'scale-forming': 'Scale-forming',
};

export default function LsiReadingFields({ formData, setFormData }) {
  const active = Boolean(formData.hardness_source);
  const [showDetailed, setShowDetailed] = useState(false);
  const lsiOutput = useMemo(() => calculateServiceLogLsi({
    ph_value: formData.ph_value === '' ? undefined : Number(formData.ph_value),
    alkalinity_value: formData.alkalinity_value === '' ? undefined : Number(formData.alkalinity_value),
    stabilizer_value: formData.stabilizer_value === '' ? undefined : Number(formData.stabilizer_value),
    hardness_value: formData.hardness_value === '' ? undefined : Number(formData.hardness_value),
    hardness_source: formData.hardness_source || undefined,
    water_temperature: formData.water_temperature === '' ? undefined : Number(formData.water_temperature),
    water_temperature_source: formData.water_temperature_source || undefined,
    tds_value: formData.tds_value === '' ? undefined : Number(formData.tds_value),
    tds_source: formData.tds_source || undefined,
    salt: formData.salt === '' ? undefined : Number(formData.salt),
    strip_scan_method: formData.strip_scan_method || undefined,
  }), [formData]);

  const chooseMode = (mode) => {
    setFormData((current) => ({
      ...current,
      hardness_source: mode,
      ph_mode: 'numeric',
      alkalinity_mode: 'numeric',
      stabilizer_mode: 'numeric',
    }));
  };

  const update = (field, value, sourceField) => setFormData((current) => ({
    ...current,
    [field]: value,
    ...(sourceField ? { [sourceField]: value === '' ? '' : 'measured' } : {}),
  }));

  if (!showDetailed) {
    return (
      <button
        type="button"
        onClick={() => setShowDetailed(true)}
        aria-expanded="false"
        aria-controls="lsi-readings-panel"
        className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-control text-xs font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink-secondary"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {active ? 'Adjust LSI details' : 'Enter detailed LSI readings'}
      </button>
    );
  }

  return (
    <section id="lsi-readings-panel" className="mt-4 overflow-hidden rounded-raised border border-line bg-surface-2" aria-labelledby="lsi-readings-title">
      <div className="p-4">
        <button
          type="button"
          onClick={() => setShowDetailed(false)}
          aria-expanded="true"
          aria-controls="lsi-readings-panel"
          aria-label="Collapse LSI details"
          className="flex min-h-11 w-full items-start gap-3 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
            <Gauge className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h4 id="lsi-readings-title" className="text-sm font-semibold text-ink">LSI readings</h4>
            <p className="mt-0.5 text-xs leading-5 text-ink-muted">
              Finish the balance calculation or enter a detailed drop-test result.
            </p>
          </div>
          <ChevronDown className="mt-2 h-4 w-4 shrink-0 rotate-180 text-ink-muted" aria-hidden="true" />
        </button>

        <fieldset className="mt-3 grid grid-cols-3 rounded-full bg-surface-2 p-1" aria-label="LSI testing method">
          {[
            ['off', 'Not logged'],
            ['aquachek_total', 'AquaChek 7'],
            ['calcium', 'Detailed'],
          ].map(([value, label]) => {
            const selected = (formData.hardness_source || 'off') === value;
            return (
              <label
                key={value}
                className={`relative flex min-h-11 cursor-pointer items-center justify-center rounded-full px-2 text-center text-xs font-semibold transition-colors ${selected ? 'bg-surface-1 text-ink shadow-sm' : 'text-ink-muted hover:text-ink-secondary'}`}
              >
                <input
                  type="radio"
                  name="lsi-testing-method"
                  value={value}
                  checked={selected}
                  onChange={() => value === 'off'
                    ? setFormData((current) => ({ ...current, hardness_source: '', hardness_value: '' }))
                    : chooseMode(value)}
                  className="sr-only"
                />
                {label}
              </label>
            );
          })}
        </fieldset>
      </div>

      {active && (
        <div className="border-t border-line bg-surface-1 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ReadingInput
              id="lsi-hardness"
              label={formData.hardness_source === 'calcium' ? 'Calcium hardness' : 'Total hardness'}
              value={formData.hardness_value}
              onChange={(value) => update('hardness_value', value)}
              unit="ppm"
              min={0}
              max={formData.hardness_source === 'calcium' ? 2000 : 1000}
              hint={formData.hardness_source === 'aquachek_total' ? 'AquaChek range: 0–1,000 ppm' : 'Use a calcium-hardness test result'}
            />
            <ReadingInput
              id="lsi-temperature"
              label="Water temperature"
              value={formData.water_temperature}
              onChange={(value) => update('water_temperature', value, 'water_temperature_source')}
              unit="°F"
              min={32}
              max={140}
              hint="Measured at this visit"
            />
            <ReadingInput
              id="lsi-tds"
              label="Total dissolved solids"
              value={formData.tds_value}
              onChange={(value) => update('tds_value', value, 'tds_source')}
              unit="ppm"
              min={1}
              max={20000}
              hint={formData.hardness_source === 'calcium' ? 'Required for detailed confidence' : 'Optional; estimated when blank'}
            />
          </div>

          {lsiOutput.result ? (
            <div className={`mt-4 flex items-center justify-between gap-3 rounded-control border px-3 py-2.5 ${resultTone[lsiOutput.result.status]}`} role="status">
              <div>
                <p className="text-xs font-semibold">{resultLabel[lsiOutput.result.status]}</p>
                <p className="mt-0.5 text-[0.6875rem] opacity-80">
                  {lsiOutput.result.confidence === 'detailed' ? 'Detailed calculation' : 'Estimated calculation'}
                  {lsiOutput.assumedTemperature ? ` · assumes ${lsiOutput.assumedTemperature}°F water` : ''}
                  {lsiOutput.assumedTds ? ` · assumes ${lsiOutput.assumedTds.toLocaleString()} ppm TDS` : ''}
                </p>
              </div>
              <span className="font-data text-xl font-semibold tabular-nums">{formatLsi(lsiOutput.result.value)}</span>
            </div>
          ) : (
            <div className="mt-4 flex items-start gap-2 rounded-control bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                Complete {lsiOutput.missing.join(', ')} to calculate this visit. The LSI dashboard will keep the visit visible until then.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
