import React from "react";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon && <div className="text-cyan-600">{icon}</div>}
          <Label className="text-sm font-semibold text-slate-700">{label}</Label>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => onModeChange?.("quick")}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              mode === "quick"
                ? "bg-white shadow-sm text-slate-900"
                : "text-slate-600 hover:text-slate-800"
            }`}
          >
            Quick
          </button>
          <button
            type="button"
            onClick={() => onModeChange?.("numeric")}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              mode === "numeric"
                ? "bg-white shadow-sm text-slate-900"
                : "text-slate-600 hover:text-slate-800"
            }`}
          >
            Numeric
          </button>
        </div>
      </div>

      {mode === "numeric" ? (
        <div className="space-y-2">
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
              className="border-2 focus:border-cyan-500 rounded-xl pr-12"
              data-testid={testId}
            />
            {unit && (
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 pointer-events-none">
                {unit}
              </span>
            )}
          </div>
          {hint && (
            <p className="text-xs font-medium text-slate-500">{hint}</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {levels.map((level) => {
            const Icon = level.icon;
            const isSelected = value === level.value;
            return (
              <Card
                key={level.value}
                onClick={() => onChange(level.value)}
                className={`relative overflow-hidden cursor-pointer transition-all duration-300 border-2 p-4 ${
                  isSelected
                    ? `${level.bg} ${level.border} shadow-lg scale-105`
                    : "bg-white/50 border-slate-200/60 hover:border-slate-300 hover:shadow-md hover:bg-white/70"
                }`}
              >
                {isSelected && (
                  <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${level.color}`}></div>
                )}
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${isSelected ? level.bg : "bg-slate-50/50"}`}>
                    <Icon className={`w-5 h-5 ${isSelected ? level.text : "text-slate-400"}`} />
                  </div>
                  <span className={`font-semibold ${isSelected ? level.text : "text-slate-600"}`}>
                    {level.label}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
