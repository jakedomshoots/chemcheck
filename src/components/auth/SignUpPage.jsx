import { useState } from 'react';
import { SignUp } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { 
  Droplets, 
  Mail, 
  User,
  Building2,
  ArrowRight,
  ArrowLeft,
  CheckCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { userManager } from '@/lib/userManager';
import { logLogin } from '@/lib/auditLog';
import { useAuthContext } from './AuthProvider';

export function SignUpPage() {
  const { isOfflineMode } = useAuthContext() || {};
  
  // If using Clerk (online mode), show Clerk's SignUp component
  if (!isOfflineMode) {
    return <ClerkSignUpPage />;
  }
  
  // Offline mode - show local signup form
  return <OfflineSignUpPage />;
}

// Clerk-based signup for production
function ClerkSignUpPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Droplets className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">ChemCheck</h1>
          <p className="text-slate-600">Pool Service Management</p>
        </div>

        {/* Clerk SignUp Component */}
        <SignUp 
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'shadow-xl border-0',
              headerTitle: 'text-xl font-bold text-slate-900',
              headerSubtitle: 'text-slate-600',
              socialButtonsBlockButton: 'border-2 hover:bg-slate-50',
              formButtonPrimary: 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700',
              footerActionLink: 'text-cyan-600 hover:text-cyan-700'
            }
          }}
          routing="path"
          path="/signup"
          signInUrl="/login"
          fallbackRedirectUrl="/setup"
        />

        {/* Footer Links */}
        <div className="mt-6 text-center text-sm text-slate-500">
          <a href="/privacy-policy.html" className="hover:text-slate-700">Privacy Policy</a>
          <span className="mx-2">•</span>
          <a href="/terms-of-service.html" className="hover:text-slate-700">Terms of Service</a>
        </div>
      </div>
    </div>
  );
}

// Offline/local signup for development or offline use
function OfflineSignUpPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    businessName: '',
    businessPhone: '',
    businessEmail: ''
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Check if email already exists
      const existingUser = await userManager.loginUser(formData.email);
      if (existingUser) {
        setError('An account with this email already exists. Please sign in instead.');
        setIsLoading(false);
        return;
      }

      // Create business
      const business = await userManager.createBusiness({
        name: formData.businessName || `${formData.name}'s Pool Service`,
        address: '',
        phone: formData.businessPhone,
        email: formData.businessEmail || formData.email,
        ownerId: '',
        settings: {
          workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          workingHours: { start: '08:00', end: '17:00' },
          serviceTypes: ['Regular Cleaning', 'Chemical Balance', 'Equipment Check', 'Repair'],
          chemicalTypes: ['Chlorine Tablets', 'Liquid Chlorine', 'pH Up', 'pH Down', 'Alkalinity Up', 'Stabilizer'],
          defaultPoolTypes: ['Chlorine', 'Salt'],
          defaultSurfaceTypes: ['Plaster', 'Vinyl', 'Fiberglass', 'Tile'],
          routeOptimization: true,
          requirePhotos: false,
          requireSignatures: false
        }
      });

      // Create user
      const user = await userManager.createUser({
        name: formData.name,
        email: formData.email,
        role: 'owner',
        businessId: business.id,
        preferences: {
          language: 'en',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          notifications: {
            serviceReminders: true,
            lowChemicals: true,
            customerUpdates: true
          },
          defaultView: 'route',
          autoBackup: true
        }
      });

      // Update business owner
      const businesses = JSON.parse(localStorage.getItem('chemcheck_businesses') || '[]');
      const businessIndex = businesses.findIndex(b => b.id === business.id);
      if (businessIndex >= 0) {
        businesses[businessIndex].ownerId = user.id;
        localStorage.setItem('chemcheck_businesses', JSON.stringify(businesses));
      }

      // Login the user
      await userManager.loginUser(user.email, business.id);
      logLogin(true);
      
      navigate('/');
      window.location.reload();
    } catch (err) {
      console.error('Signup failed:', err);
      setError('Signup failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const isStep1Valid = formData.name.trim() && formData.email.trim();
  const isStep2Valid = true; // Business info is optional

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Droplets className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">ChemCheck</h1>
          <p className="text-slate-600">Pool Service Management</p>
        </div>

        <Card className="p-6 shadow-xl">
          {/* Progress Indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step >= 1 ? 'bg-cyan-600 text-white' : 'bg-slate-200 text-slate-600'
            }`}>
              {step > 1 ? <CheckCircle className="w-5 h-5" /> : '1'}
            </div>
            <div className={`w-12 h-1 ${step > 1 ? 'bg-cyan-600' : 'bg-slate-200'}`} />
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step >= 2 ? 'bg-cyan-600 text-white' : 'bg-slate-200 text-slate-600'
            }`}>
              2
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={step === 2 ? handleSignUp : (e) => { e.preventDefault(); setStep(2); }}>
            {/* Step 1: Personal Info */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-slate-900">Create your account</h2>
                  <p className="text-slate-600 text-sm">Enter your personal information</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Full Name *
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      placeholder="John Smith"
                      required
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Email Address *
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      placeholder="you@example.com"
                      required
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={!isStep1Valid}
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white py-2.5"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}

            {/* Step 2: Business Info */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-slate-900">Business Information</h2>
                  <p className="text-slate-600 text-sm">Optional - you can add this later</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Business Name
                  </label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="text"
                      value={formData.businessName}
                      onChange={(e) => handleChange('businessName', e.target.value)}
                      placeholder="Crystal Clear Pool Service"
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Business Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.businessPhone}
                    onChange={(e) => handleChange('businessPhone', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  />
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
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        Create Account
                        <CheckCircle className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            Already have an account?{' '}
            <a href="/login" className="text-cyan-600 hover:text-cyan-700 font-medium">
              Sign in
            </a>
          </p>
        </Card>

        {/* Terms Notice */}
        <p className="mt-4 text-center text-xs text-slate-500">
          By creating an account, you agree to our{' '}
          <a href="/terms-of-service.html" className="text-cyan-600 hover:underline">Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy-policy.html" className="text-cyan-600 hover:underline">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}

export default SignUpPage;
