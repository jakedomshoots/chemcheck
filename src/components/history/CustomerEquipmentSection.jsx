import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useEquipmentByPool,
  useEquipmentCreate,
  useEquipmentUpdate,
  usePoolCreate,
  usePoolsByCustomer,
} from "@/api/normalizedHooks";
import { detectFilterKind, selectActivePool } from "@/api/equipmentHooks";

export const EQUIPMENT_SECTION_ID = "equipment";

/**
 * Select options. Filters are stored as equipment_type "filter" with the kind
 * carried in the name (same convention as the Notes filter-maintenance card),
 * so classifyEquipment() and the stop checklist can tell them apart.
 */
export const EQUIPMENT_TYPE_OPTIONS = [
  { value: "filter:cartridge", label: "Filter — cartridge", equipment_type: "filter", kindLabel: "Cartridge" },
  { value: "filter:de", label: "Filter — D.E.", equipment_type: "filter", kindLabel: "D.E." },
  { value: "filter:sand", label: "Filter — sand", equipment_type: "filter", kindLabel: "Sand" },
  { value: "pump", label: "Pump", equipment_type: "pump" },
  { value: "heater", label: "Heater", equipment_type: "heater" },
  { value: "salt cell", label: "Salt cell", equipment_type: "salt cell" },
  { value: "automation", label: "Automation", equipment_type: "automation" },
  { value: "other", label: "Other", equipment_type: "other" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "needs service", label: "Needs service" },
  { value: "retired", label: "Retired" },
];

const FILTER_KIND_TO_OPTION = { cartridge: "filter:cartridge", de: "filter:de", sand: "filter:sand" };

export function optionForEquipment(item) {
  const type = String(item?.equipment_type || "").toLowerCase();
  if (type === "filter") {
    return FILTER_KIND_TO_OPTION[detectFilterKind(item)] || "other";
  }
  const match = EQUIPMENT_TYPE_OPTIONS.find((option) => option.equipment_type === type);
  return match ? match.value : "other";
}

/** Maps form state to the stored equipment fields. */
export function toEquipmentRecord(form) {
  const option = EQUIPMENT_TYPE_OPTIONS.find((entry) => entry.value === form.type) || EQUIPMENT_TYPE_OPTIONS[EQUIPMENT_TYPE_OPTIONS.length - 1];
  const typed = form.name.trim();
  let name = typed;
  if (option.kindLabel) {
    const kind = detectFilterKind({ equipment_type: "filter", name: typed });
    const expected = FILTER_KIND_TO_OPTION[kind] === option.value;
    if (!typed) name = `${option.kindLabel} filter`;
    else if (!expected) name = `${option.kindLabel} filter (${typed})`;
  } else if (!typed) {
    name = option.label;
  }
  return {
    equipment_type: option.equipment_type,
    name,
    brand: form.brand.trim() || undefined,
    model: form.model.trim() || undefined,
    install_date: form.install_date || undefined,
    notes: form.notes.trim() || undefined,
    status: form.status || "active",
  };
}

const EMPTY_FORM = { type: "filter:cartridge", name: "", brand: "", model: "", install_date: "", notes: "", status: "active" };

function formFromEquipment(item) {
  return {
    type: optionForEquipment(item),
    name: item.name || "",
    brand: item.brand || "",
    model: item.model || "",
    install_date: item.install_date || "",
    notes: item.notes || "",
    status: item.status || "active",
  };
}

function typeLabel(item) {
  const option = EQUIPMENT_TYPE_OPTIONS.find((entry) => entry.value === optionForEquipment(item));
  return option ? option.label : item.equipment_type;
}

const fieldClass = "mt-1 h-11 w-full rounded-control border border-line bg-surface-1 px-3 text-sm text-ink focus:border-ring focus:outline-none";

function EquipmentForm({ initial, onSubmit, onCancel, saving, idPrefix }) {
  const [form, setForm] = useState(initial);
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}
      className="mt-3 space-y-3 rounded-raised border border-line bg-surface-2 p-3"
      aria-label={initial.id ? "Edit equipment" : "Add equipment"}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idPrefix}-type`} className="text-xs font-semibold text-ink-secondary">Type *</Label>
          <select id={`${idPrefix}-type`} value={form.type} onChange={set("type")} className={fieldClass} required>
            {EQUIPMENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-name`} className="text-xs font-semibold text-ink-secondary">Name</Label>
          <Input id={`${idPrefix}-name`} value={form.name} onChange={set("name")} placeholder="e.g. Clean & Clear Plus" className={fieldClass} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-brand`} className="text-xs font-semibold text-ink-secondary">Brand</Label>
          <Input id={`${idPrefix}-brand`} value={form.brand} onChange={set("brand")} placeholder="Pentair" className={fieldClass} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-model`} className="text-xs font-semibold text-ink-secondary">Model</Label>
          <Input id={`${idPrefix}-model`} value={form.model} onChange={set("model")} placeholder="CCP420" className={fieldClass} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-install`} className="text-xs font-semibold text-ink-secondary">Install date</Label>
          <Input id={`${idPrefix}-install`} type="date" value={form.install_date} onChange={set("install_date")} className={fieldClass} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-status`} className="text-xs font-semibold text-ink-secondary">Status</Label>
          <select id={`${idPrefix}-status`} value={form.status} onChange={set("status")} className={fieldClass}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-notes`} className="text-xs font-semibold text-ink-secondary">Notes</Label>
        <Textarea id={`${idPrefix}-notes`} value={form.notes} onChange={set("notes")} rows={2} placeholder="Serial, size, quirks…" className="mt-1 rounded-control border border-line bg-surface-1 text-sm" />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving} className="h-11 flex-1 rounded-control border-line">
          Cancel
        </Button>
        <Button type="submit" disabled={saving} className="h-11 flex-1 rounded-control bg-brand text-white hover:bg-brand-strong">
          {saving ? "Saving…" : initial.id ? "Save changes" : "Add equipment"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Equipment on the customer's active pool with inline add/edit. Creates a
 * default pool first when the customer has none. Deep-linkable via
 * `#equipment` (the service log's "add equipment" link lands here).
 */
