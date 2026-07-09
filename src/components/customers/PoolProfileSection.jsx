import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Droplets, MapPin, Plus, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function PoolProfileSection({ customer, cloudEnabled }) {
  const customerId = customer?._id;
  const profile = useQuery(
    api.poolProfiles.getCustomerProfile,
    cloudEnabled && customerId ? { customer_id: customerId } : "skip"
  );
  const ensureLegacyProfile = useMutation(api.poolProfiles.ensureLegacyProfile);
  const createSite = useMutation(api.poolProfiles.createSite);
  const createPool = useMutation(api.poolProfiles.createPool);
  const createEquipment = useMutation(api.poolProfiles.createEquipment);
  const [settingUp, setSettingUp] = useState(false);
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [showPoolForm, setShowPoolForm] = useState(false);
  const [showEquipmentForm, setShowEquipmentForm] = useState(false);
  const [savingSite, setSavingSite] = useState(false);
  const [savingPool, setSavingPool] = useState(false);
  const [savingEquipment, setSavingEquipment] = useState(false);
  const [site, setSite] = useState({ name: "", street_address: "" });
  const [pool, setPool] = useState({ site_id: "", name: "", sanitizer_type: "chlorine", surface_type: "plaster", volume_gallons: "" });
  const [equipment, setEquipment] = useState({ pool_id: "", kind: "", status: "operational", next_service_due: "" });

  const primarySite = profile?.sites?.[0];
  const primaryPool = useMemo(
    () => profile?.pools?.find((pool) => String(pool.site_id) === String(primarySite?._id)) || profile?.pools?.[0],
    [profile?.pools, primarySite?._id]
  );
  const poolsBySite = useMemo(() => {
    const groups = new Map();
    for (const item of profile?.pools || []) {
      const key = String(item.site_id);
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return groups;
  }, [profile?.pools]);

  if (!cloudEnabled) return null;

  const handleSetup = async () => {
    if (!customerId) return;
    setSettingUp(true);
    try {
      await ensureLegacyProfile({ customer_id: customerId });
      toast.success("Service address and primary pool profile created.");
    } catch (error) {
      toast.error(error?.message || "Could not create the pool profile.");
    } finally {
      setSettingUp(false);
    }
  };

  const handleCreateEquipment = async (event) => {
    event.preventDefault();
    if (!customerId || !primarySite || !equipment.kind.trim()) return;
    setSavingEquipment(true);
    try {
      await createEquipment({
        customer_id: customerId,
        site_id: (profile?.pools || []).find((item) => String(item._id) === equipment.pool_id)?.site_id || primarySite._id,
        pool_id: equipment.pool_id || primaryPool?._id,
        kind: equipment.kind.trim(),
        status: equipment.status.trim() || "operational",
        next_service_due: equipment.next_service_due || undefined,
      });
      setEquipment({ pool_id: "", kind: "", status: "operational", next_service_due: "" });
      setShowEquipmentForm(false);
      toast.success("Equipment added to this pool profile.");
    } catch (error) {
      toast.error(error?.message || "Could not add equipment.");
    } finally {
      setSavingEquipment(false);
    }
  };

  const handleCreateSite = async (event) => {
    event.preventDefault();
    if (!customerId || !site.name.trim() || !site.street_address.trim()) return;
    setSavingSite(true);
    try {
      await createSite({
        customer_id: customerId,
        name: site.name.trim(),
        street_address: site.street_address.trim(),
      });
      setSite({ name: "", street_address: "" });
      setShowSiteForm(false);
      toast.success("Service site added.");
    } catch (error) {
      toast.error(error?.message || "Could not add the service site.");
    } finally {
      setSavingSite(false);
    }
  };

  const handleCreatePool = async (event) => {
    event.preventDefault();
    const siteId = pool.site_id || primarySite?._id;
    if (!customerId || !siteId || !pool.name.trim()) return;
    setSavingPool(true);
    try {
      await createPool({
        customer_id: customerId,
        site_id: siteId,
        name: pool.name.trim(),
        sanitizer_type: pool.sanitizer_type,
        surface_type: pool.surface_type,
        volume_gallons: pool.volume_gallons ? Number(pool.volume_gallons) : undefined,
      });
      setPool({ site_id: "", name: "", sanitizer_type: "chlorine", surface_type: "plaster", volume_gallons: "" });
      setShowPoolForm(false);
      toast.success("Pool added to this service site.");
    } catch (error) {
      toast.error(error?.message || "Could not add the pool.");
    } finally {
      setSavingPool(false);
    }
  };

  return (
    <Card className="p-4 mb-3 border-2 shadow-sm" data-testid="pool-profile-section">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">Sites, Pools & Equipment</h3>
          <p className="text-xs text-slate-600">Track service locations and equipment separately from the customer record.</p>
        </div>
        {!primarySite && (
          <Button size="sm" onClick={handleSetup} disabled={settingUp} variant="outline">
            <Plus className="w-3.5 h-3.5 mr-1" />
            {settingUp ? "Setting up..." : "Set up profile"}
          </Button>
        )}
      </div>

      {profile === undefined ? (
        <p className="text-xs text-slate-500">Loading pool profile...</p>
      ) : !primarySite ? (
        <p className="text-sm text-slate-600">This existing customer has not been migrated to the multi-pool profile yet.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowSiteForm((value) => !value)}>
              <MapPin className="w-3.5 h-3.5 mr-1" />
              Add site
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowPoolForm((value) => !value)}>
              <Droplets className="w-3.5 h-3.5 mr-1" />
              Add pool
            </Button>
          </div>
          {showSiteForm && (
            <form onSubmit={handleCreateSite} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
              <input aria-label="Service site name" value={site.name} onChange={(event) => setSite((current) => ({ ...current, name: event.target.value }))} placeholder="Service site name" className="h-10 rounded-md border border-slate-300 px-3 text-sm" required />
              <input aria-label="Service site address" value={site.street_address} onChange={(event) => setSite((current) => ({ ...current, street_address: event.target.value }))} placeholder="Street address" className="h-10 rounded-md border border-slate-300 px-3 text-sm" required />
              <div className="sm:col-span-2 flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setShowSiteForm(false)}>Cancel</Button><Button type="submit" size="sm" disabled={savingSite}>{savingSite ? "Saving..." : "Save site"}</Button></div>
            </form>
          )}
          {showPoolForm && (
            <form onSubmit={handleCreatePool} className="grid grid-cols-1 gap-2 rounded-lg border border-cyan-100 bg-cyan-50/40 p-3 sm:grid-cols-2">
              <select aria-label="Pool service site" value={pool.site_id} onChange={(event) => setPool((current) => ({ ...current, site_id: event.target.value }))} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
                {(profile.sites || []).map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
              </select>
              <input aria-label="Pool name" value={pool.name} onChange={(event) => setPool((current) => ({ ...current, name: event.target.value }))} placeholder="Pool name" className="h-10 rounded-md border border-slate-300 px-3 text-sm" required />
              <select aria-label="Pool sanitizer" value={pool.sanitizer_type} onChange={(event) => setPool((current) => ({ ...current, sanitizer_type: event.target.value }))} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="chlorine">Chlorine</option><option value="salt">Salt</option><option value="bromine">Bromine</option></select>
              <input aria-label="Pool surface" value={pool.surface_type} onChange={(event) => setPool((current) => ({ ...current, surface_type: event.target.value }))} placeholder="Surface type" className="h-10 rounded-md border border-slate-300 px-3 text-sm" required />
              <input aria-label="Pool volume" type="number" min="1" value={pool.volume_gallons} onChange={(event) => setPool((current) => ({ ...current, volume_gallons: event.target.value }))} placeholder="Volume (gallons)" className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
              <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setShowPoolForm(false)}>Cancel</Button><Button type="submit" size="sm" disabled={savingPool}>{savingPool ? "Saving..." : "Save pool"}</Button></div>
            </form>
          )}
          <div className="space-y-2">
            {profile.sites.map((serviceSite) => (
              <div key={serviceSite._id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><MapPin className="w-4 h-4 text-cyan-700" />{serviceSite.name}</div>
                <p className="mt-1 text-xs text-slate-600">{serviceSite.street_address}</p>
                <div className="mt-2 space-y-1.5">
                  {(poolsBySite.get(String(serviceSite._id)) || []).map((item) => (
                    <div key={item._id} className="rounded-md border border-cyan-100 bg-cyan-50/60 px-2.5 py-2 text-xs text-slate-700"><span className="font-semibold text-slate-900">{item.name}</span>{[item.sanitizer_type, item.surface_type, item.volume_gallons ? `${item.volume_gallons.toLocaleString()} gal` : null].filter(Boolean).join(" · ") && ` · ${[item.sanitizer_type, item.surface_type, item.volume_gallons ? `${item.volume_gallons.toLocaleString()} gal` : null].filter(Boolean).join(" · ")}`}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">Equipment ({profile.equipment.length})</p>
            <Button size="sm" variant="outline" onClick={() => setShowEquipmentForm((value) => !value)}>
              <Wrench className="w-3.5 h-3.5 mr-1" />
              Add equipment
            </Button>
          </div>
          {profile.equipment.length > 0 ? (
            <div className="space-y-2">
              {profile.equipment.map((item) => (
                <div key={item._id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <p className="font-medium text-slate-900">{item.kind}</p>
                  <p className="text-xs text-slate-600">
                    {[item.manufacturer, item.model, item.status, item.next_service_due ? `Due ${item.next_service_due}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-600">No equipment recorded yet.</p>
          )}

          {showEquipmentForm && (
            <form onSubmit={handleCreateEquipment} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-3">
              <select aria-label="Equipment pool" value={equipment.pool_id} onChange={(event) => setEquipment((current) => ({ ...current, pool_id: event.target.value }))} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
                <option value="">{primaryPool?.name || "Primary pool"}</option>
                {(profile.pools || []).map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
              </select>
              <input
                aria-label="Equipment type"
                value={equipment.kind}
                onChange={(event) => setEquipment((current) => ({ ...current, kind: event.target.value }))}
                placeholder="Equipment type"
                className="h-10 rounded-md border border-slate-300 px-3 text-sm"
                required
              />
              <input
                aria-label="Equipment status"
                value={equipment.status}
                onChange={(event) => setEquipment((current) => ({ ...current, status: event.target.value }))}
                placeholder="Status"
                className="h-10 rounded-md border border-slate-300 px-3 text-sm"
              />
              <input
                aria-label="Next equipment service due"
                value={equipment.next_service_due}
                onChange={(event) => setEquipment((current) => ({ ...current, next_service_due: event.target.value }))}
                type="date"
                className="h-10 rounded-md border border-slate-300 px-3 text-sm"
              />
              <div className="sm:col-span-3 flex justify-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setShowEquipmentForm(false)}>Cancel</Button>
                <Button type="submit" size="sm" disabled={savingEquipment}>{savingEquipment ? "Saving..." : "Save equipment"}</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
