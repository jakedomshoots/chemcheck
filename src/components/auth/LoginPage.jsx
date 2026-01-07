import { useState } from 'react';
import { SignIn, useAuth } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { 
  Droplets, 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  ArrowRight,
  Chrome,
  Github
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { userManager } from '@/lib/userManager';
import { logLogin } from '@/lib/auditLog';
import { useAuthContext } from './AuthProvider';

export function LoginPage() {
  const { isOfflineMode } = useAuthContext() || {};
  
  // If using Clerk (online mode), show Clerk's SignIn component
  if (!isOfflineMode) {
    return <ClerkLoginPage />;
  }
  
  // Offline mode - show local login form
  return <OfflineLoginPage />;
}

// Clerk-based login for production
function ClerkLoginPage() {
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

        {/* Clerk SignIn Component */}
        <SignIn 
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
          path="/login"
          signUpUrl="/signup"
          fallbackRedirectUrl="/"
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

// Offline/local login for development or offline use
function OfflineLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const user = await userManager.loginUser(email);
      
      if (user) {
        logLogin(true);
        navigate('/');
        window.location.reload();
      } else {
        setError('No account found with this email. Please sign up first.');
        logLogin(false, 'User not found');
      }
    } catch (err) {
      setError('Login failed. Please try again.');
      logLogin(false, err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setIsLoading(true);
    try {
      // Check if demo user exists, if not create one
      let user = await userManager.loginUser('demo@chemcheck.app');
      
      if (!user) {
        // Create demo business and user
        const { user: newUser } = await userManager.setupSingleUserBusiness();
        user = newUser;
      }
      
      logLogin(true);
      navigate('/');
      window.location.reload();
    } catch (err) {
      setError('Demo login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

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
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-slate-900">Welcome back</h2>
            <p className="text-slate-600 text-sm">Sign in to your account</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading || !email}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white py-2.5"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-slate-500">or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleDemoLogin}
            disabled={isLoading}
            className="w-full border-2"
          >
            Try Demo Account
          </Button>

          <p className="mt-6 text-center text-sm text-slate-600">
            Don't have an account?{' '}
            <a href="/signup" className="text-cyan-600 hover:text-cyan-700 font-medium">
              Sign up
            </a>
          </p>
        </Card>

        {/* Offline Mode Notice */}
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800 text-center">
            <strong>Offline Mode:</strong> Data is stored locally on this device only.
          </p>
        </div>

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

export default LoginPage;
