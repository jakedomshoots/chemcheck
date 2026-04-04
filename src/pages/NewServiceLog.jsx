import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useCustomers, useServiceLogCreate } from "@/api/convexHooks";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Save, Droplets, TestTube, Waves, Activity, AlertCircle, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export default function NewServiceLog() {
  const navigate = useNavigate();
  const location = useLocation();
  const urlParams = new URLSearchParams(window.location.search);
  const customerIdParam = urlParams.get("customerId");
  const customerId = customerIdParam ? parseInt(customerIdParam, 10) : null;

  // Clear any stored time tracking data on component mount
  useEffect(() => {
    // Clear any time tracking data from localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('timeTracker_')) {
          keysToRemove.push(key);
        }
      }
      if (keysToRemove.length > 0) {
        console.log('Clearing time tracking data:', keysToRemove);
        keysToRemove.forEach(key => localStorage.removeItem(key));
      }
    }
  }, []);

  // Use navigation state for instant render if available
  const navigationCustomer = location.state?.customer;
  const serviceFlow = location.state?.serviceFlow;
  const startedFromOffDayPicker = serviceFlow?.source === "home_off_day_picker";
  const backToRouteLabel = startedFromOffDayPicker
    ? `Back to ${serviceFlow?.todayDay || "Today"} Route`
    : "Back to Route";

  const customers = useCustomers();
  const createServiceLog = useServiceLogCreate();
  const convexBusiness = useQuery(api.businesses.getCurrent);

  // Get service types from business settings
  const serviceTypes = useMemo(() => {
    const settingsTypes = convexBusiness?.settings?.service_types;
    if (settingsTypes?.length > 0) return settingsTypes;
    return ['Regular Cleaning', 'Chemical Balance', 'Equipment Check', 'Repair'];
  }, [convexBusiness?.settings?.service_types]);

  // Initialize with navigation state for instant form render
  const [customer, setCustomer] = useState(navigationCustomer || null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    service_type: "",
    ph: "good",
    chlorine: "good",
    alkalinity: "good",
    stabilizer: "good",
    salt: "",
    notes: ""
  });
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const draftStorageKey = useMemo(() => (
    customerIdParam ? `serviceLogDraft_${customerIdParam}` : null
  ), [customerIdParam]);
  const draftReadyRef = useRef(false);

  // Set default service type once serviceTypes are loaded
  useEffect(() => {
    if (serviceTypes.length > 0 && !formData.service_type) {
      setFormData(prev => ({ ...prev, service_type: serviceTypes[0] }));
    }
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

    try {
      const savedAt = new Date().toISOString();
      window.localStorage.setItem(draftStorageKey, JSON.stringify({ formData, savedAt }));
      setDraftSavedAt(savedAt);
    } catch (error) {
      console.error("[NewServiceLog] Failed to save draft:", error);
    }
  }, [formData, draftStorageKey]);

  // Photo capture state - Requirements 1.1, 1.6, 1.7
  const [beforePhotos, setBeforePhotos] = useState([]);
  const [afterPhotos, setAfterPhotos] = useState([]);

  // Validation error state - Requirements 5.2, 5.4
  const [validationError, setValidationError] = useState(null);

  // Business settings for proof-of-service requirements - Requirements 5.1, 5.3
  const { proofOfServiceSettings, isLoading: settingsLoading } = useBusinessSettings();

  // Callbacks for photo changes
  const handleBeforePhotosChange = useCallback((photos) => {
    setBeforePhotos(photos);
  }, []);

  const handleAfterPhotosChange = useCallback((photos) => {
    setAfterPhotos(photos);
  }, []);

  // Track if cleanup has been performed to avoid deleting newly captured photos
  const cleanupPerformed = useRef(false);

  useEffect(() => {
    console.log("NewServiceLog params:", { customerId, customersLoaded: customers?.length });
    // Only lookup if we don't have customer from navigation state
    if (customers && customerId && !customer) {
      const found = customers.find((c) => c._id === customerId);
      console.log("Found customer:", found);
      setCustomer(found);

      // Clean up old unlinked photos ONLY ONCE when customer is first loaded
      // This ensures a fresh start for each new service log session
      // but doesn't delete photos captured during the current session
      if (found && customerIdParam && !cleanupPerformed.current) {
        console.log('[NewServiceLog] Cleaning up old unlinked photos for customer:', customerIdParam);
        cleanupPerformed.current = true;

        // Use IIFE to handle async operation in useEffect
        (async () => {
          try {
            await deleteUnlinkedPhotos(customerIdParam);
            console.log('[NewServiceLog] Cleanup completed successfully');
          } catch (error) {
            console.error('[NewServiceLog] Failed to clean up old photos:', error);
          }
        })();
      }
    } else if (customer && customerIdParam && !cleanupPerformed.current) {
      // We have customer from navigation, still need to clean up photos
      console.log('[NewServiceLog] Cleaning up old unlinked photos for customer (from nav state):', customerIdParam);
      cleanupPerformed.current = true;

      (async () => {
        try {
          await deleteUnlinkedPhotos(customerIdParam);
          console.log('[NewServiceLog] Cleanup completed successfully');
        } catch (error) {
          console.error('[NewServiceLog] Failed to clean up old photos:', error);
        }
      })();
    }
  }, [customers, customerId, customerIdParam, customer]);

  const formattedDraftTime = useMemo(() => {
    if (!draftSavedAt) return null;
    const savedAtDate = new Date(draftSavedAt);
    if (Number.isNaN(savedAtDate.getTime())) return null;
    return savedAtDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [draftSavedAt]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Clear any previous validation errors
    setValidationError(null);

    // Defensive check for customerIdParam
    if (!customerIdParam) {
      console.error('[NewServiceLog] Missing customerIdParam');
      setValidationError('Missing customer information. Please try again.');
      return;
    }

    console.log('[NewServiceLog handleSubmit] Before photos:', beforePhotos.length, 'After photos:', afterPhotos.length);
    console.log('[NewServiceLog handleSubmit] Before photos array:', beforePhotos);
    console.log('[NewServiceLog handleSubmit] After photos array:', afterPhotos);

    // Validate proof-of-service requirements before submission - Requirements 5.2, 5.4
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

    // Get actual photo count from IndexedDB to ensure accuracy
    // This handles cases where state might not be fully updated
    let actualBeforeCount = beforePhotos.length;
    let actualAfterCount = afterPhotos.length;

    try {
      const allPhotos = await getPhotos(customerIdParam);
      const unlinkedPhotos = allPhotos.filter(p => p.serviceLogId === null);
      actualBeforeCount = unlinkedPhotos.filter(p => p.category === 'before').length;
      actualAfterCount = unlinkedPhotos.filter(p => p.category === 'after').length;
      console.log('[NewServiceLog] Actual photo counts from IndexedDB - before:', actualBeforeCount, 'after:', actualAfterCount);
    } catch (error) {
      console.error('[NewServiceLog] Failed to get actual photo count, using state values:', error);
    }

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
      service_type: formData.service_type || undefined,
      notes: formData.notes,
      ph: formData.ph,
      chlorine: formData.chlorine,
      alkalinity: formData.alkalinity,
      stabilizer: formData.stabilizer,
      // Include photo tracking data - Requirement 4.1
      photo_count: actualBeforeCount + actualAfterCount,
      has_before_photos: actualBeforeCount > 0,
      has_after_photos: actualAfterCount > 0,
    };

    console.log('[NewServiceLog] Creating service log with photo_count:', logData.photo_count);
    console.log('[NewServiceLog] has_before_photos:', logData.has_before_photos, 'has_after_photos:', logData.has_after_photos);

    if (customer?.pool_type === "Salt" && formData.salt) {
      logData.salt = parseFloat(formData.salt);
    }

    try {
      const serviceLogId = await createServiceLog(logData);
      console.log('[NewServiceLog] Service log created with ID:', serviceLogId);
      console.log('[NewServiceLog] Customer ID param:', customerIdParam);
      console.log('[NewServiceLog] Before photos:', beforePhotos.length, 'After photos:', afterPhotos.length);

      // Link photos to the newly created service log - Requirement 4.1
      if (customerIdParam && serviceLogId) {
        try {
          console.log('[NewServiceLog] Linking photos to service log...');
          await linkPhotosToServiceLog(customerIdParam, String(serviceLogId));
          console.log('[NewServiceLog] Photos linked successfully');
        } catch (error) {
          console.error('[NewServiceLog] Failed to link photos to service log:', error);
          // Don't fail the whole operation if photo linking fails, but notify the user
          toast.error('Service log saved, but photos may not be attached. Please check the service log.');
        }
      } else {
        console.warn('[NewServiceLog] Skipping photo linking - missing customerIdParam or serviceLogId');
      }

      // Fire confetti after successful save
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#06b6d4', '#3b82f6', '#a855f7'] // Cyan, Blue, Purple
      });

      if (draftStorageKey && typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(draftStorageKey);
        setDraftSavedAt(null);
      }

      if (startedFromOffDayPicker && serviceFlow?.selectedDay) {
        toast.success(
          `Saved ${customer?.full_name || "client"} from ${serviceFlow.selectedDay}. Returning to ${serviceFlow?.todayDay || "today"}.`
        );
      }

      // Navigate immediately - don't wait
      navigate(createPageUrl("Home"));
    } catch (error) {
      console.error('[NewServiceLog] Failed to create service log:', error);

      // Reset saving state to allow retry
      setSaving(false);

      // Show error to user
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
        <Button
          variant="ghost"
          onClick={() => navigate(createPageUrl("Home"))}
          className="mb-4 group"
        >
          <ArrowLeft className="w-4 h-4 mr-2 stroke-[1.75] group-hover:-translate-x-1 transition-transform" />
          {backToRouteLabel}
        </Button>

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
          {/* Timer removed - no time tracking display */}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Before Photos Section - Requirement 1.1 */}
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

        {/* Service Type Selector */}
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
              icon={<Activity className="w-4 h-4 stroke-[1.75]" />}
            />

            <SimplifiedChemicalInput
              label="Chlorine Level"
              value={formData.chlorine}
              onChange={(val) => setFormData({ ...formData, chlorine: val })}
              icon={<Droplets className="w-4 h-4 stroke-[1.75]" />}
            />

            <SimplifiedChemicalInput
              label="Total Alkalinity"
              value={formData.alkalinity}
              onChange={(val) => setFormData({ ...formData, alkalinity: val })}
              icon={<TestTube className="w-4 h-4 stroke-[1.75]" />}
            />

            <SimplifiedChemicalInput
              label="Stabilizer (Cyanuric Acid)"
              value={formData.stabilizer}
              onChange={(val) => setFormData({ ...formData, stabilizer: val })}
              icon={<TestTube className="w-4 h-4 stroke-[1.75]" />}
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

        {/* After Photos Section - Requirement 1.1 */}
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

        {/* Validation Error Display - Requirement 5.4 */}
        {validationError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        )}

        {/* Requirements Summary - Requirements 5.1, 5.3 */}
        {!settingsLoading && hasAnyRequirements(proofOfServiceSettings) && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-sm font-medium text-amber-800">
              Required for completion: {getRequirementsSummary(proofOfServiceSettings).join(', ')}
            </p>
          </div>
        )}

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
