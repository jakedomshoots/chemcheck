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
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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

  // Convex mutation for syncing business to cloud
  const updateConvexBusiness = useMutation(api.businesses.update);

  const [formData, setFormData] = useState({
    businessName: '',
    businessPhone: '',
    businessEmail: '',
    businessAddress: '',
    ownerName: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
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

  const handleNext = () => {
    if (step === 1 && (!formData.businessName.trim() || !formData.ownerName.trim())) {
      setError('Please fill in all required fields');
      return;
    }
    setStep(2);
  };

  const handleComplete = async () => {
    if (!auth.clerkUser?.primaryEmailAddress?.emailAddress) {
      setError('No email address found. Please ensure your account has a verified email.');
      return;
    }

    // Validate Step 2 fields if provided
    if (formData.businessEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.businessEmail.trim())) {
        setError('Please enter a valid business email address');
        return;
      }
    }

    if (formData.businessPhone.trim()) {
      const phoneRegex = /^[\d\s()+-]+$/;
      if (!phoneRegex.test(formData.businessPhone.trim()) || formData.businessPhone.trim().length < 10) {
        setError('Please enter a valid phone number');
        return;
      }
    }

    setIsLoading(true);
    setError('');

    try {
      const userEmail = auth.clerkUser.primaryEmailAddress.emailAddress;

      // Create business
      const business = await userManager.createBusiness({
        name: formData.businessName.trim(),
        address: formData.businessAddress.trim(),
        phone: formData.businessPhone.trim(),
        email: formData.businessEmail.trim() || userEmail,
        ownerId: '', // Will be set after user creation
        settings: DEFAULT_BUSINESS_SETTINGS
      });

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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-900">Loading setup...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Droplets className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome to ChemCheck!</h1>
          <p className="text-slate-600">Let's set up your business profile</p>
        </div>

        <Card className="p-6 shadow-xl">
          {/* Progress Indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${step >= 1 ? 'bg-cyan-600 text-white' : 'bg-slate-200 text-slate-600'
              }`}>
              {step > 1 ? <CheckCircle className="w-5 h-5" /> : '1'}
            </div>
            <div className={`w-12 h-1 transition-colors ${step > 1 ? 'bg-cyan-600' : 'bg-slate-200'}`} />
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${step >= 2 ? 'bg-cyan-600 text-white' : 'bg-slate-200 text-slate-600'
              }`}>
              2
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="mb-4">
                <h2 className="text-xl font-semibold text-slate-900">Business Information</h2>
                <p className="text-slate-600 text-sm">Tell us about your pool service business</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Business Name *
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    value={formData.businessName}
                    onChange={(e) => handleChange('businessName', e.target.value)}
                    placeholder="Crystal Clear Pool Service"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Owner Name *
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    value={formData.ownerName}
                    onChange={(e) => handleChange('ownerName', e.target.value)}
                    placeholder="John Smith"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  />
                </div>
              </div>

              <Button
                type="button"
                onClick={handleNext}
                disabled={!formData.businessName.trim() || !formData.ownerName.trim()}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white py-2.5"
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {/* Step 2: Contact Info */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="mb-4">
                <h2 className="text-xl font-semibold text-slate-900">Contact Information</h2>
                <p className="text-slate-600 text-sm">How can customers reach you?</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Business Phone
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="tel"
                    value={formData.businessPhone}
                    onChange={(e) => handleChange('businessPhone', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Business Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="email"
                    value={formData.businessEmail}
                    onChange={(e) => handleChange('businessEmail', e.target.value)}
                    placeholder="info@crystalclearpools.com"
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Business Address
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    value={formData.businessAddress}
                    onChange={(e) => handleChange('businessAddress', e.target.value)}
                    placeholder="123 Main St, City, State 12345"
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="flex-1"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={handleComplete}
                  disabled={isLoading}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      Complete Setup
                      <CheckCircle className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Help Text */}
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800 text-center">
            Don't worry - you can change these settings anytime in your account preferences.
          </p>
        </div>
      </div>
    </div>
  );
}

export default SetupWizardPage;
