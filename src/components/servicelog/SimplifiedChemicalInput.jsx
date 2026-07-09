import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckCircle2, AlertTriangle, AlertCircle, XCircle } from "lucide-react";

const levels = [
  { value: "low", label: "Low", color: "from-yellow-400 to-orange-500", icon: AlertTriangle, bg: "bg-yellow-50/80", border: "border-yellow-300", text: "text-yellow-700" },
  { value: "good", label: "Good", color: "from-emerald-400 to-green-500", icon: CheckCircle2, bg: "bg-emerald-50/80", border: "border-emerald-300", text: "text-emerald-700" },
  { value: "high", label: "High", color: "from-orange-400 to-red-500", icon: AlertCircle, bg: "bg-orange-50/80", border: "border-orange-300", text: "text-orange-700" },
  { value: "critical", label: "Critical", color: "from-red-500 to-red-700", icon: XCircle, bg: "bg-red-50/80", border: "border-red-300", text: "text-red-700" }
];

/**
 * Map a numeric reading to a status badge based on configured ranges.
 * Returns undefined if the value cannot be parsed or no range matches.
 */
export function mapNumericValueToStatus(value, ranges) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const num = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(num)) {
    return undefined;
  }
  for (const range of ranges) {
    if (num >= range.min && num < range.max) {
      return range.status;
    }
  }
  return undefined;
}

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
  const { min, max, step, unit, hint, ranges } = config || {};

  const handleNumericChange = (e) => {
    const raw = e.target.value;
    const nextValue = raw === "" ? undefined : raw;
    onNumericValueChange?.(nextValue);
    const derivedStatus = mapNumericValueToStatus(nextValue, ranges);
    if (derivedStatus && derivedStatus !== value) {
      onChange?.(derivedStatus);
    }
  };

  return (
    <div className="rounded-[1.25rem] border border-slate-200/70 bg-white/80 p-3 shadow-[0_14px_44px_-36px_rgba(8,47,73,0.75)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon && <div className="text-cyan-700">{icon}</div>}
          <Label className="text-sm font-semibold text-slate-800">{label}</Label>
        </div>
        <div className="grid shrink-0 grid-cols-2 rounded-full bg-slate-100/90 p-1">
          <button
            type="button"
            onClick={() => onModeChange?.("quick")}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              mode === "quick"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Quick
          </button>
          <button
            type="button"
            onClick={() => onModeChange?.("numeric")}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              mode === "numeric"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Numeric
          </button>
        </div>
      </div>

      {mode === "numeric" ? (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              min={min}
              max={max}
              step={step}
              value={numericValue ?? ""}
              onChange={handleNumericChange}
              placeholder={hint || label}
              className="h-12 rounded-2xl border border-slate-200 bg-white pr-12 text-base focus:border-cyan-500"
              data-testid={testId}
            />
            {unit && (
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                {unit}
              </span>
            )}
          </div>
          {hint && (
            <p className="text-xs font-medium text-slate-500">{hint}</p>
          )}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {levels.map((level) => {
            const Icon = level.icon;
            const isSelected = value === level.value;
            return (
              <button
                key={level.value}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onChange(level.value)}
                className={`rounded-2xl border p-2.5 text-left transition-all duration-200 active:scale-[0.98] ${
                  isSelected
                    ? `${level.bg} ${level.border} shadow-sm ring-1 ring-inset ring-white/70`
                    : "border-slate-200/70 bg-white/70 hover:border-cyan-200 hover:bg-cyan-50/50"
                }`}
              >
                <Icon className={`mb-2 h-4 w-4 ${isSelected ? level.text : "text-slate-400"}`} aria-hidden="true" />
                <span className={`block text-[11px] font-semibold leading-tight ${isSelected ? level.text : "text-slate-600"}`}>
                  {level.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
