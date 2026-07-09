import React, { useState, useEffect, useRef, useMemo } from "react";
import { useCustomers, useCustomerUpdate } from "@/api/convexHooks";
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

export default function EditClient() {
  const navigate = useNavigate();
  // Parse URL params once per URL change, not on every render
  const customerId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("id");
    return raw ? parseInt(raw, 10) : null;
  }, [window.location.search]);

  const customers = useCustomers();
  const updateCustomer = useCustomerUpdate();

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
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
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (initialLoadDone.current) return;
    if (!customers || !customerId) return;

    const customer = customers.find(c => c._id === customerId);
    if (!customer) return;

    setFormData({
      full_name: customer.full_name || "",
      address: customer.address || "",
      phone: customer.phone || "",
      email: customer.email || "",
      gate_code: customer.gate_code || "",
      service_day: customer.service_day || "Monday",
      pool_gallons: customer.pool_gallons || "",
      pool_type: customer.pool_type || "Chlorine",
      surface_type: customer.surface_type || "Plaster"
    });
    setLoading(false);
    initialLoadDone.current = true;
  }, [customers, customerId]);

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
        id: customerId,
        ...formData,
        phone: normalizedPhone,
        pool_gallons: formData.pool_gallons ? parseInt(formData.pool_gallons) : undefined
      };
      await updateCustomer(data);
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate(createPageUrl("Clients"));
      }
    } catch (error) {
      console.error("Error updating customer:", error);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-3 pt-12">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-200 border-t-cyan-600" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-500">Loading client…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-3 pb-36 pt-4 font-sans sm:px-6 lg:px-8">
      <div className="mb-5 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur">
        <BackButton
          fallback={createPageUrl("Clients")}
          label="Back to Clients"
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2 text-slate-600 hover:text-cyan-700"
        />

        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700 shadow-sm">
            <User className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Edit client</p>
            <h2 className="truncate text-2xl font-semibold leading-tight tracking-[-0.035em] text-slate-950 sm:text-3xl">
              {formData.full_name || "Edit Client"}
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Update contact info, schedule, and pool details.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card className="rounded-[1.5rem] border border-white/80 bg-white/85 p-5 shadow-[0_18px_60px_-48px_rgba(8,47,73,0.75)] backdrop-blur">
          <div className="mb-4 flex items-center gap-2">
            <User className="h-4 w-4 text-cyan-700" aria-hidden="true" />
            <h3 className="text-lg font-semibold tracking-[-0.025em] text-slate-950">
              Basic Information
            </h3>
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="full_name" className="text-sm font-semibold text-slate-800">
                Full Name *
              </Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                required
                placeholder="John Smith"
                className="mt-1.5 h-11 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 focus:border-cyan-500"
              />
            </div>

            <div>
              <Label htmlFor="address" className="text-sm font-semibold text-slate-800">
                Service Address *
              </Label>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  required
                  placeholder="123 Main St, City, State 12345"
                  className="mt-1.5 h-11 rounded-xl border border-slate-200 bg-white pl-9 text-sm font-medium text-slate-700 focus:border-cyan-500"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="gate_code" className="text-sm font-semibold text-slate-800">
                Gate Code
              </Label>
              <Input
                id="gate_code"
                value={formData.gate_code}
                onChange={(e) => setFormData({ ...formData, gate_code: e.target.value })}
                placeholder="1234#"
                className="mt-1.5 h-11 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 focus:border-cyan-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="phone" className="text-sm font-semibold text-slate-800">
                  Phone Number
                </Label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    onBlur={handlePhoneBlur}
                    placeholder="(555) 123-4567"
                    className={`mt-1.5 h-11 rounded-xl border bg-white pl-9 text-sm font-medium text-slate-700 ${phoneError ? 'border-red-400 focus:border-red-500' : 'border-slate-200 focus:border-cyan-500'}`}
                  />
                </div>
                {phoneError && (
                  <p className="mt-1 text-xs font-medium text-red-600">{phoneError}</p>
                )}
              </div>

              <div>
                <Label htmlFor="email" className="text-sm font-semibold text-slate-800">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="john@example.com"
                    className="mt-1.5 h-11 rounded-xl border border-slate-200 bg-white pl-9 text-sm font-medium text-slate-700 focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="service_day" className="text-sm font-semibold text-slate-800">
                Service Day *
              </Label>
              <Select
                value={formData.service_day}
                onValueChange={(value) => setFormData({ ...formData, service_day: value })}
              >
                <SelectTrigger
                  id="service_day"
                  aria-label="Service Day"
                  className="mt-1.5 h-11 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:border-cyan-500"
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

        <Card className="rounded-[1.5rem] border border-white/80 bg-white/85 p-5 shadow-[0_18px_60px_-48px_rgba(8,47,73,0.75)] backdrop-blur">
          <div className="mb-4 flex items-center gap-2">
            <Droplets className="h-4 w-4 text-cyan-700" aria-hidden="true" />
            <h3 className="text-lg font-semibold tracking-[-0.025em] text-slate-950">
              Pool Details
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="pool_type" className="text-sm font-semibold text-slate-800">
                Pool Type
              </Label>
              <Select
                value={formData.pool_type}
                onValueChange={(value) => setFormData({ ...formData, pool_type: value })}
              >
                <SelectTrigger
                  id="pool_type"
                  aria-label="Pool Type"
                  className="mt-1.5 h-11 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:border-cyan-500"
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
              <Label htmlFor="surface_type" className="text-sm font-semibold text-slate-800">
                Surface Type
              </Label>
              <Select
                value={formData.surface_type}
                onValueChange={(value) => setFormData({ ...formData, surface_type: value })}
              >
                <SelectTrigger
                  id="surface_type"
                  aria-label="Surface Type"
                  className="mt-1.5 h-11 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:border-cyan-500"
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
              <Label htmlFor="pool_gallons" className="text-sm font-semibold text-slate-800">
                Capacity (gallons)
              </Label>
              <Input
                id="pool_gallons"
                type="number"
                value={formData.pool_gallons}
                onChange={(e) => setFormData({ ...formData, pool_gallons: e.target.value })}
                placeholder="15000"
                className="mt-1.5 h-11 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 focus:border-cyan-500"
              />
            </div>
          </div>
        </Card>

        <div className="flex gap-3 pb-2">
          <BackButton
            fallback={createPageUrl("Clients")}
            label="Cancel"
            variant="outline"
            className="h-11 flex-1 rounded-[1.15rem] border border-slate-200 bg-white/90 text-sm font-semibold text-slate-800 shadow-sm hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800"
          />
          <Button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-[1.15rem] bg-cyan-600 text-sm font-semibold text-white shadow-[0_18px_38px_-24px_rgba(8,145,178,0.95)] hover:bg-cyan-700 disabled:opacity-70"
          >
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
                Saving...
              </span>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
