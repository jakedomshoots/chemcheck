import { SignUp, useAuth } from '@clerk/clerk-react';
import { Droplets, CheckCircle, Users, Shield, Zap } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuthContext } from './ClerkAuthProvider';

export function RobustSignUpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const auth = useAuthContext();
  const [isProcessingAuth, setIsProcessingAuth] = useState(true);
  
  // Check if URL contains Clerk OAuth callback indicators
  const isOAuthCallback = location.pathname.includes('/sso-callback') ||
                          location.hash.includes('__clerk') ||
                          location.search.includes('__clerk') ||
                          location.pathname.includes('/signup/sso-callback') ||
                          location.pathname.includes('/signup/factor');

  // Wait a moment after Clerk loads to let OAuth state settle
  useEffect(() => {
    if (isLoaded) {
      const timer = setTimeout(() => {
        setIsProcessingAuth(false);
      }, isOAuthCallback ? 1000 : 100);
      return () => clearTimeout(timer);
    }
  }, [isLoaded, isOAuthCallback]);

  // Redirect if user is already signed in
  useEffect(() => {
    if (isLoaded && isSignedIn && auth.isInitialized) {
      if (auth.hasCompletedSetup) {
        navigate('/', { replace: true });
      } else {
        navigate('/setup', { replace: true });
      }
    }
  }, [isLoaded, isSignedIn, auth.isInitialized, auth.hasCompletedSetup, navigate]);

  // Show loading while Clerk is loading, processing OAuth, or user is signed in but context not ready
  if (!isLoaded || isProcessingAuth || (isSignedIn && !auth.isInitialized)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Droplets className="w-8 h-8 text-white" />
          </div>
          <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-900 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // If already signed in and initialized, show loading while redirecting
  if (isSignedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Droplets className="w-8 h-8 text-white" />
          </div>
          <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-900 font-medium">Welcome to ChemCheck!</p>
          <p className="text-slate-600 text-sm mt-2">Setting up your workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl flex gap-8">
        {/* Left Side - Benefits */}
        <div className="hidden lg:flex flex-col justify-center flex-1 pr-8">
          <div className="mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center mb-4" aria-label="ChemCheck Logo">
              <Droplets className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-4">
              Professional Pool Service Management
            </h2>
            <p className="text-lg text-slate-600 mb-8">
              Join thousands of pool professionals who trust ChemCheck to streamline their operations and delight their customers.
            </p>
          </div>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Complete Service Tracking</h3>
                <p className="text-slate-600">Track chemicals, equipment, photos, and customer communications all in one place.</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Customer Communication</h3>
                <p className="text-slate-600">Send professional service reports via email or SMS with photos and details.</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Route Optimization</h3>
                <p className="text-slate-600">Optimize your daily routes and manage your schedule efficiently.</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Secure & Reliable</h3>
                <p className="text-slate-600">Your data is encrypted and backed up with enterprise-grade security.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side - Sign Up Form */}
        <div className="w-full lg:w-96 flex-shrink-0">
          {/* Mobile Logo Header */}
          <div className="text-center mb-8 lg:hidden">
            <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg" aria-label="ChemCheck Logo">
              <Droplets className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Join ChemCheck</h1>
            <p className="text-slate-600">Start your free trial today</p>
          </div>

          {/* Desktop Header */}
          <div className="hidden lg:block text-center mb-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Create your account</h1>
            <p className="text-slate-600">Start managing your pool service business today</p>
          </div>

          {/* Clerk SignUp Component */}
          <SignUp 
            routing="path"
            path="/signup"
            signInUrl="/login"
            fallbackRedirectUrl="/setup"
            appearance={{
              elements: {
                rootBox: 'w-full',
                card: 'shadow-xl border-0 bg-white',
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
                socialButtonsBlockButton: 'border-2 hover:bg-slate-50 transition-colors duration-200',
                formButtonPrimary: 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-medium transition-all duration-200',
                footerActionLink: 'text-cyan-600 hover:text-cyan-700 font-medium transition-colors',
                formFieldInput: 'border-slate-300 focus:border-cyan-500 focus:ring-cyan-500',
                identityPreviewText: 'text-slate-700',
                identityPreviewEditButton: 'text-cyan-600 hover:text-cyan-700'
              }
            }}
          />

          {/* Footer Links */}
          <div className="mt-6 text-center text-sm text-slate-500">
            <a 
              href="/privacy-policy.html" 
              className="hover:text-slate-700 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy Policy
            </a>
            <span className="mx-2">•</span>
            <a 
              href="/terms-of-service.html" 
              className="hover:text-slate-700 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Terms of Service
            </a>
          </div>

          {/* Terms Notice */}
          <p className="mt-4 text-center text-xs text-slate-500">
            By creating an account, you agree to our Terms of Service and Privacy Policy. 
            Your data is encrypted and secure.
          </p>
        </div>
      </div>
    </div>
  );
}

export default RobustSignUpPage;
