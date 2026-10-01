import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Beaker, ClipboardList, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildDosingPlan, hasMinimumReadings } from "@/lib/dosing";

const KIND_TONE = {
  add: "border-line bg-surface-1",
  drain: "border-[var(--status-watch-line)] bg-[var(--status-watch-soft)]",
  wait: "border-[var(--status-info-line)] bg-[var(--status-info-soft)]",
};

function formatTarget(target) {
  const unit = target.unit ? ` ${target.unit}` : "";
  return `${target.min}–${target.max}${unit}`;
}

function lowerLabel(label) {
  return label === "pH" ? label : label.toLowerCase();
}

function formatReading(step) {
  const unit = step.target.unit ? ` ${step.target.unit}` : "";
  return `${step.reading}${unit}`;
}

/**
 * Live dosing plan for this visit. Renders nothing until pH and free
 * chlorine have been entered; updates as readings change.
 *
 * Props:
 *  - readings: { ph_value, chlorine_value, alkalinity_value, stabilizer_value, hardness_value, salt, water_temperature, tds_value }
 *  - poolGallons, poolType, surfaceType, lsi
 *  - onLogChemicals(entries: Array<{ chemical_type, quantity, notes }>) → Promise | void
 *  - logging: boolean (disables the action while a save is in flight)
 */
export default function DosingRecommendations({
  readings,
  poolGallons,
  poolType,
  surfaceType,
  lsi,
  onLogChemicals,
  logging = false,
}) {
  const ready = hasMinimumReadings(readings);
  const plan = useMemo(() => (
    ready ? buildDosingPlan({ readings, poolGallons, poolType, surfaceType, lsi }) : null
  ), [ready, readings, poolGallons, poolType, surfaceType, lsi]);

  const [done, setDone] = useState({});
  const [logged, setLogged] = useState(false);

  // Reset the "logged" confirmation whenever the plan's dose set changes.
  const planSignature = plan
    ? plan.steps.map((step) => `${step.id}:${step.amount?.text ?? ""}`).join("|")
    : "";
  useEffect(() => {
    setLogged(false);
  }, [planSignature]);

  if (!ready || !plan) return null;

  const loggable = plan.steps.filter((step) => step.chemicalUsage);
  const summary = plan.steps.length === 0
    ? "Readings are in range. No chemicals needed this visit."
    : `${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}: ${plan.steps.map((step) => lowerLabel(step.chemicalLabel)).join(", ")}.`;

  const handleLog = async () => {
    if (!onLogChemicals || loggable.length === 0) return;
    await onLogChemicals(loggable.map((step) => ({
      chemical_type: step.chemicalUsage.chemical_type,
      quantity: step.chemicalUsage.quantity,
      notes: `${step.chemicalLabel} ${formatReading(step)} → ${formatTarget(step.target)}. ${step.productLabel}.`,
    })));
    setLogged(true);
  };

  return (
    <section
      aria-labelledby="dosing-title"
      data-testid="dosing-recommendations"
      className="mt-4 overflow-hidden rounded-raised border border-line bg-surface-2"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <Beaker className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 id="dosing-title" className="text-sm font-semibold text-ink">Dosing for this visit</h4>
          <p className="mt-0.5 text-xs leading-5 text-ink-muted" role="status" aria-live="polite" aria-atomic="true">
            {summary}
          </p>
        </div>
      </div>

      {(plan.warnings.length > 0 || plan.missing.length > 0) && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          {plan.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2 text-xs leading-5 text-watch">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </p>
          ))}
          {plan.missing.length > 0 && (
            <p className="flex items-start gap-2 text-xs leading-5 text-ink-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Not dosed (no reading): {plan.missing.join(", ")}.</span>
            </p>
          )}
        </div>
      )}

      {plan.steps.length > 0 && (
        <ol className="space-y-2 border-t border-line bg-surface-1 p-3" aria-label="Dose steps in order">
          {plan.steps.map((step) => {
            const checked = !!done[step.id];
            const inputId = `${step.id}-done`;
            return (
              <li
                key={step.id}
                className={`rounded-control border p-3 transition-opacity ${KIND_TONE[step.kind]} ${checked ? "opacity-60" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <label htmlFor={inputId} className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => setDone((current) => ({ ...current, [step.id]: event.target.checked }))}
                      aria-label={`Done: step ${step.order}, ${step.chemicalLabel}`}
                      className="h-5 w-5 rounded border-line accent-[var(--brand)]"
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h5 className="text-sm font-semibold text-ink">
                        <span className="text-ink-muted">{step.order}.</span>{" "}
                        {step.direction === "raise" ? "Raise" : "Lower"} {lowerLabel(step.chemicalLabel)}
                      </h5>
                      <span className="font-data text-xs font-semibold tabular-nums text-ink-secondary">
                        {formatReading(step)} → {formatTarget(step.target)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ink">
                      {step.amount ? (
                        <>
                          <span className="font-data text-base font-semibold tabular-nums text-brand-ink">{step.amount.text}</span>
                          {" "}<span className="text-ink-secondary">{step.productLabel}</span>
                        </>
                      ) : (
                        <span className="text-ink-secondary">{step.productLabel}</span>
                      )}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-ink-secondary">{step.instructions}</p>
                    {step.wait && <p className="mt-1 text-xs leading-5 text-ink-muted">{step.wait}</p>}
                    <p className="mt-1 text-xs leading-5 text-ink-muted">{step.why}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {plan.notes.length > 0 && (
        <ul className="space-y-1.5 border-t border-line px-4 py-3" aria-label="Safety notes">
          {plan.notes.map((note) => (
            <li key={note} className="text-[0.6875rem] leading-4 text-ink-muted">{note}</li>
          ))}
        </ul>
      )}

      {loggable.length > 0 && onLogChemicals && (
        <div className="border-t border-line p-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleLog}
            disabled={logging || logged}
            className="h-11 w-full rounded-control border-line bg-surface-1 text-sm font-semibold text-ink-secondary hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
          >
            <ClipboardList className="mr-2 h-4 w-4" aria-hidden="true" />
            {logged
              ? "Chemicals logged"
              : logging
                ? "Logging…"
                : `Log these chemicals (${loggable.length})`}
          </Button>
        </div>
      )}
    </section>
  );
}
