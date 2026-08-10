import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useCustomers, useServiceLogCreate, useServiceLogsByCustomerDateRange } from "@/api/convexHooks";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "convex/react";
import { endOfWeek, format, startOfWeek, subWeeks } from "date-fns";
import { api } from "../../convex/_generated/api";
import { createPageUrl } from "@/utils";
import { Save, Droplets, Activity, AlertCircle, Camera } from "lucide-react";
import { PoolIcon, IconBadge } from "@/components/ui/iconography";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/navigation/BackButton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import SimplifiedChemicalInput from "../components/servicelog/SimplifiedChemicalInput";
import LastWeekChemistry from "@/components/servicelog/LastWeekChemistry";
import { ChemicalBeakerLoader } from "@/components/ui/loader";
import { hapticSuccess } from "@/lib/haptics";
import { CHEMICAL_CONFIGS } from "@/lib/chemStatus";
import { transitionName } from "@/lib/viewTransitions";
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
  const navigationLastWeekLog = location.state?.lastWeekLog;
  const serviceFlow = location.state?.serviceFlow;
  const startedFromOffDayPicker = serviceFlow?.source === "home_off_day_picker";
  const backToRouteLabel = startedFromOffDayPicker
    ? `Back to ${serviceFlow?.todayDay || "Today"} Route`
    : "Back to Route";

  const customers = useCustomers();
  const createServiceLog = useServiceLogCreate();
  const convexBusiness = useQuery(api.businesses.getCurrent);
  const lastWeekRange = useMemo(() => {
    const lastWeek = subWeeks(new Date(), 1);
    return {
      start: format(startOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      end: format(endOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    };
  }, []);
  const lastWeekLogs = useServiceLogsByCustomerDateRange(
    navigationLastWeekLog ? undefined : customerId || undefined,
    lastWeekRange.start,
    lastWeekRange.end,
    1
  );
  const lastWeekLog = navigationLastWeekLog || lastWeekLogs[0] || null;

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

      // Tactile confirmation at the moment of commit; the visual celebration
      // fires on the destination screen (Home), not mid-unmount here.
      void hapticSuccess();
      try {
        sessionStorage.setItem(
          'chemcheck_last_service',
          JSON.stringify({ name: customer?.full_name || 'Service', at: Date.now() })
        );
      } catch {
        /* storage unavailable — Home simply skips the arrival feedback */
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

  const customerLookupPending = Boolean(customerIdParam) && !customers;

  if (!customer && customerLookupPending) {
    return (
      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4 font-sans sm:px-6 lg:px-8" aria-label="Service Log">
        <div className="flex min-h-[60vh] items-center justify-center rounded-sheet border border-line bg-surface-1 shadow-card ">
          <ChemicalBeakerLoader />
        </div>
      </main>
    );
  }

  if (!customer) {
    const missingTitle = customerIdParam ? "Client not found" : "Choose a client first";
    const missingMessage = customerIdParam
      ? "We couldn't find that client. Pick a client from your route or client list before logging service."
      : "A service log needs a client so photos, chemistry, notes, and billing stay attached to the right pool.";

    return (
      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4 font-sans sm:px-6 lg:px-8" aria-label="Service Log">
        <section className="rounded-sheet border border-line bg-surface-1 p-5 text-center shadow-card ">
          <IconBadge name="clients" size="lg" className="mx-auto mb-4" iconClassName="h-7 w-7" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">Field service</p>
          <h2 className="text-3xl font-semibold tracking-[-0.045em] text-ink">{missingTitle}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm font-medium leading-6 text-ink-secondary">{missingMessage}</p>
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              onClick={() => navigate(createPageUrl("Clients"))}
              className="h-11 rounded-full bg-brand font-semibold text-white shadow-cta hover:bg-brand-strong"
            >
              <PoolIcon name="clients" className="mr-2 h-4 w-4" />
              Go to Clients
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(createPageUrl("Home"))}
              className="h-11 rounded-full border border-line bg-surface-1 font-semibold text-ink-secondary hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
            >
              <PoolIcon name="home" className="mr-2 h-4 w-4" />
              Back to Home
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-4 font-sans sm:px-6 lg:px-8">
      <section
        aria-labelledby="service-log-title"
        className="mb-4 overflow-hidden rounded-sheet border border-line bg-surface-1 shadow-card"
        style={transitionName(`customer-${customerIdParam}`)}
      >
        <div className="flex min-h-12 items-center justify-between gap-2 border-b border-line bg-surface-2 px-2 py-1.5 sm:px-3">
          <BackButton
            fallback={createPageUrl("Home")}
            label={backToRouteLabel}
            className="h-10 min-w-0 justify-start rounded-full px-3 text-sm font-semibold text-ink-secondary shadow-none hover:bg-surface-1 hover:text-ink"
          />

          {formattedDraftTime && (
            <span
              role="status"
              aria-live="polite"
              aria-label={`Draft saved at ${formattedDraftTime}`}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[var(--status-ok-line)] bg-[var(--status-ok-soft)] px-2.5 text-[0.6875rem] font-semibold text-[var(--status-ok-ink)]"
            >
              <PoolIcon name="done" className="h-3.5 w-3.5" />
              <span className="tabular-nums">Saved {formattedDraftTime}</span>
            </span>
          )}
        </div>

        <div className="px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            <IconBadge
              name="ops"
              size="md"
              className="mt-0.5 bg-brand-softer text-brand-ink"
              iconClassName="h-5 w-5"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[0.6875rem] font-semibold uppercase leading-4 tracking-[0.18em] text-brand-ink">
                Field service
              </p>
              <h1
                id="service-log-title"
                className="mt-1 text-2xl font-semibold leading-tight tracking-[-0.04em] text-ink"
              >
                Service Log
              </h1>
              <p
                data-testid="service-log-customer-name"
                className="mt-0.5 truncate text-base font-semibold leading-5 text-ink-secondary"
              >
                {customer.full_name}
              </p>
            </div>
          </div>
          <LastWeekChemistry log={lastWeekLog} />
        </div>
      </section>

      <form onSubmit={handleSubmit}>
        {startTime && (
          <div
            className="sticky top-2 z-30 mb-4 rounded-full border border-line bg-surface-1 px-3 py-2 shadow-card"
            aria-label={`Checked in at ${new Date(startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Elapsed ${formatDuration(elapsedMs)}.`}
          >
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-ink-muted">
              <span className="truncate">
                <span className="text-ink-muted">In</span>{" "}
                <span className="text-ink-secondary">{new Date(startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              </span>
              <span className="tabular-nums text-ink">{formatDuration(elapsedMs)}</span>
            </div>
          </div>
        )}

        <Card className="mb-5 rounded-sheet border border-line bg-surface-1 p-5 shadow-card ">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.025em] text-ink">
                <Camera className="h-5 w-5 text-brand-ink" aria-hidden="true" />
                Service Photos
              </h3>
              <p className="mt-1 text-sm font-medium text-ink-secondary">
                Capture before and after proof in one place.
              </p>
            </div>
          </div>
          <div className="overflow-hidden rounded-raised border border-line bg-gradient-to-br from-surface-1 via-brand-softer to-surface-1 shadow-sm">
            <div className="divide-y divide-line">
              <PhotoCaptureSection
                serviceLogId={null}
                customerId={customerIdParam || ""}
                category="before"
                title="Before Photos"
                description="Before service"
                disabled={saving}
                embedded
                streamlined
                onPhotosChange={handleBeforePhotosChange}
              />
              <PhotoCaptureSection
                serviceLogId={null}
                customerId={customerIdParam || ""}
                category="after"
                title="After Photos"
                description="After service"
                disabled={saving}
                embedded
                streamlined
                onPhotosChange={handleAfterPhotosChange}
              />
            </div>
          </div>
        </Card>

        <Card className="mb-5 rounded-sheet border border-line bg-surface-1 p-5 shadow-card ">
          <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold tracking-[-0.025em] text-ink">
            <PoolIcon name="chemicals" className="h-5 w-5 text-brand-ink" />
            Chemical Readings
          </h3>
          <p className="mb-4 text-sm font-medium text-ink-secondary">Select the level for each chemical test</p>

          <div className="space-y-3">
            <SimplifiedChemicalInput
              label="pH Balance"
              value={formData.ph}
              onChange={(val) => setFormData({ ...formData, ph: val })}
              mode={formData.ph_mode}
              onModeChange={(mode) => setFormData({ ...formData, ph_mode: mode })}
              numericValue={formData.ph_value}
              onNumericValueChange={(val) => setFormData({ ...formData, ph_value: val })}
              config={CHEMICAL_CONFIGS.ph}
              icon={<Activity className="w-4 h-4" />}
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
              icon={<Droplets className="w-4 h-4" />}
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
              icon={<PoolIcon name="chemicals" className="h-4 w-4" />}
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
              icon={<PoolIcon name="chemicals" className="h-4 w-4" />}
              testId="stabilizer-numeric-input"
            />

            {customer.pool_type === "Salt" && (
              <div className="rounded-raised border border-line bg-surface-1 p-3">
                <div className="flex items-center gap-2">
                  <PoolIcon name="waterLevel" className="h-4 w-4 text-brand-ink" />
                  <Label className="text-sm font-semibold text-ink">Salt Level (PPM)</Label>
                </div>
                <Input
                  type="number"
                  value={formData.salt}
                  onChange={(e) => setFormData({ ...formData, salt: e.target.value })}
                  placeholder="3200"
                  className="mt-3 h-12 rounded-2xl border border-line bg-white focus:border-ring"
                />
                <p className="mt-2 text-xs font-medium text-ink-muted">Ideal range: 2700-3400 PPM</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="mb-5 rounded-sheet border border-line bg-surface-1 p-5 shadow-card ">
          <h3 className="mb-4 text-lg font-semibold tracking-[-0.025em] text-ink">Service Notes</h3>
          <Label htmlFor="notes" className="mb-2 block text-sm font-semibold text-ink">
            Notes (optional)
          </Label>
          <Textarea
            id="notes"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Dog was in yard, filter pressure high, added 2 gallons of liquid chlorine..."
            rows={4}
            className="rounded-2xl border border-line bg-white focus:border-ring"
          />
        </Card>


        {validationError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        )}

        {!settingsLoading && hasAnyRequirements(proofOfServiceSettings) && (
          <div className="mb-5 rounded-raised border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] p-4">
            <p className="text-sm font-semibold text-watch">
              Required for completion: {getRequirementsSummary(proofOfServiceSettings).join(', ')}
            </p>
          </div>
        )}

        {/* End-of-form actions stay in the document flow so they do not cover
            service details while the technician scrolls. */}
        <div
          role="group"
          aria-label="Service actions"
          className="-mx-4 mt-6 border-t border-line bg-surface-1 px-4 pb-3 pt-3 sm:-mx-6 sm:px-6"
        >
          <Button
            type="submit"
            disabled={saving}
            className="h-14 w-full rounded-card bg-brand text-base font-semibold text-white shadow-cta hover:bg-brand-strong disabled:opacity-70"
          >
            {saving ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                <span>Saving...</span>
              </div>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                Complete Service
              </>
            )}
          </Button>
          <BackButton
            fallback={createPageUrl("Home")}
            label="Cancel"
            variant="ghost"
            showIcon={false}
            className="mt-1 h-11 w-full rounded-card text-ink-muted"
          />
        </div>
      </form>
    </div>
  );
}
