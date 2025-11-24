import React, { useState, useEffect } from "react";
import { useCustomersFilter, useChemicalUsageCreate, useCurrentUser } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Save, Beaker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { toast } from "sonner";

const chemicalTypes = [
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
  const preselectedCustomerId = urlParams.get("customerId");

  const user = useCurrentUser();
  const allCustomers = useCustomersFilter({ created_by: user.email });
  const createChemicalUsage = useChemicalUsageCreate();

  const [customers, setCustomers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    customer_id: preselectedCustomerId || "",
    chemical_type: "Liquid Chlorine",
    quantity: "",
    notes: ""
  });

  useEffect(() => {
    if (allCustomers) {
      const sorted = [...allCustomers].sort((a, b) => a.full_name.localeCompare(b.full_name));
      setCustomers(sorted);
      if (!preselectedCustomerId && sorted.length > 0) {
        setFormData(prev => ({ ...prev, customer_id: sorted[0]._id }));
      }
    }
  }, [allCustomers, preselectedCustomerId]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.customer_id) {
      toast.error("Please select a customer");
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
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate(createPageUrl("ChemicalUsage"))}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Chemical Usage
        </Button>

        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl shadow-lg">
            <Beaker className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Add Chemical Usage</h2>
            <p className="text-sm text-slate-600">Track extra chemicals for billing</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="p-6 mb-6 border-2 shadow-lg">
          <div className="space-y-4">
            <div>
              <Label htmlFor="customer_id" className="text-slate-700 font-medium">
                Customer *
              </Label>
              <Select
                value={formData.customer_id}
                onValueChange={(value) => setFormData({ ...formData, customer_id: value })}
              >
                <SelectTrigger className="mt-1 border-2 focus:border-purple-500 rounded-xl">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map(customer => (
                    <SelectItem key={customer._id} value={customer._id}>
                      {customer.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="chemical_type" className="text-slate-700 font-medium">
                Chemical Type *
              </Label>
              <Select
                value={formData.chemical_type}
                onValueChange={(value) => setFormData({ ...formData, chemical_type: value })}
              >
                <SelectTrigger className="mt-1 border-2 focus:border-purple-500 rounded-xl">
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
              <Label htmlFor="quantity" className="text-slate-700 font-medium">
                Quantity Used *
              </Label>
              <Input
                id="quantity"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                required
                placeholder="e.g., 2 gallons, 3 lbs, 5 tablets"
                className="mt-1 border-2 focus:border-purple-500 rounded-xl"
              />
              <p className="text-xs text-slate-500 mt-1">Include units (gallons, lbs, tablets, etc.)</p>
            </div>

            <div>
              <Label htmlFor="notes" className="text-slate-700 font-medium">
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
            className="flex-1 border-2 rounded-xl"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving}
            className="flex-1 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white shadow-lg rounded-xl"
          >
            {saving ? (
              <>Saving...</>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Chemical Usage
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}