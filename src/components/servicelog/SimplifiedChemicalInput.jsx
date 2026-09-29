import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CheckCircle2, AlertTriangle, AlertCircle, XCircle, MinusCircle } from "lucide-react";
import { mapNumericValueToStatus } from "@/lib/chemStatus";

/**
 * Quick levels — tones come from the semantic ramp (index.css), so the
 * logging form, the route chips, and the analysis panel always agree on
 * what a status looks like. "Not tested" is deliberately neutral: it is the
 * default for a new log so an untested chemical is never saved as "good".
 */
const levels = [
  { value: "not_tested", label: "Not tested", icon: MinusCircle, bg: "bg-surface-2", border: "border-[var(--ink-muted)]", text: "text-ink-secondary" },
  { value: "low", label: "Low", icon: AlertTriangle, bg: "bg-[var(--status-watch-soft)]", border: "border-[var(--status-watch-line)]", text: "text-watch" },
  { value: "good", label: "Good", icon: CheckCircle2, bg: "bg-[var(--status-ok-soft)]", border: "border-[var(--status-ok-line)]", text: "text-ok" },
  { value: "high", label: "High", icon: AlertCircle, bg: "bg-[var(--status-action-soft)]", border: "border-[var(--status-action-line)]", text: "text-action" },
  { value: "critical", label: "Critical", icon: XCircle, bg: "bg-[var(--status-critical-soft)]", border: "border-[var(--status-critical-line)]", text: "text-critical" }
];

export { mapNumericValueToStatus };

export default function SimplifiedChemicalInput({
  label,
  value,
  onChange,
  icon,
  mode = "quick",
  onModeChange,
  numericValue,
  onNumericValueChange,
  config,
  testId,
}) {
  // Ideal-range values (config.min/max) are for status display only. The
  // input itself accepts any physically plausible reading: out-of-range
  // readings are exactly the ones a tech must be able to record.
  const { inputMin = 0, inputMax, unit, hint, ranges } = config || {};

  const handleNumericChange = (e) => {
    const raw = e.target.value;
    const nextValue = raw === "" ? undefined : raw;
    onNumericValueChange?.(nextValue);
    // Clearing the reading means nothing was measured — don't leave a stale
    // derived status (e.g. "good") behind.
    const derivedStatus = nextValue === undefined
      ? "not_tested"
      : mapNumericValueToStatus(nextValue, ranges);
    if (derivedStatus && derivedStatus !== value) {
      onChange?.(derivedStatus);
    }
  };

  return (
    <div className="rounded-raised border border-line bg-surface-1 p-3 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 pt-2">
          {icon && <div className="text-info">{icon}</div>}
          <Label className="text-sm font-semibold text-ink">{label}</Label>
        </div>
        <SegmentedControl
          ariaLabel={`${label} entry mode`}
          size="sm"
          fullWidth={false}
          value={mode}
          onChange={(next) => onModeChange?.(next)}
          options={[
            { value: "quick", label: "Quick" },
            { value: "numeric", label: "Numeric" },
          ]}
        />
      </div>

      {mode === "numeric" ? (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              min={inputMin}
              max={inputMax}
              step="any"
              value={numericValue ?? ""}
              onChange={handleNumericChange}
              placeholder={hint || label}
              className="h-12 rounded-card border border-line bg-surface-1 pr-12 font-data text-base focus:border-ring"
              data-testid={testId}
            />
            {unit && (
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-muted">
                {unit}
              </span>
            )}
          </div>
          {hint && (
            <p className="text-xs font-medium text-ink-muted">{hint}</p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <div className="grid grid-cols-5 gap-1.5">
            {levels.map((level) => {
              const Icon = level.icon;
              const isSelected = value === level.value;
              return (
                <button
                  key={level.value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onChange(level.value)}
                  className={`min-h-11 rounded-control border p-2.5 text-left transition-colors duration-150 active:scale-[0.98] ${
                    isSelected
                      ? `${level.bg} ${level.border} shadow-sm`
                      : "border-line bg-surface-1 hover:border-[var(--status-info-line)] hover:bg-brand-softer"
                  }`}
                >
                  <Icon className={`mb-1.5 h-4 w-4 ${isSelected ? level.text : "text-ink-muted"}`} aria-hidden="true" />
                  <span className={`block text-xs font-semibold leading-tight ${isSelected ? level.text : "text-ink-secondary"}`}>
                    {level.label}
                  </span>
                </button>
              );
            })}
          </div>
          {hint && (
            <p className="mt-2 text-xs font-medium text-ink-muted">{hint}</p>
          )}
          {value === "critical" && (
            <p className="mt-1 text-xs font-medium text-critical" role="note">
              Switch to Numeric and enter the reading so dosing advice knows whether to raise or lower it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
