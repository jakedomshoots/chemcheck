import React, { useState, useEffect } from "react";
import { useCustomers, useServiceLogCreate } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Save, Droplets, FlaskConical, Waves, Gauge, Beaker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import SimplifiedChemicalInput from "../components/servicelog/SimplifiedChemicalInput";

export default function NewServiceLog() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const customerId = urlParams.get("customerId");

  const customers = useCustomers();
  const createServiceLog = useServiceLogCreate();

  const [customer, setCustomer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    ph: "good",
    chlorine: "good",
    alkalinity: "good",
    stabilizer: "good",
    salt: "",
    notes: ""
  });

  useEffect(() => {
    if (customers && customerId) {
      const found = customers.find((c) => c._id === customerId);
      setCustomer(found);
    }
  }, [customers, customerId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    // Get today's date in local timezone as YYYY-MM-DD
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const localDate = `${year}-${month}-${day}`;

    const logData = {
      customer_id: customerId,
      service_date: localDate,
      status: "completed",
      notes: formData.notes,
      ph: formData.ph,
      chlorine: formData.chlorine,
      alkalinity: formData.alkalinity,
      stabilizer: formData.stabilizer
    };

    if (customer?.pool_type === "Salt" && formData.salt) {
      logData.salt = parseInt(formData.salt);
    }

    await createServiceLog(logData);
    navigate(createPageUrl("Home"));
  };

  if (!customer) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate(createPageUrl("Home"))}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Route
        </Button>

        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg">
            <Droplets className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Service Log</h2>
            <p className="text-sm text-slate-600">{customer.full_name}</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="p-6 mb-6 border-2 shadow-lg">
          <h3 className="text-lg font-semibold text-slate-900 mb-2 flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-cyan-600" />
            Chemical Readings
          </h3>
          <p className="text-sm text-slate-600 mb-6">Select the level for each chemical test</p>

          <div className="space-y-6">
            <SimplifiedChemicalInput
              label="pH Balance"
              value={formData.ph}
              onChange={(val) => setFormData({ ...formData, ph: val })}
              icon={<Gauge className="w-4 h-4" />}
            />

            <SimplifiedChemicalInput
              label="Chlorine Level"
              value={formData.chlorine}
              onChange={(val) => setFormData({ ...formData, chlorine: val })}
              icon={<Droplets className="w-4 h-4" />}
            />

            <SimplifiedChemicalInput
              label="Total Alkalinity"
              value={formData.alkalinity}
              onChange={(val) => setFormData({ ...formData, alkalinity: val })}
              icon={<Beaker className="w-4 h-4" />}
            />

            <SimplifiedChemicalInput
              label="Stabilizer (Cyanuric Acid)"
              value={formData.stabilizer}
              onChange={(val) => setFormData({ ...formData, stabilizer: val })}
              icon={<FlaskConical className="w-4 h-4" />}
            />

            {customer.pool_type === "Salt" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Waves className="w-4 h-4 text-cyan-600" />
                  <Label className="text-sm font-semibold text-slate-700">Salt Level (PPM)</Label>
                </div>
                <Input
                  type="number"
                  value={formData.salt}
                  onChange={(e) => setFormData({ ...formData, salt: e.target.value })}
                  placeholder="3200"
                  className="border-2 focus:border-cyan-500 rounded-xl"
                />
                <p className="text-xs text-slate-500">Ideal range: 2700-3400 PPM</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6 mb-6 border-2 shadow-lg">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Service Notes</h3>
          <Label htmlFor="notes" className="text-slate-700 font-medium mb-2 block">
            Notes (optional)
          </Label>
          <Textarea
            id="notes"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Dog was in yard, filter pressure high, added 2 gallons of liquid chlorine..."
            rows={4}
            className="border-2 focus:border-cyan-500 rounded-xl"
          />
        </Card>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(createPageUrl("Home"))}
            className="flex-1 border-2 rounded-xl"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving}
            className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg rounded-xl"
          >
            {saving ? (
              <>Saving...</>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Complete Service
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}