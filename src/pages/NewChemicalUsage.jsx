import { useState, useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCustomersFilter, useChemicalUsageCreate, useCurrentUser } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
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
  const urlParams = new URLSearchParams(window.location.search);
  const preselectedCustomerIdParam = urlParams.get("customerId");
  const preselectedCustomerId = preselectedCustomerIdParam ? parseInt(preselectedCustomerIdParam, 10) : null;

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

  useEffect(() => {
    if (chemicalTypes.length > 0) {
      setFormData(prev => {
        if (!prev.chemical_type || !chemicalTypes.includes(prev.chemical_type)) {
          return { ...prev, chemical_type: chemicalTypes[0] };
        }
        return prev;
      });
    }
  }, [chemicalTypes]);

  useEffect(() => {
    if (!preselectedCustomerId && customers.length > 0 && !formData.customer_id) {
      setFormData(prev => ({ ...prev, customer_id: customers[0]._id }));
    }
  }, [customers, preselectedCustomerId, formData.customer_id]);


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
      navigate(createPageUrl("ChemicalUsage"));
    } catch (error) {
      console.error("Failed to save chemical usage:", error);
      toast.error("Failed to save chemical usage. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-sans">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate(createPageUrl("ChemicalUsage"))}
          className="mb-4 group"
        >
          <ArrowLeft className="w-4 h-4 mr-2 stroke-[1.75] group-hover:-translate-x-1 transition-transform" />
          Back to Chemical Usage
        </Button>

        <div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Add Chemical Usage</h2>
            <p className="text-sm font-medium text-slate-600">Track extra chemicals for billing</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="p-6 mb-6 border-2 shadow-lg">
          <div className="space-y-4">
            <div>
              <Label htmlFor="customer_id" className="text-slate-700 font-semibold">
                Customer *
              </Label>
              <Select
                value={formData.customer_id ? String(formData.customer_id) : ""}
                onValueChange={(value) => setFormData({ ...formData, customer_id: parseInt(value, 10) })}
              >
                <SelectTrigger className="mt-1 bg-white text-slate-900 border border-slate-200 focus:border-purple-500 rounded-lg h-11">
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
              <Label htmlFor="chemical_type" className="text-slate-700 font-semibold">
                Chemical Type *
              </Label>
              <Select
                value={formData.chemical_type}
                onValueChange={(value) => setFormData({ ...formData, chemical_type: value })}
              >
                <SelectTrigger className="mt-1 bg-white text-slate-900 border border-slate-200 focus:border-purple-500 rounded-lg h-11">
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
              <Label htmlFor="quantity" className="text-slate-700 font-semibold">
                Quantity Used *
              </Label>
              <Input
                id="quantity"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                required
                placeholder="e.g., 2 gallons, 3 lbs, 5 tablets"
                className="mt-1 border-2 focus:border-purple-500 rounded-xl font-medium"
              />
              <p className="text-xs text-slate-500 mt-1 font-medium">Include units (gallons, lbs, tablets, etc.)</p>
            </div>

            <div>
              <Label htmlFor="notes" className="text-slate-700 font-semibold">
                Notes
              </Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Why extra chemicals were needed..."
                rows={3}
                className="mt-1 border-2 focus:border-purple-500 rounded-xl"
              />
            </div>
          </div>
        </Card>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(createPageUrl("ChemicalUsage"))}
            className="flex-1 border-2 rounded-xl font-medium"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving}
            className="flex-1 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white shadow-lg rounded-xl font-semibold"
          >
            {saving ? (
              <>Saving...</>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2 stroke-[1.75]" />
                Save Chemical Usage
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
