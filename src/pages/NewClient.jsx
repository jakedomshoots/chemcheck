import React, { useState } from "react";
import { useCustomerCreate } from "@/api/convexHooks";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Save, User, MapPin, Phone, Mail, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function NewClient() {
  const navigate = useNavigate();
  const createCustomer = useCustomerCreate();
  const [saving, setSaving] = useState(false);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        ...formData,
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
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate(createPageUrl("Clients"))}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Clients
        </Button>

        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg">
            <User className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">New Client</h2>
            <p className="text-sm text-slate-600">Add a new client to your route</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="p-6 mb-6 border-2 shadow-lg">
          <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-cyan-600" />
            Basic Information
          </h3>

          <div className="space-y-4">
            <div>
              <Label htmlFor="full_name" className="text-slate-700 font-medium">
                Full Name *
              </Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                required
                placeholder="John Smith"
                className="mt-1 border-2 focus:border-cyan-500 rounded-xl"
              />
            </div>

            <div>
              <Label htmlFor="address" className="text-slate-700 font-medium">
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
                  className="mt-1 pl-10 border-2 focus:border-cyan-500 rounded-xl"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="gate_code" className="text-slate-700 font-medium">
                Gate Code
              </Label>
              <Input
                id="gate_code"
                value={formData.gate_code}
                onChange={(e) => setFormData({ ...formData, gate_code: e.target.value })}
                placeholder="1234#"
                className="mt-1 border-2 focus:border-cyan-500 rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="phone" className="text-slate-700 font-medium">
                  Phone Number
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="(555) 123-4567"
                    className="mt-1 pl-10 border-2 focus:border-cyan-500 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="email" className="text-slate-700 font-medium">
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
                    className="mt-1 pl-10 border-2 focus:border-cyan-500 rounded-xl"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="service_day" className="text-slate-700 font-medium">
                Service Day *
              </Label>
              <Select
                value={formData.service_day}
                onValueChange={(value) => setFormData({ ...formData, service_day: value })}
              >
                <SelectTrigger className="mt-1 border-2 focus:border-cyan-500 rounded-xl">
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

        <Card className="p-6 mb-6 border-2 shadow-lg">
          <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Droplets className="w-5 h-5 text-cyan-600" />
            Pool Details
          </h3>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="pool_type" className="text-slate-700 font-medium">
                  Pool Type
                </Label>
                <Select
                  value={formData.pool_type}
                  onValueChange={(value) => setFormData({ ...formData, pool_type: value })}
                >
                  <SelectTrigger className="mt-1 border-2 focus:border-cyan-500 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Salt">Salt</SelectItem>
                    <SelectItem value="Chlorine">Chlorine</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="surface_type" className="text-slate-700 font-medium">
                  Surface Type
                </Label>
                <Select
                  value={formData.surface_type}
                  onValueChange={(value) => setFormData({ ...formData, surface_type: value })}
                >
                  <SelectTrigger className="mt-1 border-2 focus:border-cyan-500 rounded-xl">
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
                <Label htmlFor="pool_gallons" className="text-slate-700 font-medium">
                  Capacity (gallons)
                </Label>
                <Input
                  id="pool_gallons"
                  type="number"
                  value={formData.pool_gallons}
                  onChange={(e) => setFormData({ ...formData, pool_gallons: e.target.value })}
                  placeholder="15000"
                  className="mt-1 border-2 focus:border-cyan-500 rounded-xl"
                />
              </div>
            </div>
          </div>
        </Card>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(createPageUrl("Clients"))}
            className="flex-1 border-2 rounded-xl"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving}
            className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg rounded-xl"
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