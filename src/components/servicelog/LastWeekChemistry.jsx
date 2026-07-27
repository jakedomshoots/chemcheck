import { chemToneClasses } from '@/lib/chemStatus';
import { formatServiceDate } from '@/utils';

const chemistryFields = [
  { key: 'ph', numericKey: 'ph_value', label: 'pH', fullLabel: 'pH', unit: '' },
  { key: 'chlorine', numericKey: 'chlorine_value', label: 'Cl', fullLabel: 'Chlorine', unit: 'ppm' },
  { key: 'alkalinity', numericKey: 'alkalinity_value', label: 'Alk', fullLabel: 'Alkalinity', unit: 'ppm' },
  { key: 'stabilizer', numericKey: 'stabilizer_value', label: 'CYA', fullLabel: 'Stabilizer', unit: 'ppm' },
];

function getReading(log, field) {
  const rawNumericValue = log?.[field.numericKey];
  const hasNumericValue = rawNumericValue !== null
    && rawNumericValue !== undefined
    && rawNumericValue !== ''
    && Number.isFinite(Number(rawNumericValue));
  const sourceValue = hasNumericValue ? Number(rawNumericValue) : log?.[field.key];

  if (sourceValue === null || sourceValue === undefined || sourceValue === '') return null;

  const displayValue = hasNumericValue
    ? String(sourceValue)
    : String(sourceValue).replace(/^./, (character) => character.toUpperCase());

  return {
    ...field,
    displayValue,
    sourceValue,
    displayUnit: hasNumericValue ? field.unit : '',
    toneClassName: chemToneClasses(field.key, sourceValue),
  };
}

export default function LastWeekChemistry({ log }) {
  const readings = chemistryFields.map((field) => getReading(log, field));
  const hasReadings = readings.some(Boolean);
  const serviceDate = log?.service_date ? formatServiceDate(log.service_date) : '';

  return (
    <section
      data-testid="last-week-chemistry"
      aria-label="Last week's chemistry"
      className="mt-3"
    >
      {log && hasReadings ? (
        <>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-ink-muted">
              Last week
            </span>
            {serviceDate && (
              <span className="text-[0.6875rem] font-medium tabular-nums text-ink-muted">
                {serviceDate}
              </span>
            )}
          </div>
          <dl className="grid grid-cols-4 overflow-hidden rounded-control border border-line bg-surface-2">
            {readings.map((reading, index) => (
              <div
                key={chemistryFields[index].key}
                data-testid={`last-week-${chemistryFields[index].key}`}
                className={`flex min-w-0 flex-col items-center gap-1 px-1.5 py-2 ${index > 0 ? 'border-l border-line' : ''}`}
              >
                <dt
                  className="text-[0.625rem] font-semibold text-ink-muted"
                  title={chemistryFields[index].fullLabel}
                >
                  {chemistryFields[index].label}
                </dt>
                {reading ? (
                  <dd
                    data-testid={`last-week-${reading.key}-value`}
                    title={`${reading.fullLabel}: ${reading.displayValue}${reading.displayUnit ? ` ${reading.displayUnit}` : ''}`}
                    className={`inline-flex min-h-6 max-w-full items-center justify-center rounded-chip border px-1.5 text-xs font-semibold ${reading.toneClassName}`}
                  >
                    <span className="truncate font-data">{reading.displayValue}</span>
                    {reading.displayUnit && (
                      <span className="ml-0.5 text-[0.5rem] font-semibold uppercase opacity-75">
                        {reading.displayUnit}
                      </span>
                    )}
                  </dd>
                ) : (
                  <dd className="font-data text-sm font-semibold text-ink-muted">—</dd>
                )}
              </div>
            ))}
          </dl>
        </>
      ) : (
        <div className="flex min-h-10 items-center justify-between gap-3 rounded-control border border-line bg-surface-2 px-3 py-2">
          <span className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-ink-muted">
            Last week
          </span>
          <span className="truncate text-xs font-medium text-ink-muted">No readings recorded</span>
        </div>
      )}
    </section>
  );
}
