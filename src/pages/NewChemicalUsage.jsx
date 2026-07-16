import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCustomersFilter, useChemicalUsageCreate, useCurrentUser } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/navigation/BackButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { toast } from "sonner";

const defaultChemicalTypes = [
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
  "Other"
];

export default function NewChemicalUsage() {
  const navigate = useNavigate();
  // Parse URL params once per URL change, not on every render
  const preselectedCustomerId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("customerId");
    return raw ? parseInt(raw, 10) : null;
  }, [window.location.search]);

  const user = useCurrentUser();
  const allCustomers = useCustomersFilter(user?.email ? { created_by: user.email } : undefined);
  const createChemicalUsage = useChemicalUsageCreate();

  const convexBusiness = useQuery(api.businesses.getCurrent);

  const chemicalTypes = useMemo(() => {
    const settingsTypes = convexBusiness?.settings?.chemical_types;
    if (settingsTypes?.length > 0) {
      return settingsTypes;
    }
    return defaultChemicalTypes;
  }, [convexBusiness?.settings?.chemical_types]);

  const customers = useMemo(() => {
    if (!allCustomers || allCustomers.length === 0) return [];
    return [...allCustomers].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [allCustomers]);

  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    customer_id: preselectedCustomerId || "",
    chemical_type: "",
    quantity: "",
    notes: ""
  });

  // Refs to guard against effect re-runs clobbering user input (causes flicker)
  const prevChemicalTypesRef = useRef(null);
  const didAutoSelectCustomerRef = useRef(false);

  // Only set chemical_type when the available types actually change,
  // not on every Convex re-render. Prevents dropdown flicker.
  useEffect(() => {
    if (chemicalTypes.length === 0) return;
    const changed = !prevChemicalTypesRef.current ||
      prevChemicalTypesRef.current.length !== chemicalTypes.length ||
      prevChemicalTypesRef.current.some((t, i) => t !== chemicalTypes[i]);
    if (!changed) return;
    prevChemicalTypesRef.current = chemicalTypes;

    setFormData(prev => {
      if (prev.chemical_type && chemicalTypes.includes(prev.chemical_type)) {
        return prev; // user's current selection is still valid
      }
      return { ...prev, chemical_type: chemicalTypes[0] };
    });
  }, [chemicalTypes]);

  // Auto-select first customer only once, only when no preselection and no user pick yet.
  // Removes formData.customer_id from deps so picking a customer doesn't re-fire this.
  useEffect(() => {
    if (didAutoSelectCustomerRef.current) return;
    if (preselectedCustomerId) {
      didAutoSelectCustomerRef.current = true;
      return;
    }
    if (customers.length > 0 && !formData.customer_id) {
      didAutoSelectCustomerRef.current = true;
      setFormData(prev => ({ ...prev, customer_id: customers[0]._id }));
    }
  }, [customers, preselectedCustomerId]); // intentionally omit formData.customer_id


  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.customer_id) {
      toast.error("Please select a customer");
      return;
    }

    if (!formData.chemical_type) {
      toast.error("Please select a chemical type");
      return;
    }

    setSaving(true);
    try {
      await createChemicalUsage(formData);
      toast.success("Chemical usage recorded");
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate(createPageUrl("ChemicalUsage"));
      }
    } catch (error) {
      console.error("Failed to save chemical usage:", error);
      toast.error("Failed to save chemical usage. Please try again.");
      setSaving(false);
    }
  };

  return (
    <main className="relative mx-auto max-w-3xl px-3 pb-32 pt-4 font-sans sm:px-4 lg:px-6" aria-label="Add Chemical Usage">
      <div className="mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card ">
        <BackButton
          fallback={createPageUrl("ChemicalUsage")}
          label="Back to Chemical Usage"
          className="mb-4"
        />
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">Chemistry log</p>
        <h2 className="text-3xl font-semibold leading-tight tracking-[-0.045em] text-ink sm:text-4xl">
          Add Chemical Usage
        </h2>
        <p className="mt-1 text-sm font-medium text-ink-muted">
          Track extra chemicals for billing
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="mb-4 rounded-sheet border border-line bg-surface-1 p-5 shadow-card ">
          <div className="space-y-4">
            <div>
              <Label htmlFor="customer_id" className="text-sm font-semibold text-ink">
                Customer <span className="text-brand-ink">*</span>
              </Label>
              <Select
                value={formData.customer_id ? String(formData.customer_id) : ""}
                onValueChange={(value) => setFormData({ ...formData, customer_id: parseInt(value, 10) })}
              >
                <SelectTrigger
                  aria-label="Customer"
                  className="mt-1 h-11 rounded-xl border border-line bg-white text-ink focus:border-ring focus:ring-ring"
                >
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map(customer => (
                    <SelectItem key={customer._id} value={String(customer._id)}>
                      {customer.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="chemical_type" className="text-sm font-semibold text-ink">
                Chemical Type <span className="text-brand-ink">*</span>
              </Label>
              <Select
                value={formData.chemical_type}
                onValueChange={(value) => setFormData({ ...formData, chemical_type: value })}
              >
                <SelectTrigger
                  aria-label="Chemical Type"
                  className="mt-1 h-11 rounded-xl border border-line bg-white text-ink focus:border-ring focus:ring-ring"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {chemicalTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="quantity" className="text-sm font-semibold text-ink">
                Quantity Used <span className="text-brand-ink">*</span>
              </Label>
              <Input
                id="quantity"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                required
                placeholder="e.g., 2 gallons, 3 lbs, 5 tablets"
                className="mt-1 h-11 rounded-xl border border-line bg-white font-medium text-ink focus:border-ring focus:ring-ring"
              />
              <p className="mt-1 text-xs font-medium text-ink-muted">Include units (gallons, lbs, tablets, etc.)</p>
            </div>

            <div>
              <Label htmlFor="notes" className="text-sm font-semibold text-ink">
                Notes
              </Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Why extra chemicals were needed..."
                rows={3}
                className="mt-1 rounded-xl border border-line bg-white text-ink focus:border-ring focus:ring-ring"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <BackButton
            fallback={createPageUrl("ChemicalUsage")}
            label="Cancel"
            variant="outline"
            className="h-12 flex-1 rounded-card border border-line bg-surface-1 text-sm font-semibold text-ink shadow-sm hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
          />
          <Button
            type="submit"
            disabled={saving}
            className="h-12 flex-1 rounded-card bg-ink px-4 text-sm font-semibold text-surface-0 shadow-raised hover:bg-brand-strong disabled:bg-surface-2 disabled:text-ink-muted disabled:shadow-none"
          >
            {saving ? (
              <>Saving...</>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                Save Chemical Usage
              </>
            )}
          </Button>
        </div>
      </form>
    </main>
  );
}
