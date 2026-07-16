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
    <div className="mx-auto max-w-2xl px-3 pb-36 pt-4 font-sans sm:px-6 lg:px-8">
      <div className="mb-5 overflow-hidden rounded-sheet border border-line bg-surface-1 p-4 shadow-card ">
        <BackButton
          fallback={createPageUrl("Clients")}
          label="Back to Clients"
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2 text-ink-secondary hover:text-brand-ink"
        />

        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-softer text-brand-ink shadow-sm">
            <User className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">New client</p>
            <h2 className="text-2xl font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-3xl">
              Add a Client
            </h2>
            <p className="mt-1 text-sm font-medium text-ink-muted">
              Capture the basics so this pool can be added to today's route.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card ">
          <div className="mb-4 flex items-center gap-2">
            <User className="h-4 w-4 text-brand-ink" aria-hidden="true" />
            <h3 className="text-lg font-semibold tracking-[-0.025em] text-ink">
              Basic Information
            </h3>
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="full_name" className="text-sm font-semibold text-ink">
                Full Name *
              </Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                required
                placeholder="John Smith"
                className="mt-1.5 h-11 rounded-xl border border-line bg-white text-sm font-medium text-ink-secondary focus:border-ring"
              />
            </div>

            <div>
              <Label htmlFor="address" className="text-sm font-semibold text-ink">
                Service Address *
              </Label>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  required
                  placeholder="123 Main St, City, State 12345"
                  className="mt-1.5 h-11 rounded-xl border border-line bg-white pl-9 text-sm font-medium text-ink-secondary focus:border-ring"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="gate_code" className="text-sm font-semibold text-ink">
                Gate Code
              </Label>
              <Input
                id="gate_code"
                value={formData.gate_code}
                onChange={(e) => setFormData({ ...formData, gate_code: e.target.value })}
                placeholder="1234#"
                className="mt-1.5 h-11 rounded-xl border border-line bg-white text-sm font-medium text-ink-secondary focus:border-ring"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="phone" className="text-sm font-semibold text-ink">
                  Phone Number
                </Label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    onBlur={handlePhoneBlur}
                    placeholder="(555) 123-4567"
                    className={`mt-1.5 h-11 rounded-xl border bg-white pl-9 text-sm font-medium text-ink-secondary ${phoneError ? 'border-[var(--status-critical-line)] focus:border-[var(--status-critical)]' : 'border-line focus:border-ring'}`}
                  />
                </div>
                {phoneError && (
                  <p className="mt-1 text-xs font-medium text-critical">{phoneError}</p>
                )}
              </div>

              <div>
                <Label htmlFor="email" className="text-sm font-semibold text-ink">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="john@example.com"
                    className="mt-1.5 h-11 rounded-xl border border-line bg-white pl-9 text-sm font-medium text-ink-secondary focus:border-ring"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label id="service_day_label" htmlFor="service_day" className="text-sm font-semibold text-ink">
                Service Day *
              </Label>
              <Select
                value={formData.service_day}
                onValueChange={(value) => setFormData({ ...formData, service_day: value })}
              >
                <SelectTrigger
                  id="service_day"
                  aria-label="Service Day"
                  className="mt-1.5 h-11 rounded-xl border border-line bg-white text-sm font-medium text-ink focus:border-ring"
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

        <Card className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card ">
          <div className="mb-4 flex items-center gap-2">
            <Droplets className="h-4 w-4 text-brand-ink" aria-hidden="true" />
            <h3 className="text-lg font-semibold tracking-[-0.025em] text-ink">
              Pool Details
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label id="pool_type_label" htmlFor="pool_type" className="text-sm font-semibold text-ink">
                Pool Type
              </Label>
              <Select
                value={formData.pool_type}
                onValueChange={(value) => setFormData({ ...formData, pool_type: value })}
              >
                <SelectTrigger
                  id="pool_type"
                  aria-label="Pool Type"
                  className="mt-1.5 h-11 rounded-xl border border-line bg-white text-sm font-medium text-ink focus:border-ring"
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
              <Label id="surface_type_label" htmlFor="surface_type" className="text-sm font-semibold text-ink">
                Surface Type
              </Label>
              <Select
                value={formData.surface_type}
                onValueChange={(value) => setFormData({ ...formData, surface_type: value })}
              >
                <SelectTrigger
                  id="surface_type"
                  aria-label="Surface Type"
                  className="mt-1.5 h-11 rounded-xl border border-line bg-white text-sm font-medium text-ink focus:border-ring"
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
              <Label htmlFor="pool_gallons" className="text-sm font-semibold text-ink">
                Capacity (gallons)
              </Label>
              <Input
                id="pool_gallons"
                type="number"
                value={formData.pool_gallons}
                onChange={(e) => setFormData({ ...formData, pool_gallons: e.target.value })}
                placeholder="15000"
                className="mt-1.5 h-11 rounded-xl border border-line bg-white text-sm font-medium text-ink-secondary focus:border-ring"
              />
            </div>
          </div>
        </Card>

        <div className="flex gap-3 pb-2">
          <BackButton
            fallback={createPageUrl("Clients")}
            label="Cancel"
            variant="outline"
            className="h-11 flex-1 rounded-card border border-line bg-surface-1 text-sm font-semibold text-ink shadow-sm hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
          />
          <Button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-card bg-brand text-sm font-semibold text-white shadow-cta hover:bg-brand-strong disabled:opacity-70"
          >
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
                Saving...
              </span>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                Save Client
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
