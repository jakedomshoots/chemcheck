import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { readableError } from "@/components/work/workFormat";
import { useWorkOffline } from "@/components/work/workHooks";

export const DEFAULT_PRICED_CHEMICALS = [
  "Liquid Chlorine",
  "Chlorine Tablets",
  "Muriatic Acid",
  "Soda Ash",
  "Baking Soda",
  "Calcium Chloride",
  "Stabilizer (CYA)",
  "Algaecide",
  "Clarifier",
  "Salt",
  "Phosphate Remover",
];

function defaultUnit(type) {
  return /liquid|acid|algaecide|clarifier|remover/i.test(type) ? "gal" : "lb";
}

/**
 * Per-unit prices for extra chemicals billed on "per visit + chemicals"
 * recurring billing. Owners and admins can edit; the server enforces it.
 */
export function ChemicalPricesSection({ chemicalTypes }) {
  const prices = useQuery(api.chemicalPrices.list);
  const savePrices = useMutation(api.chemicalPrices.set);
  const offline = useWorkOffline();
  const [rows, setRows] = useState(null);
  const [saving, setSaving] = useState(false);

  const types = useMemo(() => {
    const base = chemicalTypes?.length ? chemicalTypes : DEFAULT_PRICED_CHEMICALS;
    const all = [...base, ...(prices || []).map((p) => p.chemical_type)];
    return Array.from(new Set(all.filter((t) => t && t !== "Other")));
  }, [chemicalTypes, prices]);

  useEffect(() => {
    if (prices === undefined || rows !== null) return;
    const byType = new Map(prices.map((p) => [p.chemical_type, p]));
    setRows(
      types.map((type) => {
        const existing = byType.get(type);
        return {
          chemical_type: type,
          unit: existing?.unit || defaultUnit(type),
          price: existing ? String(existing.price) : "",
        };
      })
    );
  }, [prices, types, rows]);

  const updateRow = (type, patch) =>
    setRows((current) => current.map((r) => (r.chemical_type === type ? { ...r, ...patch } : r)));

  const save = async () => {
    if (saving || !rows) return;
    const payload = rows
      .filter((r) => r.price.trim() !== "")
      .map((r) => ({ chemical_type: r.chemical_type, unit: r.unit.trim() || defaultUnit(r.chemical_type), price: Number(r.price) }));
    if (payload.some((p) => !Number.isFinite(p.price) || p.price < 0)) {
      toast.error("Prices must be numbers of $0 or more.");
      return;
    }
    setSaving(true);
    try {
      await savePrices({ prices: payload });
      toast.success("Chemical prices saved");
    } catch (error) {
      toast.error(readableError(error, "Could not save chemical prices."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="chemical-prices-heading" className="space-y-3 rounded-lg border border-line p-4">
      <div>
        <h3 id="chemical-prices-heading" className="text-base font-semibold text-ink">
          Chemical prices
        </h3>
        <p className="text-sm text-ink-secondary">
          Extra chemicals logged on a visit are billed at these prices on “per visit + chemicals” recurring billing. Owners and admins can edit.
        </p>
      </div>

      {rows === null ? (
        <p className="text-sm text-ink-secondary">Loading prices…</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted" aria-hidden="true">
            <span>Chemical</span>
            <span>Unit</span>
            <span>Price</span>
          </div>
          {rows.map((row, index) => (
            <div key={row.chemical_type} className="grid grid-cols-[1fr_4.5rem_6rem] items-center gap-2">
              <span className="text-sm font-medium text-ink" id={`chem-price-${index}`}>
                {row.chemical_type}
              </span>
              <input
                aria-label={`${row.chemical_type} unit`}
                value={row.unit}
                maxLength={12}
                onChange={(e) => updateRow(row.chemical_type, { unit: e.target.value })}
                className="h-11 w-full rounded-lg border border-line bg-surface-1 px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="relative">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink-muted" aria-hidden="true">
                  $
                </span>
                <input
                  aria-label={`${row.chemical_type} price per unit`}
                  inputMode="decimal"
                  value={row.price}
                  placeholder="0.00"
                  onChange={(e) => updateRow(row.chemical_type, { price: e.target.value.replace(/[^\d.]/g, "") })}
                  className="tnum h-11 w-full rounded-lg border border-line bg-surface-1 pl-5 pr-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          ))}
          <Button type="button" onClick={save} disabled={saving || offline} className="mt-2 h-11 w-full sm:w-auto">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save chemical prices
          </Button>
          {offline && <p className="text-xs text-ink-secondary">You're offline — prices need a connection.</p>}
        </div>
      )}
    </section>
  );
}

export default ChemicalPricesSection;
