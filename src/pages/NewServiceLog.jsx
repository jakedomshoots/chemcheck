import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useCustomers, useServiceLogCreate } from "@/api/convexHooks";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { format } from "date-fns";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Save, Droplets, TestTube, Waves, Activity, AlertCircle, ClipboardList, CheckCircle2 } from "lucide-react";
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

const parseCustomerId = (value) => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeDayName = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (["monday", "mon"].includes(normalized)) return "Monday";
  if (["tuesday", "tue", "tues"].includes(normalized)) return "Tuesday";
  if (["wednesday", "wed", "weds"].includes(normalized)) return "Wednesday";
  if (["thursday", "thu", "thur", "thurs"].includes(normalized)) return "Thursday";
  if (["friday", "fri"].includes(normalized)) return "Friday";
  if (["saturday", "sat"].includes(normalized)) return "Saturday";
  if (["sunday", "sun"].includes(normalized)) return "Sunday";
  return null;
};

const normalizeRouteOrderIds = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => parseCustomerId(id))
    .filter((id) => id !== null);
};

const formatCustomerName = (customer) => customer?.full_name || "customer";

export default function NewServiceLog() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state || {};

  const urlParams = new URLSearchParams(window.location.search);
  const customerIdParam = parseCustomerId(urlParams.get("customerId"));
  const navigationCustomer = navState.customer;
  const returnIntent = navState.returnIntent || null;
  const routeOrderFromState = useMemo(() => normalizeRouteOrderIds(navState.routeOrderIds), [navState.routeOrderIds]);
  const routeDayOfWeek = useMemo(() => (
    normalizeDayName(navState.routeDay) ||
    normalizeDayName(navState.dayOfWeek) ||
    format(new Date(), "EEEE")
  ), [navState.routeDay, navState.dayOfWeek]);

  const customers = useCustomers();
  const createServiceLog = useServiceLogCreate();
  const convexBusiness = useQuery(api.businesses.getCurrent);

  // Get service types from business settings
  const serviceTypes = useMemo(() => {
    const settingsTypes = convexBusiness?.settings?.service_types;
    if (settingsTypes?.length > 0) return settingsTypes;
    return ["Regular Cleaning", "Chemical Balance", "Equipment Check", "Repair"];
  }, [convexBusiness?.settings?.service_types]);

  // Initialize with navigation state for instant form render
  const [customer, setCustomer] = useState(navigationCustomer || null);
  const [saving, setSaving] = useState(false);
  const [postSaveState, setPostSaveState] = useState(null);
  const [formData, setFormData] = useState({
    service_type: "",
    ph: "good",
    chlorine: "good",
    alkalinity: "good",
    stabilizer: "good",
    salt: "",
    notes: "",
  });
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const draftStorageKey = useMemo(() => (customerIdParam ? `serviceLogDraft_${customerIdParam}` : null), [customerIdParam]);
  const draftReadyRef = useRef(false);

  const [beforePhotos, setBeforePhotos] = useState([]);
  const [afterPhotos, setAfterPhotos] = useState([]);

  // Business settings for proof-of-service requirements - Requirements 5.1, 5.3
  const { proofOfServiceSettings, isLoading: settingsLoading } = useBusinessSettings();

  const { beforePhotoRequirement, afterPhotoRequirement } = useMemo(() => {
    const beforeMin = proofOfServiceSettings?.require_before_photos
      ? (Number.parseInt(String(proofOfServiceSettings.min_photos_before), 10) || 1)
      : 0;
    const afterMin = proofOfServiceSettings?.require_after_photos
      ? (Number.parseInt(String(proofOfServiceSettings.min_photos_after), 10) || 1)
      : 0;

    return {
      beforePhotoRequirement: beforeMin,
      afterPhotoRequirement: afterMin,
    };
  }, [proofOfServiceSettings]);

  const flowRouteOrder = useMemo(() => routeOrderFromState, [routeOrderFromState]);

  const nextCustomerFromRoute = useMemo(() => {
    if (!customerIdParam) return null;
    if (!flowRouteOrder.length) return parseCustomerId(navState.nextCustomerId);

    const currentIndex = flowRouteOrder.indexOf(customerIdParam);
    if (currentIndex === -1) return parseCustomerId(navState.nextCustomerId);

    const next = flowRouteOrder[currentIndex + 1];
    return Number.isFinite(next) ? next : null;
  }, [flowRouteOrder, customerIdParam, navState.nextCustomerId]);

  const routeOrderAhead = useMemo(() => {
    if (!flowRouteOrder.length || !customerIdParam) {
      return flowRouteOrder;
    }

    const currentIndex = flowRouteOrder.indexOf(customerIdParam);
    if (currentIndex === -1) return flowRouteOrder;
    return flowRouteOrder.slice(currentIndex + 1);
  }, [flowRouteOrder, customerIdParam]);

  const nextCustomer = useMemo(() => {
    if (!nextCustomerFromRoute) return null;
    return customers?.find((c) => parseCustomerId(c._id) === nextCustomerFromRoute) || null;
  }, [customers, nextCustomerFromRoute]);

  const readinessItems = useMemo(() => {
    const requirements = [
      {
        label: "Customer loaded",
        complete: Boolean(customer),
      },
      {
        label: "Service type selected",
        complete: Boolean(formData.service_type),
      },
      {
        label: "Readings entered",
        complete: Boolean(formData.ph && formData.chlorine && formData.alkalinity && formData.stabilizer),
      },
    ];

    const effectiveRequirements = getRequirementsSummary(proofOfServiceSettings, formData.service_type);
    const requirementLookup = new Set(effectiveRequirements);

    if (beforePhotoRequirement > 0) {
      requirements.push({
        label: `${beforePhotoRequirement} before photo${beforePhotoRequirement === 1 ? "" : "s"} required`,
        complete: beforePhotos.length >= beforePhotoRequirement,
        required: true,
      });
    } else if (requirementLookup.has("before photos")) {
      requirements.push({
        label: "Before photo required",
        complete: beforePhotos.length >= 1,
        required: true,
      });
    }

    if (afterPhotoRequirement > 0) {
      requirements.push({
        label: `${afterPhotoRequirement} after photo${afterPhotoRequirement === 1 ? "" : "s"} required`,
        complete: afterPhotos.length >= afterPhotoRequirement,
        required: true,
      });
    } else if (requirementLookup.has("after photos")) {
      requirements.push({
        label: "After photo required",
        complete: afterPhotos.length >= 1,
        required: true,
      });
    }

    return requirements;
  }, [customer, formData, proofOfServiceSettings, beforePhotoRequirement, afterPhotoRequirement, beforePhotos.length, afterPhotos.length]);

  const readinessProgress = useMemo(() => {
    const completed = readinessItems.filter((item) => item.complete).length;
    const total = readinessItems.length || 1;
    return `${completed}/${total} ready`;
  }, [readinessItems]);

  const nextActionLabel = useMemo(() => {
    if (nextCustomer) {
      return `Continue to ${formatCustomerName(nextCustomer)}`;
    }

    return returnIntent === "continue_route"
      ? "Return to Route Flow"
      : "Return to Home";
  }, [nextCustomer, returnIntent]);

  const routeContextLabel = returnIntent === "continue_route" ? "Continue route flow" : "Complete single service";
  const routeQueueSummary = useMemo(() => {
    const remaining = routeOrderFromState.filter((id) => id !== customerIdParam);
    if (!remaining.length) return "No more stops remaining in route queue.";
    return `${remaining.length} stop${remaining.length === 1 ? "s" : ""} queued after this one.`;
  }, [routeOrderFromState, customerIdParam]);

  const readinessItemsTitle = useMemo(() => {
    if (returnIntent === "continue_route") {
      return "Route Readiness";
    }
    return "Log Readiness";
  }, [returnIntent]);

  const clearCachedTimeTracking = useCallback(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('timeTracker_')) {
        keysToRemove.push(key);
      }
    }

    if (keysToRemove.length > 0) {
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    }
  }, []);

  // Clear any stored time tracking data on component mount
  useEffect(() => {
    clearCachedTimeTracking();
  }, [clearCachedTimeTracking]);

  // Set default service type once serviceTypes are loaded
  useEffect(() => {
    if (serviceTypes.length > 0 && !formData.service_type) {
      setFormData((prev) => ({ ...prev, service_type: serviceTypes[0] }));
    }
  }, [serviceTypes, formData.service_type]);

  // Load and persist draft
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
          setFormData((prev) => ({ ...prev, ...parsed.formData }));
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
  const handleBeforePhotosChange = useCallback((photos) => {
    setBeforePhotos(photos);
  }, []);

  const handleAfterPhotosChange = useCallback((photos) => {
    setAfterPhotos(photos);
  }, []);

  // Track if cleanup has been performed to avoid deleting newly captured photos
  const cleanupPerformed = useRef(false);

  useEffect(() => {
    console.log("NewServiceLog params:", { customerIdParam, customersLoaded: customers?.length });

    if (customers && customerIdParam && !customer) {
      const found = customers.find((c) => parseCustomerId(c._id) === customerIdParam);
      setCustomer(found);

      if (found && customerIdParam && !cleanupPerformed.current) {
        cleanupPerformed.current = true;
        (async () => {
          try {
            await deleteUnlinkedPhotos(customerIdParam);
          } catch (error) {
            console.error('[NewServiceLog] Failed to clean up old photos:', error);
          }
        })();
      }
    } else if (customer && customerIdParam && !cleanupPerformed.current) {
      cleanupPerformed.current = true;

      (async () => {
        try {
          await deleteUnlinkedPhotos(customerIdParam);
        } catch (error) {
          console.error('[NewServiceLog] Failed to clean up old photos:', error);
        }
      })();
    }
  }, [customers, customerIdParam, customer]);

  const formattedDraftTime = useMemo(() => {
    if (!draftSavedAt) return null;
    const savedAtDate = new Date(draftSavedAt);
    if (Number.isNaN(savedAtDate.getTime())) return null;
    return savedAtDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [draftSavedAt]);

  const effectiveRequirements = useMemo(() => getRequirementsSummary(proofOfServiceSettings, formData.service_type), [proofOfServiceSettings, formData.service_type]);

  const handlePostSaveAction = useCallback(() => {
    if (!postSaveState) return;

    if (postSaveState.nextCustomerId) {
      const nextId = String(postSaveState.nextCustomerId);
      const nextCustomerFromData = postSaveState.nextCustomer
        || customers?.find((c) => parseCustomerId(c._id) === postSaveState.nextCustomerId);
      const nextRouteAhead = postSaveState.routeOrderIds
        ? postSaveState.routeOrderIds
        : [];

      navigate(createPageUrl("NewServiceLog") + `?customerId=${nextId}`, {
        state: {
          customer: nextCustomerFromData,
          returnIntent: "continue_route",
          routeOrderIds: nextRouteAhead,
          nextCustomerId: postSaveState.nextCustomerId,
          nextCustomerName: nextCustomerFromData?.full_name || postSaveState.nextCustomerName,
        },
      });
      return;
    }

    if (returnIntent === "continue_route") {
      navigate(createPageUrl("RouteOptimizer") + `?day=${encodeURIComponent(routeDayOfWeek)}`);
      return;
    }

    navigate(createPageUrl("Home"));
  }, [customers, navigate, postSaveState, returnIntent, routeDayOfWeek]);

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
      serviceType: formData.service_type,
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
      const unlinkedPhotos = allPhotos.filter((p) => p.serviceLogId === null);
      actualBeforeCount = unlinkedPhotos.filter((p) => p.category === 'before').length;
      actualAfterCount = unlinkedPhotos.filter((p) => p.category === 'after').length;
    } catch (error) {
      console.error('[NewServiceLog] Failed to get actual photo count, using state values:', error);
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const localDate = `${year}-${month}-${day}`;

    const logData = {
      customer_id: customerIdParam,
      service_date: localDate,
      status: "completed",
      service_type: formData.service_type || undefined,
      notes: formData.notes,
      ph: formData.ph,
      chlorine: formData.chlorine,
      alkalinity: formData.alkalinity,
      stabilizer: formData.stabilizer,
      photo_count: actualBeforeCount + actualAfterCount,
      has_before_photos: actualBeforeCount > 0,
      has_after_photos: actualAfterCount > 0,
    };

    if (customer?.pool_type === "Salt" && formData.salt) {
      logData.salt = parseFloat(formData.salt);
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
      } else {
        console.warn('[NewServiceLog] Skipping photo linking - missing customerIdParam or serviceLogId');
      }

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#06b6d4', '#3b82f6', '#a855f7']
      });

      if (draftStorageKey && typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(draftStorageKey);
        setDraftSavedAt(null);
      }

      setSaving(false);
      setPostSaveState({
        completedCustomer: customer,
        nextCustomerId: parseCustomerId(nextCustomerFromRoute),
        nextCustomerName: nextCustomer?.full_name || null,
        nextCustomer,
        routeOrderIds: routeOrderAhead,
      });
      toast.success("Service log saved");
    } catch (error) {
      console.error('[NewServiceLog] Failed to create service log:', error);
      setSaving(false);
      setValidationError('Failed to save service log. Please try again.');
    }
  };

  const progressText = useMemo(() => {
    if (postSaveState) return "Route save complete";
    return `Readiness: ${readinessProgress}`;
  }, [postSaveState, readinessProgress]);

  if (!customer) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <ChemicalBeakerLoader />
      </div>
    );
  }

  const backLabel = returnIntent === "continue_route" ? "Back to Route Flow" : "Back to Route";
  const backTarget = returnIntent === "continue_route"
    ? createPageUrl("RouteOptimizer") + `?day=${encodeURIComponent(routeDayOfWeek)}`
    : createPageUrl("Home");

  if (postSaveState) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-sans">
        <Card className="p-6 mb-6 border-2 border-emerald-200 bg-emerald-50">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-700 mt-0.5" />
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-900">Service Saved</h2>
              <p className="text-sm text-slate-700">
                Saved service log for <span className="font-semibold">{formatCustomerName(postSaveState.completedCustomer)}</span>.
              </p>
            </div>
          </div>
          <Button
            onClick={handlePostSaveAction}
            className="mt-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg"
            data-testid="service-log-next-action"
          >
            {nextActionLabel}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-sans">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate(backTarget)}
          className="mb-4 group"
        >
          <ArrowLeft className="w-4 h-4 mr-2 stroke-[1.75] group-hover:-translate-x-1 transition-transform" />
          {backLabel}
        </Button>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Service Log</h2>
          <p className="text-sm font-medium text-slate-600">{customer.full_name}</p>
          {formattedDraftTime && (
            <p className="text-xs font-medium text-slate-500">Draft saved at {formattedDraftTime}</p>
          )}
        </div>
      </div>

      <section
        className="mb-5 rounded-xl border border-slate-200 bg-white/90 p-4 shadow-sm"
        aria-label="Service log progress"
        data-testid="service-log-readiness-strip"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{readinessItemsTitle}</p>
            <p className="text-xs font-medium text-slate-600">Customer: {customer.full_name}</p>
          </div>
          <div className="text-right text-xs text-slate-600 space-y-1">
            <p>Route context: {routeContextLabel}</p>
            <p>{routeQueueSummary}</p>
          </div>
        </div>
        <div className="mt-2">
          <p className="text-xs text-slate-600">{progressText}</p>
          {draftSavedAt && (
            <p className="text-xs text-slate-500 mt-0.5">
              Draft saved at {formattedDraftTime}
            </p>
          )}
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {readinessItems.map((item) => (
            <div key={item.label} className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
              <span className={`h-2.5 w-2.5 rounded-full ${item.complete ? "bg-emerald-500" : "bg-amber-400"}`}></span>
              <span className={item.complete ? "text-slate-900" : "text-slate-500"}>{item.label}</span>
            </div>
          ))}
        </div>
      </section>
      <section
        className="mb-5 rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm"
        aria-label="Service log checklist"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-900">Readiness Check</p>
            <p className="text-xs text-emerald-700">
              Ready fields: {readinessProgress}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-emerald-800">
              {returnIntent === "continue_route" ? "Route mode" : "Single-service mode"}
            </p>
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit}>
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
              {serviceTypes.map((type) => (
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
              icon={<TestTube className="w-4 h-4 stroke-[1.75]" />
              }
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
            <p className="text-sm font-medium text-amber-800" data-testid="service-log-validation-summary">
              Required for completion: {effectiveRequirements.join(", ")}
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
