import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useAuthContext } from './ClerkAuthProvider';
import { userManager } from '@/lib/userManager';
import {
  Droplets,
  Building2,
  User,
  Mail,
  Phone,
  MapPin,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  Loader2,
  CalendarDays,
  Clock,
  Wrench,
  Plus,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Default business settings constants
const DEFAULT_BUSINESS_SETTINGS = {
  workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  workingHours: { start: '08:00', end: '17:00' },
  serviceTypes: ['Regular Cleaning', 'Chemical Balance', 'Equipment Check', 'Repair'],
  chemicalTypes: ['Chlorine Tablets', 'Liquid Chlorine', 'pH Up', 'pH Down', 'Alkalinity Up', 'Stabilizer'],
  defaultPoolTypes: ['Chlorine', 'Salt'],
  defaultSurfaceTypes: ['Plaster', 'Vinyl', 'Fiberglass', 'Tile'],
  routeOptimization: true,
  requirePhotos: false,
  requireSignatures: false
};

const DEFAULT_USER_PREFERENCES = {
  language: 'en',
  notifications: {
    serviceReminders: true,
    lowChemicals: true,
    customerUpdates: true
  },
  defaultView: 'route',
  autoBackup: true
};

export function SetupWizardPage() {
  const navigate = useNavigate();
  const auth = useAuthContext();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Convex mutations for syncing business to cloud
  const updateConvexBusiness = useMutation(api.businesses.update);
  const updateConvexBusinessSettings = useMutation(api.businesses.updateSettings);

  const [formData, setFormData] = useState({
    businessName: '',
    businessPhone: '',
    businessEmail: '',
    businessAddress: '',
    ownerName: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  });

  const [scheduleData, setScheduleData] = useState({
    workingDays: [...DEFAULT_BUSINESS_SETTINGS.workingDays],
    workingHoursStart: DEFAULT_BUSINESS_SETTINGS.workingHours.start,
    workingHoursEnd: DEFAULT_BUSINESS_SETTINGS.workingHours.end,
    serviceTypes: [...DEFAULT_BUSINESS_SETTINGS.serviceTypes],
    newServiceType: ''
  });

  // Pre-fill data from Clerk user
  useEffect(() => {
    if (auth.clerkUser) {
      setFormData(prev => ({
        ...prev,
        ownerName: auth.clerkUser.fullName || auth.clerkUser.firstName || '',
        businessEmail: auth.clerkUser.primaryEmailAddress?.emailAddress || ''
      }));
    }
  }, [auth.clerkUser]);

  // Redirect if already set up
  useEffect(() => {
    if (auth.hasCompletedSetup) {
      navigate('/', { replace: true });
    }
  }, [auth.hasCompletedSetup, navigate]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const toggleWorkingDay = (day) => {
    setScheduleData(prev => {
      const hasDay = prev.workingDays.includes(day);
      return {
        ...prev,
        workingDays: hasDay
          ? prev.workingDays.filter(d => d !== day)
          : [...prev.workingDays, day]
      };
    });
    setError('');
  };

  const handleScheduleChange = (field, value) => {
    setScheduleData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const addServiceType = () => {
    const value = scheduleData.newServiceType.trim();
    if (!value) return;
    if (scheduleData.serviceTypes.includes(value)) {
      setError('This service type already exists');
      return;
    }
    setScheduleData(prev => ({
      ...prev,
      serviceTypes: [...prev.serviceTypes, value],
      newServiceType: ''
    }));
    setError('');
  };

  const removeServiceType = (type) => {
    setScheduleData(prev => ({
      ...prev,
      serviceTypes: prev.serviceTypes.filter(t => t !== type)
    }));
  };

  const validateStep2 = () => {
    if (formData.businessEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.businessEmail.trim())) {
        setError('Please enter a valid business email address');
        return false;
      }
    }

    if (formData.businessPhone.trim()) {
      const phoneRegex = /^[\d\s()+-]+$/;
      if (!phoneRegex.test(formData.businessPhone.trim()) || formData.businessPhone.trim().length < 10) {
        setError('Please enter a valid phone number');
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (step === 1) {
      if (!formData.businessName.trim() || !formData.ownerName.trim()) {
        setError('Please fill in all required fields');
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!validateStep2()) return;
      setStep(3);
    }
  };

  const validateStep3 = () => {
    if (scheduleData.workingDays.length === 0) {
      setError('Please select at least one working day');
      return false;
    }
    if (scheduleData.workingHoursStart >= scheduleData.workingHoursEnd) {
      setError('Working hours end time must be after start time');
      return false;
    }
    if (scheduleData.serviceTypes.length === 0) {
      setError('Please add at least one service type');
      return false;
    }
    return true;
  };

  const buildSettings = () => ({
    ...DEFAULT_BUSINESS_SETTINGS,
    workingDays: scheduleData.workingDays,
    workingHours: {
      start: scheduleData.workingHoursStart,
      end: scheduleData.workingHoursEnd
    },
    serviceTypes: scheduleData.serviceTypes
  });

  const buildConvexSettingsPayload = () => ({
    working_days: scheduleData.workingDays,
    working_hours_start: scheduleData.workingHoursStart,
    working_hours_end: scheduleData.workingHoursEnd,
    service_types: scheduleData.serviceTypes
  });

  const handleComplete = async ({ skip = false } = {}) => {
    if (!auth.clerkUser?.primaryEmailAddress?.emailAddress) {
      setError('No email address found. Please ensure your account has a verified email.');
      return;
    }

    if (!skip && !validateStep3()) return;

    setIsLoading(true);
    setError('');

    try {
      const userEmail = auth.clerkUser.primaryEmailAddress.emailAddress;
      const settings = buildSettings();

      // Create business
      const business = await userManager.createBusiness({
        name: formData.businessName.trim(),
        address: formData.businessAddress.trim(),
        phone: formData.businessPhone.trim(),
        email: formData.businessEmail.trim() || userEmail,
        ownerId: '', // Will be set after user creation
        settings: DEFAULT_BUSINESS_SETTINGS
      });

      // Apply the wizard's schedule/service settings to localStorage
      // (createBusiness currently overwrites settings with defaults)
      await userManager.updateBusinessSettings(settings);

      // Create user
      const user = await userManager.createUser({
        name: formData.ownerName.trim(),
        email: userEmail,
        role: 'owner',
        businessId: business.id,
        preferences: {
          ...DEFAULT_USER_PREFERENCES,
          timezone: formData.timezone
        }
      });

      // Login the user FIRST to provide context for the ownership update
      await userManager.loginUser(user.email, business.id);

      // Update business owner using service method
      await userManager.updateBusinessOwner(business.id, user.id);

      // Sync business to Convex cloud (so Settings page can read it)
      try {
        await updateConvexBusiness({
          name: formData.businessName.trim(),
          address: formData.businessAddress.trim() || undefined,
          phone: formData.businessPhone.trim() || undefined,
          email: formData.businessEmail.trim() || userEmail,
        });

        // Persist schedule/service settings to Convex
        await updateConvexBusinessSettings(buildConvexSettingsPayload());
      } catch (convexErr) {
        console.warn('Failed to sync business to Convex, will retry on next load:', convexErr);
        // Non-blocking: setup can still proceed with localStorage
      }

      // Refresh the auth context to pick up the new user
      // This is critical to update hasCompletedSetup
      const refreshedUser = await auth.refreshUser();

      if (refreshedUser) {
        navigate('/', { replace: true });
      } else {
        // If refresh failed, try navigating anyway - the auth guard will handle it
        console.warn('User refresh returned null, navigating anyway');
        navigate('/', { replace: true });
      }
    } catch (err) {
      console.error('Setup failed:', err);
      setError('Setup failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!auth.isLoaded || !auth.isInitialized) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-surface-0 text-ink">
        <div
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
          aria-hidden="true"
        />
        <div className="flex min-h-screen items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-4 h-9 w-9 rounded-full border-2 border-[var(--status-info-line)] border-t-cyan-600 animate-spin" aria-hidden="true" />
            <p className="text-base font-semibold tracking-[-0.035em] text-ink">Loading setup</p>
            <p className="mt-1 text-sm font-medium text-ink-secondary">Preparing your workspace</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface-0 text-ink">
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(8,145,178,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#f8fdff_0%,#eef8f9_55%,#f8fbfc_100%)]"
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.05] [background-image:linear-gradient(rgba(15,23,42,0.75)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.75)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-12">
        {/* Logo Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-white shadow-cta">
            <Droplets className="h-8 w-8" aria-hidden="true" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
            Workspace setup
          </p>
          <h1 className="text-balance text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
            Welcome to ChemCheck
          </h1>
          <p className="mt-2 text-sm font-medium leading-6 text-ink-secondary">
            Let's set up your business profile.
          </p>
        </div>
        <Card className="w-full rounded-sheet border border-line bg-surface-1 p-5 shadow-card sm:p-6">
          {/* Progress Indicator */}
          <div className="mb-6 flex items-center justify-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                step >= 1 ? 'bg-brand text-white shadow-cta' : 'bg-surface-2 text-ink-muted'
              }`}
              aria-current={step === 1 ? 'step' : undefined}
            >
              {step > 1 ? <CheckCircle className="h-5 w-5" aria-hidden="true" /> : '1'}
            </div>
            <div className={`h-1 w-12 rounded-full transition-colors ${step > 1 ? 'bg-brand' : 'bg-surface-2'}`} />
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                step >= 2 ? 'bg-brand text-white shadow-cta' : 'bg-surface-2 text-ink-muted'
              }`}
              aria-current={step === 2 ? 'step' : undefined}
            >
              {step > 2 ? <CheckCircle className="h-5 w-5" aria-hidden="true" /> : '2'}
            </div>
            <div className={`h-1 w-12 rounded-full transition-colors ${step > 2 ? 'bg-brand' : 'bg-surface-2'}`} />
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                step >= 3 ? 'bg-brand text-white shadow-cta' : 'bg-surface-2 text-ink-muted'
              }`}
              aria-current={step === 3 ? 'step' : undefined}
            >
              3
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-2xl border border-[var(--status-critical-line)] bg-[var(--status-critical-soft)] p-3 text-sm font-medium text-critical shadow-sm">
              {error}
            </div>
          )}

          {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="mb-4">
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">Business Information</h2>
                <p className="mt-1 text-sm font-medium text-ink-secondary">Tell us about your pool service business</p>
              </div>

              <div>
                <label htmlFor="businessName" className="mb-2 block text-sm font-semibold text-ink">
                  Business Name <span className="text-brand-ink">*</span>
                </label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                  <input
                    id="businessName"
                    type="text"
                    value={formData.businessName}
                    onChange={(e) => handleChange('businessName', e.target.value)}
                    placeholder="Crystal Clear Pool Service"
                    required
                    className="w-full rounded-xl border border-line bg-surface-1 py-2.5 pl-10 pr-4 text-sm font-medium text-ink shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ownerName" className="mb-2 block text-sm font-semibold text-ink">
                  Owner Name <span className="text-brand-ink">*</span>
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                  <input
                    id="ownerName"
                    type="text"
                    value={formData.ownerName}
                    onChange={(e) => handleChange('ownerName', e.target.value)}
                    placeholder="John Smith"
                    required
                    className="w-full rounded-xl border border-line bg-surface-1 py-2.5 pl-10 pr-4 text-sm font-medium text-ink shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <Button
                type="button"
                onClick={handleNext}
                disabled={!formData.businessName.trim() || !formData.ownerName.trim()}
                className="h-11 w-full rounded-full bg-brand px-6 font-semibold text-white shadow-cta hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-ring disabled:bg-surface-2 disabled:text-ink-muted disabled:shadow-none"
              >
                Continue
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}

          {/* Step 2: Contact Info */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="mb-4">
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">Contact Information</h2>
                <p className="mt-1 text-sm font-medium text-ink-secondary">How can customers reach you?</p>
              </div>

              <div>
                <label htmlFor="businessPhone" className="mb-2 block text-sm font-semibold text-ink">
                  Business Phone
                </label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                  <input
                    id="businessPhone"
                    type="tel"
                    value={formData.businessPhone}
                    onChange={(e) => handleChange('businessPhone', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full rounded-xl border border-line bg-surface-1 py-2.5 pl-10 pr-4 text-sm font-medium text-ink shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="businessEmail" className="mb-2 block text-sm font-semibold text-ink">
                  Business Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                  <input
                    id="businessEmail"
                    type="email"
                    value={formData.businessEmail}
                    onChange={(e) => handleChange('businessEmail', e.target.value)}
                    placeholder="info@crystalclearpools.com"
                    className="w-full rounded-xl border border-line bg-surface-1 py-2.5 pl-10 pr-4 text-sm font-medium text-ink shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="businessAddress" className="mb-2 block text-sm font-semibold text-ink">
                  Business Address
                </label>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                  <input
                    id="businessAddress"
                    type="text"
                    value={formData.businessAddress}
                    onChange={(e) => handleChange('businessAddress', e.target.value)}
                    placeholder="123 Main St, City, State 12345"
                    className="w-full rounded-xl border border-line bg-surface-1 py-2.5 pl-10 pr-4 text-sm font-medium text-ink shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="h-11 flex-1 rounded-full border-line bg-white text-ink hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={handleNext}
                  className="h-11 flex-1 rounded-full bg-brand px-6 font-semibold text-white shadow-cta hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Schedule & Service Types */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="mb-4">
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">Schedule & Services</h2>
                <p className="mt-1 text-sm font-medium text-ink-secondary">Set your working schedule and service types</p>
              </div>

              {/* Working Days */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-ink">
                  <CalendarDays className="mr-1 inline-block h-4 w-4 -mt-0.5" aria-hidden="true" />
                  Working Days
                </label>
                <div className="grid grid-cols-7 gap-1">
                  {ALL_DAYS.map(day => {
                    const isSelected = scheduleData.workingDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleWorkingDay(day)}
                        aria-pressed={isSelected}
                        className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
                          isSelected
                            ? 'bg-brand text-white shadow-cta'
                            : 'bg-surface-2 text-ink-secondary hover:bg-surface-2'
                        }`}
                        title={day}
                      >
                        {day.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Working Hours */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-ink">
                  <Clock className="mr-1 inline-block h-4 w-4 -mt-0.5" aria-hidden="true" />
                  Working Hours
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="time"
                    value={scheduleData.workingHoursStart}
                    onChange={(e) => handleScheduleChange('workingHoursStart', e.target.value)}
                    aria-label="Working hours start"
                    className="flex-1 rounded-xl border border-line bg-surface-1 px-3 py-2.5 text-sm font-medium text-ink shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-sm font-medium text-ink-muted">to</span>
                  <input
                    type="time"
                    value={scheduleData.workingHoursEnd}
                    onChange={(e) => handleScheduleChange('workingHoursEnd', e.target.value)}
                    aria-label="Working hours end"
                    className="flex-1 rounded-xl border border-line bg-surface-1 px-3 py-2.5 text-sm font-medium text-ink shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              {/* Service Types */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-ink">
                  <Wrench className="mr-1 inline-block h-4 w-4 -mt-0.5" aria-hidden="true" />
                  Service Types
                </label>
                <div className="mb-2 flex gap-2">
                  <input
                    type="text"
                    value={scheduleData.newServiceType}
                    onChange={(e) => handleScheduleChange('newServiceType', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addServiceType();
                      }
                    }}
                    placeholder="Add a service type"
                    aria-label="New service type"
                    className="flex-1 rounded-xl border border-line bg-surface-1 px-3 py-2 text-sm font-medium text-ink shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addServiceType}
                    disabled={!scheduleData.newServiceType.trim()}
                    aria-label="Add service type"
                    className="h-10 rounded-full border-line bg-white text-brand-ink hover:border-[var(--status-info-line)] hover:bg-brand-softer"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {scheduleData.serviceTypes.map(type => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--status-info-line)] bg-brand-softer px-2.5 py-1 text-sm font-medium text-brand-ink"
                    >
                      {type}
                      <button
                        type="button"
                        onClick={() => removeServiceType(type)}
                        className="text-brand-ink transition-colors hover:text-brand-ink"
                        aria-label={`Remove ${type}`}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(2)}
                    className="h-11 flex-1 rounded-full border-line bg-white text-ink hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                    Back
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleComplete()}
                    disabled={isLoading}
                    className="h-11 flex-1 rounded-full bg-brand px-6 font-semibold text-white shadow-cta hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-ring disabled:bg-surface-2 disabled:text-ink-muted disabled:shadow-none"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <>
                        Complete Setup
                        <CheckCircle className="ml-2 h-4 w-4" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleComplete({ skip: true })}
                  disabled={isLoading}
                  className="h-11 w-full rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink-secondary"
                >
                  Set up later
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Help Text */}
        <div className="mt-4 w-full rounded-2xl border border-[var(--status-info-line)] bg-brand-softer p-3 text-center shadow-sm ">
          <p className="text-sm font-medium text-brand-ink">
            You can change these settings anytime in your account preferences.
          </p>
        </div>
      </div>
    </div>
  );
}
