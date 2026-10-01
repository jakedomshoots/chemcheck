import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { CANONICAL_UNITS, UNIT_LABELS } from "@/lib/quantityParser";
import { defaultUnitForChemical, formatCurrency } from "@/lib/chemicalCosts";

const SELECT_CLASS = "h-10 w-full rounded-card border border-line bg-surface-1 px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-ring";

function errorMessage(error) {
  return error instanceof Error ? error.message : "Something went wrong";
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function UnitSelect({ id, value, onChange, disabled }) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={SELECT_CLASS}>
      {CANONICAL_UNITS.map((unit) => (
        <option key={unit} value={unit}>per {UNIT_LABELS[unit]}</option>
      ))}
    </select>
  );
}

function PriceRow({ price, canManage, onSave, onRemove }) {
  const [draft, setDraft] = useState({
    unit: price.unit,
    unit_price: String(price.unit_price),
    package_size: price.package_size ?? "",
    package_price: price.package_price ?? "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft({
      unit: price.unit,
      unit_price: String(price.unit_price),
      package_size: price.package_size ?? "",
      package_price: price.package_price ?? "",
    });
  }, [price._id, price.unit, price.unit_price, price.package_size, price.package_price]);

  const dirty =
    draft.unit !== price.unit ||
    Number(draft.unit_price) !== price.unit_price ||
    (toNumber(draft.package_size) ?? undefined) !== (price.package_size ?? undefined) ||
    (toNumber(draft.package_price) ?? undefined) !== (price.package_price ?? undefined);

  const label = price.label || price.chemical_type;
  const idBase = `price-${price._id}`;

  const save = async () => {
    const unitPrice = toNumber(draft.unit_price);
    const packageSize = toNumber(draft.package_size);
    const packagePrice = toNumber(draft.package_price);
    if (unitPrice === undefined || Number.isNaN(unitPrice) || Number.isNaN(packageSize) || Number.isNaN(packagePrice)) {
      toast.error("Enter valid numbers.");
      return;
    }
    setBusy(true);
    try {
      await onSave({ chemical_type: label, unit: draft.unit, unit_price: unitPrice, package_size: packageSize, package_price: packagePrice });
      toast.success(`${label} saved.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-card border border-line bg-surface-1 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{label}</p>
          <p className="text-xs text-ink-muted">{formatCurrency(price.unit_price)} per {UNIT_LABELS[price.unit] ?? price.unit}</p>
        </div>
        {canManage && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Remove ${label}`}
            onClick={() => onRemove(price)}
            className="h-9 w-9 rounded-full p-0 text-ink-muted hover:text-critical"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <Label htmlFor={`${idBase}-unit`} className="mb-1 block text-xs font-medium text-ink-secondary">Unit</Label>
          <UnitSelect id={`${idBase}-unit`} value={draft.unit} onChange={(unit) => setDraft({ ...draft, unit })} disabled={!canManage} />
        </div>
        <div>
          <Label htmlFor={`${idBase}-price`} className="mb-1 block text-xs font-medium text-ink-secondary">Price (USD)</Label>
          <Input id={`${idBase}-price`} type="number" inputMode="decimal" min="0" step="0.01" value={draft.unit_price} disabled={!canManage} onChange={(event) => setDraft({ ...draft, unit_price: event.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${idBase}-pkg-size`} className="mb-1 block text-xs font-medium text-ink-secondary">Package size</Label>
          <Input id={`${idBase}-pkg-size`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="e.g. 40" value={draft.package_size} disabled={!canManage} onChange={(event) => setDraft({ ...draft, package_size: event.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${idBase}-pkg-price`} className="mb-1 block text-xs font-medium text-ink-secondary">Package price</Label>
          <Input id={`${idBase}-pkg-price`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="optional" value={draft.package_price} disabled={!canManage} onChange={(event) => setDraft({ ...draft, package_price: event.target.value })} />
        </div>
      </div>
      {canManage && dirty && (
        <div className="mt-2 flex justify-end">
          <Button type="button" size="sm" disabled={busy} onClick={save} className="h-9 rounded-full bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-strong">
            {busy ? "Saving…" : `Save ${label}`}
          </Button>
        </div>
      )}
    </li>
  );
}

function NewPriceForm({ onSave }) {
  const [form, setForm] = useState({ chemical_type: "", unit: "gal", unit_price: "", package_size: "", package_price: "" });
  const [busy, setBusy] = useState(false);

  const updateName = (chemical_type) => {
    setForm((previous) => ({ ...previous, chemical_type, unit: chemical_type ? defaultUnitForChemical(chemical_type) : previous.unit }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const unitPrice = toNumber(form.unit_price);
    const packageSize = toNumber(form.package_size);
    const packagePrice = toNumber(form.package_price);
    if (!form.chemical_type.trim()) {
      toast.error("Enter a chemical name.");
      return;
    }
    if (unitPrice === undefined || Number.isNaN(unitPrice) || Number.isNaN(packageSize) || Number.isNaN(packagePrice)) {
      toast.error("Enter a valid price.");
      return;
    }
    setBusy(true);
    try {
      await onSave({ chemical_type: form.chemical_type.trim(), unit: form.unit, unit_price: unitPrice, package_size: packageSize, package_price: packagePrice });
      toast.success(`${form.chemical_type.trim()} added.`);
      setForm({ chemical_type: "", unit: "gal", unit_price: "", package_size: "", package_price: "" });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-labelledby="new-price-heading" className="rounded-card border border-dashed border-line bg-surface-2/50 p-3">
      <h4 id="new-price-heading" className="mb-2 text-sm font-semibold text-ink">Add a chemical</h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="col-span-2">
          <Label htmlFor="new-price-name" className="mb-1 block text-xs font-medium text-ink-secondary">Chemical</Label>
          <Input id="new-price-name" placeholder="e.g. Algaecide" value={form.chemical_type} onChange={(event) => updateName(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="new-price-unit" className="mb-1 block text-xs font-medium text-ink-secondary">Unit</Label>
          <UnitSelect id="new-price-unit" value={form.unit} onChange={(unit) => setForm({ ...form, unit })} />
        </div>
        <div>
          <Label htmlFor="new-price-price" className="mb-1 block text-xs font-medium text-ink-secondary">Price (USD)</Label>
          <Input id="new-price-price" type="number" inputMode="decimal" min="0" step="0.01" value={form.unit_price} onChange={(event) => setForm({ ...form, unit_price: event.target.value })} />
        </div>
        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={busy} className="h-10 w-full rounded-full bg-brand text-xs font-semibold text-white hover:bg-brand-strong">
            {busy ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Editable chemical price table for Settings. Owners/admins edit; everyone
 * else sees a read-only list.
 */
export function ChemicalPricingSettings() {
  const data = useQuery(api.chemicalPricing.list);
  const upsert = useMutation(api.chemicalPricing.upsert);
  const remove = useMutation(api.chemicalPricing.remove);
  const seedDefaults = useMutation(api.chemicalPricing.seedDefaults);
  const [seeding, setSeeding] = useState(false);

  const canManage = Boolean(data?.can_manage);
  const prices = data?.prices ?? [];

  const seed = async () => {
    setSeeding(true);
    try {
      const result = await seedDefaults({});
      toast.success(result.inserted > 0 ? `Added ${result.inserted} common chemicals. Edit the placeholder prices.` : "All common chemicals are already listed.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSeeding(false);
    }
  };

  const handleRemove = async (price) => {
    try {
      await remove({ id: price._id });
      toast.success(`${price.label || price.chemical_type} removed.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <section aria-labelledby="chemical-pricing-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="chemical-pricing-heading" className="text-base font-semibold text-ink">Chemical prices</h3>
          <p className="text-sm text-ink-secondary">What you pay per unit. Used to cost every chemical you log.</p>
        </div>
        {canManage && (
          <Button type="button" size="sm" variant="outline" disabled={seeding} onClick={seed} className="h-9 rounded-full border-line bg-surface-1 px-3 text-xs font-semibold text-ink-secondary">
            <RotateCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {seeding ? "Adding…" : "Add common chemicals"}
          </Button>
        )}
      </div>

      {data === undefined && <p className="text-sm text-ink-muted" aria-live="polite">Loading prices…</p>}

      {data && prices.length === 0 && (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-ink-secondary">
          No prices yet. {canManage ? "Add common chemicals to start with placeholder prices, or add your own below." : "Ask the account owner to add prices."}
        </p>
      )}

      {prices.length > 0 && (
        <ul className="space-y-2" aria-label="Chemical prices">
          {prices.map((price) => (
            <PriceRow key={price._id} price={price} canManage={canManage} onSave={(input) => upsert(input)} onRemove={handleRemove} />
          ))}
        </ul>
      )}

      {canManage && <NewPriceForm onSave={(input) => upsert(input)} />}
    </section>
  );
}

export default ChemicalPricingSettings;