export default function CustomerEquipmentSection({ customer }) {
  const customerId = Number(customer?._id ?? customer?.id) || undefined;
  const pools = usePoolsByCustomer(customerId);
  const pool = useMemo(() => selectActivePool(pools), [pools]);
  const equipment = useEquipmentByPool(pool?.id);
  const createPool = usePoolCreate();
  const createEquipment = useEquipmentCreate();
  const updateEquipment = useEquipmentUpdate();

  const [mode, setMode] = useState(null); // null | "add" | { id }
  const [saving, setSaving] = useState(false);
  const sectionRef = useRef(null);

  const wantsFocus = typeof window !== "undefined" && window.location.hash === `#${EQUIPMENT_SECTION_ID}`;
  useEffect(() => {
    if (!wantsFocus || !sectionRef.current) return;
    sectionRef.current.scrollIntoView?.({ block: "start", behavior: "smooth" });
    if (equipment.length === 0) setMode("add");
    // Only on first mount: the hash is a one-time instruction.
  }, []);

  const ensurePool = async () => {
    if (pool?.id) return pool.id;
    return createPool({
      customer_id: customerId,
      name: "Main pool",
      service_day: customer?.service_day || "Monday",
      pool_type: customer?.pool_type || "Chlorine",
      surface_type: customer?.surface_type || "Plaster",
      pool_gallons: customer?.pool_gallons,
      sort_order: 0,
      active: true,
    });
  };

  const handleSubmit = async (form) => {
    if (!customerId) return;
    setSaving(true);
    try {
      const record = toEquipmentRecord(form);
      if (mode && mode.id) {
        await updateEquipment(mode.id, record);
        toast.success("Equipment updated");
      } else {
        const poolId = await ensurePool();
        await createEquipment({ ...record, customer_id: customerId, pool_id: poolId });
        toast.success("Equipment added");
      }
      setMode(null);
    } catch (error) {
      console.error("[CustomerEquipmentSection] Could not save equipment:", error);
      toast.error("Could not save equipment. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const sorted = useMemo(() => [...equipment].sort((a, b) => {
    const retiredA = String(a.status).toLowerCase() === "retired";
    const retiredB = String(b.status).toLowerCase() === "retired";
    if (retiredA !== retiredB) return retiredA ? 1 : -1;
    return String(a.name).localeCompare(String(b.name));
  }), [equipment]);

  return (
    <section
      id={EQUIPMENT_SECTION_ID}
      ref={sectionRef}
      aria-labelledby="customer-equipment-title"
      data-testid="customer-equipment"
      className="mb-4 scroll-mt-4 rounded-sheet border border-line bg-surface-1 p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">Pool equipment</p>
          <h3 id="customer-equipment-title" className="mt-1 text-lg font-semibold tracking-[-0.025em] text-ink">Equipment</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {pool ? `${pool.name} · ` : "No pool on file yet · "}
            {sorted.length === 0 ? "nothing recorded" : `${sorted.length} item${sorted.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {mode !== "add" && (
          <Button
            type="button"
            size="sm"
            onClick={() => setMode("add")}
            className="h-11 shrink-0 rounded-full bg-brand px-4 text-xs font-semibold text-white shadow-cta hover:bg-brand-strong"
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Add equipment
          </Button>
        )}
      </div>

      {mode === "add" && (
        <EquipmentForm initial={EMPTY_FORM} onSubmit={handleSubmit} onCancel={() => setMode(null)} saving={saving} idPrefix="equipment-new" />
      )}

      {sorted.length === 0 && mode !== "add" ? (
        <p className="mt-3 flex items-center gap-2 rounded-control bg-surface-2 px-3 py-3 text-sm text-ink-muted">
          <Wrench className="h-4 w-4" aria-hidden="true" />
          Add the filter, pump, heater or salt cell so the service log can tailor its checklist.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-raised border border-line" aria-label="Equipment list">
          {sorted.map((item) => {
            const editing = mode && mode.id === item.id;
            const retired = String(item.status).toLowerCase() === "retired";
            return (
              <li key={item.id} className={`px-3 py-2.5 ${retired ? "bg-surface-2" : "bg-surface-1"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${retired ? "text-ink-muted line-through" : "text-ink"}`}>{item.name}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {typeLabel(item)}
                      {item.brand || item.model ? ` · ${[item.brand, item.model].filter(Boolean).join(" ")}` : ""}
                      {item.install_date ? ` · installed ${item.install_date}` : ""}
                    </p>
                    {item.notes && <p className="mt-1 text-xs leading-5 text-ink-secondary">{item.notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${retired
                      ? "bg-surface-2 text-ink-muted"
                      : String(item.status).toLowerCase() === "needs service"
                        ? "bg-[var(--status-watch-soft)] text-watch"
                        : "bg-[var(--status-ok-soft)] text-ok"}`}
                    >
                      {item.status || "active"}
                    </span>
                    {!editing && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setMode({ id: item.id })}
                        aria-label={`Edit ${item.name}`}
                        className="h-11 w-11 rounded-full p-0 text-ink-secondary hover:bg-surface-2"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>
                {editing && (
                  <EquipmentForm
                    initial={{ ...formFromEquipment(item), id: item.id }}
                    onSubmit={handleSubmit}
                    onCancel={() => setMode(null)}
                    saving={saving}
                    idPrefix={`equipment-${item.id}`}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
