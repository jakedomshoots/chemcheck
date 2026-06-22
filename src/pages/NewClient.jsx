import React, { useState } from "react";
import { useCustomerCreate } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Save, User, MapPin, Phone, Mail, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/navigation/BackButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { validatePhoneNumber } from "@/lib/phoneValidation";

export default function NewClient() {
  const navigate = useNavigate();
  const createCustomer = useCustomerCreate();
  const [saving, setSaving] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [formData, setFormData] = useState({
    full_name: "",
    address: "",
    phone: "",
    email: "",
    gate_code: "",
    service_day: "Monday",
    pool_gallons: "",
    pool_type: "Chlorine",
    surface_type: "Plaster"
  });

  const handlePhoneChange = (e) => {
    const value = e.target.value;
    setFormData({ ...formData, phone: value });
    if (phoneError) {
      setPhoneError("");
    }
  };

  const handlePhoneBlur = () => {
    if (formData.phone.trim()) {
      const result = validatePhoneNumber(formData.phone);
      if (!result.isValid) {
        setPhoneError(result.error || "Invalid phone number");
      } else {
        setPhoneError("");
      }
    } else {
      setPhoneError("");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    let normalizedPhone = undefined;
    if (formData.phone.trim()) {
      const phoneResult = validatePhoneNumber(formData.phone);
      if (!phoneResult.isValid) {
        setPhoneError(phoneResult.error || "Invalid phone number");
        return;
      }
      normalizedPhone = phoneResult.normalized;
    }
    
    setSaving(true);
    try {
      const data = {
        ...formData,
        phone: normalizedPhone,
        pool_gallons: formData.pool_gallons ? parseInt(formData.pool_gallons) : undefined
      };
      await createCustomer(data);
      navigate(createPageUrl("Clients"));
    } catch (error) {
      console.error("Error creating customer:", error);
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <BackButton
          fallback={createPageUrl("Clients")}
          label="Back to Clients"
          className="mb-4"
        />
      </div>

      <form onSubmit={handleSubmit}>
      <Card className="p-6 mb-6 bg-white border border-slate-200 rounded-xl shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
            <User className="w-5 h-5 text-cyan-600" />
            Basic Information
          </h3>

          <div className="space-y-5">
            <div>
              <Label htmlFor="full_name" className="text-slate-700 text-sm font-medium">
                Full Name *
              </Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                required
                placeholder="John Smith"
                className="mt-1.5 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
              />
            </div>

            <div>
              <Label htmlFor="address" className="text-slate-700 text-sm font-medium">
                Service Address *
              </Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  required
                  placeholder="123 Main St, City, State 12345"
                  className="mt-1.5 pl-10 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="gate_code" className="text-slate-700 text-sm font-medium">
                Gate Code
              </Label>
              <Input
                id="gate_code"
                value={formData.gate_code}
                onChange={(e) => setFormData({ ...formData, gate_code: e.target.value })}
                placeholder="1234#"
                className="mt-1.5 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="phone" className="text-slate-700 text-sm font-medium">
                  Phone Number
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    onBlur={handlePhoneBlur}
                    placeholder="(555) 123-4567"
                    className={`mt-1.5 pl-10 border rounded-lg h-11 ${phoneError ? 'border-red-500 focus:border-red-500' : 'border-slate-200 focus:border-cyan-500'}`}
                  />
                </div>
                {phoneError && (
                  <p className="mt-1 text-sm text-red-500">{phoneError}</p>
                )}
              </div>

              <div>
                <Label htmlFor="email" className="text-slate-700 text-sm font-medium">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="john@example.com"
                    className="mt-1.5 pl-10 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label id="service_day_label" htmlFor="service_day" className="text-slate-700 text-sm font-medium">
                Service Day *
              </Label>
              <Select
                value={formData.service_day}
                onValueChange={(value) => setFormData({ ...formData, service_day: value })}
              >
                <SelectTrigger
                  id="service_day"
                  aria-label="Service Day"
                  className="mt-1.5 bg-white text-slate-900 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => (
                    <SelectItem key={day} value={day}>{day}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <Card className="p-6 mb-6 bg-white border border-slate-200 rounded-xl shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
            <Droplets className="w-5 h-5 text-cyan-600" />
            Pool Details
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label id="pool_type_label" htmlFor="pool_type" className="text-slate-700 text-sm font-medium">
                Pool Type
              </Label>
              <Select
                value={formData.pool_type}
                onValueChange={(value) => setFormData({ ...formData, pool_type: value })}
              >
                <SelectTrigger
                  id="pool_type"
                  aria-label="Pool Type"
                  className="mt-1.5 bg-white text-slate-900 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Chlorine">Chlorine</SelectItem>
                  <SelectItem value="Salt">Salt</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label id="surface_type_label" htmlFor="surface_type" className="text-slate-700 text-sm font-medium">
                Surface Type
              </Label>
              <Select
                value={formData.surface_type}
                onValueChange={(value) => setFormData({ ...formData, surface_type: value })}
              >
                <SelectTrigger
                  id="surface_type"
                  aria-label="Surface Type"
                  className="mt-1.5 bg-white text-slate-900 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Plaster">Plaster</SelectItem>
                  <SelectItem value="Vinyl">Vinyl</SelectItem>
                  <SelectItem value="Fiberglass">Fiberglass</SelectItem>
                  <SelectItem value="Tile">Tile</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="pool_gallons" className="text-slate-700 text-sm font-medium">
                Capacity (gallons)
              </Label>
              <Input
                id="pool_gallons"
                type="number"
                value={formData.pool_gallons}
                onChange={(e) => setFormData({ ...formData, pool_gallons: e.target.value })}
                placeholder="15000"
                className="mt-1.5 border border-slate-200 focus:border-cyan-500 rounded-lg h-11"
              />
            </div>
          </div>
        </Card>

        <div className="flex gap-3">
          <BackButton
            fallback={createPageUrl("Clients")}
            label="Cancel"
            variant="outline"
            className="flex-1 h-11 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50"
          />
          <Button
            type="submit"
            disabled={saving}
            className="flex-1 h-11 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white rounded-lg"
          >
            {saving ? (
              <>Saving...</>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Client
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
