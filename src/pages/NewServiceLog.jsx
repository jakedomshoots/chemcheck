import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useCustomers, useServiceLogCreate } from "@/api/convexHooks";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { createPageUrl } from "@/utils";
import { Save, Droplets, TestTube, Waves, Activity, AlertCircle, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/navigation/BackButton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import SimplifiedChemicalInput from "../components/servicelog/SimplifiedChemicalInput";
import { ChemicalBeakerLoader } from "@/components/ui/loader";
import confetti from "canvas-confetti";
import { deleteUnlinkedPhotos, linkPhotosToServiceLog, getPhotos } from "@/lib/proof-of-service";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { PhotoCaptureSection } from "@/components/proof-of-service";
import { toast } from "sonner";
import {
  validateServiceCompletion,
  getValidationErrorMessage,
  hasAnyRequirements,
  getRequirementsSummary,
} from "@/lib/proof-of-service";
import {
  saveTimeState,
  getTimeState,
  storedToTimeTrackerState,
  updateEndTime,
  clearTimeState,
} from "@/lib/proof-of-service/timeTrackingStorage";

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return prefersReducedMotion;
}

const CHEMICAL_CONFIGS = {
  ph: {
    min: 6.8,
    max: 8.2,
    step: 0.1,
    unit: "",
    hint: "Ideal range: 6.8–8.2",
    ranges: [
      { status: "critical", min: -Infinity, max: 6.8 },
      { status: "low", min: 6.8, max: 7.2 },
      { status: "good", min: 7.2, max: 7.8 },
      { status: "high", min: 7.8, max: 8.2 },
      { status: "critical", min: 8.2, max: Infinity },
    ],
  },
  chlorine: {
    min: 0,
    max: 10,
    step: 0.5,
    unit: "ppm",
    hint: "Ideal range: 1–3 ppm (max 10 ppm)",
    ranges: [
      { status: "critical", min: -Infinity, max: 0.5 },
      { status: "low", min: 0.5, max: 1 },
      { status: "good", min: 1, max: 3 },
      { status: "high", min: 3, max: 10 },
      { status: "critical", min: 10, max: Infinity },
    ],
  },
  alkalinity: {
    min: 80,
    max: 120,
    step: 1,
    unit: "ppm",
    hint: "Ideal range: 80–120 ppm",
    ranges: [
      { status: "critical", min: -Infinity, max: 80 },
      { status: "low", min: 80, max: 100 },
      { status: "good", min: 100, max: 120 },
      { status: "high", min: 120, max: 200 },
      { status: "critical", min: 200, max: Infinity },
    ],
  },
  stabilizer: {
    min: 30,
    max: 100,
    step: 1,
    unit: "ppm",
    hint: "Ideal range: 30–50 ppm (max 100 ppm)",
    ranges: [
      { status: "critical", min: -Infinity, max: 10 },
      { status: "low", min: 10, max: 30 },
      { status: "good", min: 30, max: 50 },
      { status: "high", min: 50, max: 100 },
      { status: "critical", min: 100, max: Infinity },
    ],
  },
};

