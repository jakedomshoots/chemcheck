import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, Flame, Plus, Waves, Zap } from "lucide-react";
import { APP_ROUTES } from "@/lib/routeConfig";
import { buildStopChecklist } from "@/api/equipmentHooks";

const FILTER_KIND_LABEL = {
  cartridge: "Cartridge filter",
  de: "D.E. filter",
  sand: "Sand filter",
  unknown: "Filter",
};

function Chip({ icon: Icon, label, detail }) {
  return (
    <li className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface-1 px-3 py-1 text-xs font-semibold text-ink-secondary">
      <Icon className="h-3.5 w-3.5 text-brand-ink" aria-hidden="true" />
      <span>{label}</span>
      {detail && <span className="font-medium text-ink-muted">· {detail}</span>}
    </li>
  );
}

/**
 * Compact strip of the pool's recorded equipment plus the stop checklist it
 * drives. With no equipment on file it shows a generic list and a one-tap
 * link to the client page where equipment is added.
 *
 * Props:
 *  - customerId: number | string
 *  - pool: active pool record (or null)
 *  - classification: result of classifyEquipment()
 *  - poolType: customer or pool type ("Salt" | "Chlorine")
 */
export default function EquipmentStrip({ customerId, pool, classification, poolType }) {
  const tasks = useMemo(
    () => buildStopChecklist({ classification, poolType }),
    [classification, poolType],
  );
  const [done, setDone] = useState({});
  const completed = tasks.filter((task) => done[task.id]).length;

  const chips = [];
  if (classification?.filter) {
    chips.push({ key: "filter", icon: Filter, label: FILTER_KIND_LABEL[classification.filterKind] || "Filter", detail: classification.filter.model || classification.filter.name });
  }
  if (classification?.saltCell) {
    chips.push({ key: "salt", icon: Zap, label: "Salt cell", detail: classification.saltCell.model || classification.saltCell.name });
  }
  if (classification?.heater) {
    chips.push({ key: "heater", icon: Flame, label: "Heater", detail: classification.heater.model || classification.heater.name });
  }
  if (classification?.pump) {
    chips.push({ key: "pump", icon: Waves, label: "Pump", detail: classification.pump.model || classification.pump.name });
  }
  for (const item of classification?.other || []) {
    chips.push({ key: `other-${item.id ?? item.name}`, icon: Plus, label: item.name, detail: item.equipment_type });
  }

  const addEquipmentHref = `${APP_ROUTES.CustomerDetail}?id=${encodeURIComponent(customerId ?? "")}#equipment`;

  return (
    <section aria-labelledby="equipment-strip-title" data-testid="equipment-strip" className="mb-5 rounded-sheet border border-line bg-surface-1 p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="equipment-strip-title" className="text-lg font-semibold tracking-[-0.025em] text-ink">
            Equipment &amp; stop checklist
          </h3>
          <p className="mt-1 text-sm font-medium text-ink-secondary">
            {pool?.name ? `${pool.name} · ` : ""}
            {chips.length > 0
              ? `${chips.length} item${chips.length === 1 ? "" : "s"} on file`
              : "No equipment recorded yet"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 font-data text-xs font-semibold tabular-nums text-ink-secondary" aria-live="polite">
          {completed}/{tasks.length} done
        </span>
      </div>

      {chips.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Recorded equipment">
          {chips.map((chip) => <Chip key={chip.key} icon={chip.icon} label={chip.label} detail={chip.detail} />)}
        </ul>
      ) : (
        <Link
          to={addEquipmentHref}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-control border border-dashed border-line px-3 text-sm font-semibold text-brand-ink hover:bg-brand-softer"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add equipment on the client page
        </Link>
      )}

      <ul className="mt-4 divide-y divide-line rounded-raised border border-line" aria-label="Stop checklist">
        {tasks.map((task) => {
          const checked = !!done[task.id];
          const inputId = `stop-task-${task.id}`;
          return (
            <li key={task.id} className={checked ? "bg-surface-2" : "bg-surface-1"}>
              <label htmlFor={inputId} className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center pt-0.5">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => setDone((current) => ({ ...current, [task.id]: event.target.checked }))}
                    className="h-5 w-5 rounded border-line accent-[var(--brand)]"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-semibold ${checked ? "text-ink-muted line-through" : "text-ink"}`}>{task.label}</span>
                  {task.detail && <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{task.detail}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