function formatDuration(ms) {
  if (!ms || ms < 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export default function NewServiceLog() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefersReducedMotion = usePrefersReducedMotion();
  // Parse URL params once per URL change, not on every render
  const { customerIdParam, customerId } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("customerId");
    return {
      customerIdParam: raw,
      customerId: raw ? parseInt(raw, 10) : null,
    };
  }, [window.location.search]);

  const navigationCustomer = location.state?.customer;
  const serviceFlow = location.state?.serviceFlow;
  const startedFromOffDayPicker = serviceFlow?.source === "home_off_day_picker";
  const backToRouteLabel = startedFromOffDayPicker
    ? `Back to ${serviceFlow?.todayDay || "Today"} Route`
    : "Back to Route";

  const customers = useCustomers();
  const createServiceLog = useServiceLogCreate();
  const convexBusiness = useQuery(api.businesses.getCurrent);

  const serviceTypes = useMemo(() => {
    const settingsTypes = convexBusiness?.settings?.service_types;
    if (settingsTypes?.length > 0) return settingsTypes;
    return ['Regular Cleaning', 'Chemical Balance', 'Equipment Check', 'Repair'];
  }, [convexBusiness?.settings?.service_types]);

  const [customer, setCustomer] = useState(navigationCustomer || null);
  const [saving, setSaving] = useState(false);
  const existingLog = location.state?.serviceLog;

  const [formData, setFormData] = useState({
    service_type: existingLog?.service_type || "",
    ph: existingLog?.ph || "good",
    ph_mode: existingLog?.ph_value !== undefined ? "numeric" : "quick",
    ph_value: existingLog?.ph_value ?? "",
    chlorine: existingLog?.chlorine || "good",
    chlorine_mode: existingLog?.chlorine_value !== undefined ? "numeric" : "quick",
    chlorine_value: existingLog?.chlorine_value ?? "",
    alkalinity: existingLog?.alkalinity || "good",
    alkalinity_mode: existingLog?.alkalinity_value !== undefined ? "numeric" : "quick",
    alkalinity_value: existingLog?.alkalinity_value ?? "",
    stabilizer: existingLog?.stabilizer || "good",
    stabilizer_mode: existingLog?.stabilizer_value !== undefined ? "numeric" : "quick",
    stabilizer_value: existingLog?.stabilizer_value ?? "",
    salt: existingLog?.salt ?? "",
    notes: existingLog?.notes || ""
  });
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const draftStorageKey = useMemo(() => (
    customerIdParam ? `serviceLogDraft_${customerIdParam}` : null
  ), [customerIdParam]);
  const draftReadyRef = useRef(false);
  const prevServiceTypesRef = useRef(null);

  // Proof-of-service time tracking state
  const [startTime, setStartTime] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Restore or record check-in time when the page loads
  useEffect(() => {
    if (!customerIdParam) return;

    const stored = getTimeState(customerIdParam);
    if (stored) {
      const state = storedToTimeTrackerState(stored);
      setStartTime(state.startTime);
    } else {
      const now = new Date().toISOString();
      setStartTime(now);
      saveTimeState(customerIdParam, {
        startTime: now,
        endTime: null,
        duration: null,
        isTracking: true,
      });
    }
  }, [customerIdParam]);

  // Update the sticky elapsed-time banner every second
  useEffect(() => {
    if (!startTime) return;
    const tick = () => {
      setElapsedMs(Date.now() - new Date(startTime).getTime());
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Only set service_type when the available types actually change,
  // not on every Convex re-render. Prevents dropdown flicker.
  useEffect(() => {
    if (serviceTypes.length === 0) return;
    const changed = !prevServiceTypesRef.current ||
      prevServiceTypesRef.current.length !== serviceTypes.length ||
      prevServiceTypesRef.current.some((t, i) => t !== serviceTypes[i]);
    if (!changed) return;
    prevServiceTypesRef.current = serviceTypes;

    setFormData(prev => {
      if (prev.service_type && serviceTypes.includes(prev.service_type)) {
        return prev; // user's current selection is still valid
      }
      return { ...prev, service_type: serviceTypes[0] };
    });
  }, [serviceTypes]);

  useEffect(() => {
    if (!draftStorageKey || draftReadyRef.current) return;

    if (typeof window === "undefined" || !window.localStorage) {
      draftReadyRef.current = true;
      return;
    }

    try {
      const savedDraft = window.localStorage.getItem(draftStorageKey);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);

        if (parsed?.formData) {
          setFormData(prev => ({ ...prev, ...parsed.formData }));
        }

        if (parsed?.savedAt) {
          setDraftSavedAt(parsed.savedAt);
        }
      }
    } catch (error) {
      console.error("[NewServiceLog] Failed to restore draft:", error);
    } finally {
      draftReadyRef.current = true;
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || !draftReadyRef.current) return;
    if (typeof window === "undefined" || !window.localStorage) return;

    // Debounce: wait 500ms after the last keystroke before writing.
    // Each new keystroke cancels the previous timer, so we only persist
    // once when the user actually pauses.
    const timeoutId = setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        window.localStorage.setItem(draftStorageKey, JSON.stringify({ formData, savedAt }));
        setDraftSavedAt(savedAt);
      } catch (error) {
        console.error("[NewServiceLog] Failed to save draft:", error);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [formData, draftStorageKey]);

  const [beforePhotos, setBeforePhotos] = useState([]);
  const [afterPhotos, setAfterPhotos] = useState([]);

  const [validationError, setValidationError] = useState(null);

  const { proofOfServiceSettings, isLoading: settingsLoading } = useBusinessSettings();

  const handleBeforePhotosChange = useCallback((photos) => {
    setBeforePhotos(photos);
  }, []);

  const handleAfterPhotosChange = useCallback((photos) => {
    setAfterPhotos(photos);
  }, []);

  const cleanupPerformed = useRef(false);

  // Find the customer once customers + customerId are available.
  useEffect(() => {
    if (customer || !customers || !customerId) return;
    const found = customers.find((c) => c._id === customerId);
    if (found) setCustomer(found);
  }, [customers, customerId, customer]);

  // Run photo cleanup exactly once per page load, when we have a customerId param.
  useEffect(() => {
    if (cleanupPerformed.current) return;
    if (!customerIdParam) return;

    cleanupPerformed.current = true;
    (async () => {
      try {
        await deleteUnlinkedPhotos(customerIdParam);
      } catch (error) {
        console.error('[NewServiceLog] Failed to clean up old photos:', error);
      }
    })();
  }, [customerIdParam]);

  const formattedDraftTime = useMemo(() => {
    if (!draftSavedAt) return null;
    const savedAtDate = new Date(draftSavedAt);
    if (Number.isNaN(savedAtDate.getTime())) return null;
    return savedAtDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [draftSavedAt]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setValidationError(null);

    if (!customerIdParam) {
      console.error('[NewServiceLog] Missing customerIdParam');
      setValidationError('Missing customer information. Please try again.');
      return;
    }

    const validationResult = validateServiceCompletion(proofOfServiceSettings, {
      beforePhotoCount: beforePhotos.length,
      afterPhotoCount: afterPhotos.length,
    });

    if (!validationResult.isValid) {
      const errorMessage = getValidationErrorMessage(validationResult);
      setValidationError(errorMessage);
      return;
    }

    setSaving(true);

    let actualBeforeCount = beforePhotos.length;
    let actualAfterCount = afterPhotos.length;

    try {
      const allPhotos = await getPhotos(customerIdParam);
      const unlinkedPhotos = allPhotos.filter(p => p.serviceLogId === null);
      actualBeforeCount = unlinkedPhotos.filter(p => p.category === 'before').length;
      actualAfterCount = unlinkedPhotos.filter(p => p.category === 'after').length;
    } catch (error) {
      console.error('[NewServiceLog] Failed to get actual photo count, using state values:', error);
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const localDate = `${year}-${month}-${day}`;

    const endTime = new Date().toISOString();
    const durationMs = startTime
      ? Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime())
      : undefined;

    const logData = {
      customer_id: customerId,
      service_date: localDate,
      status: "completed",
      service_type: formData.service_type || undefined,
      notes: formData.notes,
      ph: formData.ph,
      chlorine: formData.chlorine,
      alkalinity: formData.alkalinity,
      stabilizer: formData.stabilizer,
      ph_value: formData.ph_value !== "" ? parseFloat(formData.ph_value) : undefined,
      chlorine_value: formData.chlorine_value !== "" ? parseFloat(formData.chlorine_value) : undefined,
      alkalinity_value: formData.alkalinity_value !== "" ? parseFloat(formData.alkalinity_value) : undefined,
      stabilizer_value: formData.stabilizer_value !== "" ? parseFloat(formData.stabilizer_value) : undefined,
      photo_count: actualBeforeCount + actualAfterCount,
      has_before_photos: actualBeforeCount > 0,
      has_after_photos: actualAfterCount > 0,
      start_time: startTime || undefined,
      end_time: endTime,
      duration_ms: durationMs,
    };

    if (customer?.pool_type === "Salt" && formData.salt) {
      logData.salt = parseFloat(formData.salt);
    }

    // Persist check-out time for crash resilience before submitting
    if (customerIdParam) {
      updateEndTime(customerIdParam, endTime);
    }

    try {
      const serviceLogId = await createServiceLog(logData);

      if (customerIdParam && serviceLogId) {
        try {
          await linkPhotosToServiceLog(customerIdParam, String(serviceLogId));
        } catch (error) {
          console.error('[NewServiceLog] Failed to link photos to service log:', error);
          toast.error('Service log saved, but photos may not be attached. Please check the service log.');
        }
      }

      if (!prefersReducedMotion) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#06b6d4', '#3b82f6', '#a855f7']
        });
      }

      if (draftStorageKey && typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(draftStorageKey);
        setDraftSavedAt(null);
      }

      if (customerIdParam) {
        clearTimeState(customerIdParam);
      }

      if (startedFromOffDayPicker && serviceFlow?.selectedDay) {
        toast.success(
          `Saved ${customer?.full_name || "client"} from ${serviceFlow.selectedDay}.`
        );
      }

      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate(createPageUrl("CustomerDetail") + `?id=${customerIdParam}`);
      }
    } catch (error) {
      console.error('[NewServiceLog] Failed to create service log:', error);

      setSaving(false);

      setValidationError('Failed to save service log. Please try again.');
    }
  };

  if (!customer) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <ChemicalBeakerLoader />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-sans">
      <div className="mb-6">
        <BackButton
          fallback={createPageUrl("Home")}
          label={backToRouteLabel}
          className="mb-4"
        />

        <div className="flex items-center justify-between">
          <div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Service Log</h2>
              <p className="text-sm font-medium text-slate-600">{customer.full_name}</p>
              {formattedDraftTime && (
                <p className="text-xs font-medium text-slate-500 mt-1">Draft saved at {formattedDraftTime}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {startTime && (
          <div className="sticky top-0 z-50 mb-6 p-4 bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200 rounded-xl shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-cyan-700 uppercase tracking-wide">
                  Checked in
                </p>
                <p className="text-sm font-medium text-cyan-900">
                  {new Date(startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-cyan-700 uppercase tracking-wide">
                  Elapsed
                </p>
                <p className="text-2xl font-bold text-cyan-900 tabular-nums">
                  {formatDuration(elapsedMs)}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6">
          <PhotoCaptureSection
            serviceLogId={null}
            customerId={customerIdParam || ""}
            category="before"
            title="Before Photos"
            description="Capture photos of the pool before service"
            disabled={saving}
            onPhotosChange={handleBeforePhotosChange}
          />
        </div>

        <Card className="p-6 mb-6 border-2 shadow-lg">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="w-5 h-5 text-cyan-600 stroke-[1.75]" />
            <h3 className="text-lg font-bold tracking-tight text-slate-900">Service Type</h3>
          </div>
          <Select
            value={formData.service_type}
            onValueChange={(value) => setFormData({ ...formData, service_type: value })}
          >
            <SelectTrigger className="bg-white text-slate-900 border-2 border-slate-200 focus:border-cyan-500 rounded-xl h-11">
              <SelectValue placeholder="Select service type" />
            </SelectTrigger>
            <SelectContent>
              {serviceTypes.map(type => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>

        <Card className="p-6 mb-6 border-2 shadow-lg">
          <h3 className="text-lg font-bold tracking-tight text-slate-900 mb-2 flex items-center gap-2">
            <TestTube className="w-5 h-5 text-cyan-600 stroke-[1.75]" />
            Chemical Readings
          </h3>
          <p className="text-sm font-medium text-slate-600 mb-6">Select the level for each chemical test</p>

          <div className="space-y-6">
            <SimplifiedChemicalInput
              label="pH Balance"
              value={formData.ph}
              onChange={(val) => setFormData({ ...formData, ph: val })}
              mode={formData.ph_mode}
              onModeChange={(mode) => setFormData({ ...formData, ph_mode: mode })}
              numericValue={formData.ph_value}
              onNumericValueChange={(val) => setFormData({ ...formData, ph_value: val })}
              config={CHEMICAL_CONFIGS.ph}
              icon={<Activity className="w-4 h-4 stroke-[1.75]" />}
              testId="ph-numeric-input"
            />

            <SimplifiedChemicalInput
              label="Chlorine Level"
              value={formData.chlorine}
              onChange={(val) => setFormData({ ...formData, chlorine: val })}
              mode={formData.chlorine_mode}
              onModeChange={(mode) => setFormData({ ...formData, chlorine_mode: mode })}
              numericValue={formData.chlorine_value}
              onNumericValueChange={(val) => setFormData({ ...formData, chlorine_value: val })}
              config={CHEMICAL_CONFIGS.chlorine}
              icon={<Droplets className="w-4 h-4 stroke-[1.75]" />}
              testId="chlorine-numeric-input"
            />

            <SimplifiedChemicalInput
              label="Total Alkalinity"
              value={formData.alkalinity}
              onChange={(val) => setFormData({ ...formData, alkalinity: val })}
              mode={formData.alkalinity_mode}
              onModeChange={(mode) => setFormData({ ...formData, alkalinity_mode: mode })}
              numericValue={formData.alkalinity_value}
              onNumericValueChange={(val) => setFormData({ ...formData, alkalinity_value: val })}
              config={CHEMICAL_CONFIGS.alkalinity}
              icon={<TestTube className="w-4 h-4 stroke-[1.75]" />}
              testId="alkalinity-numeric-input"
            />

            <SimplifiedChemicalInput
              label="Stabilizer (Cyanuric Acid)"
              value={formData.stabilizer}
              onChange={(val) => setFormData({ ...formData, stabilizer: val })}
              mode={formData.stabilizer_mode}
              onModeChange={(mode) => setFormData({ ...formData, stabilizer_mode: mode })}
              numericValue={formData.stabilizer_value}
              onNumericValueChange={(val) => setFormData({ ...formData, stabilizer_value: val })}
              config={CHEMICAL_CONFIGS.stabilizer}
              icon={<TestTube className="w-4 h-4 stroke-[1.75]" />}
              testId="stabilizer-numeric-input"
            />

            {customer.pool_type === "Salt" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Waves className="w-4 h-4 text-cyan-600 stroke-[1.75]" />
                  <Label className="text-sm font-semibold text-slate-700">Salt Level (PPM)</Label>
                </div>
                <Input
                  type="number"
                  value={formData.salt}
                  onChange={(e) => setFormData({ ...formData, salt: e.target.value })}
                  placeholder="3200"
                  className="border-2 focus:border-cyan-500 rounded-xl"
                />
                <p className="text-xs font-medium text-slate-500">Ideal range: 2700-3400 PPM</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6 mb-6 border-2 shadow-lg">
          <h3 className="text-lg font-bold tracking-tight text-slate-900 mb-4">Service Notes</h3>
          <Label htmlFor="notes" className="text-slate-700 font-semibold mb-2 block">
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

        <div className="mb-6">
          <PhotoCaptureSection
            serviceLogId={null}
            customerId={customerIdParam || ""}
            category="after"
            title="After Photos"
            description="Capture photos of the pool after service"
            disabled={saving}
            onPhotosChange={handleAfterPhotosChange}
          />
        </div>

        {validationError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        )}

        {!settingsLoading && hasAnyRequirements(proofOfServiceSettings) && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-sm font-medium text-amber-800">
              Required for completion: {getRequirementsSummary(proofOfServiceSettings).join(', ')}
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <BackButton
            fallback={createPageUrl("Home")}
            label="Cancel"
            variant="outline"
            className="flex-1 border-2 rounded-xl"
          />
          <Button
            type="submit"
            disabled={saving}
            className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg rounded-xl disabled:opacity-70"
          >
            {saving ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Saving...</span>
              </div>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2 stroke-[1.75]" />
                Complete Service
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
