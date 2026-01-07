import React, { useState } from 'react';
import { 
  Building2, 
  User, 
  Settings, 
  CheckCircle, 
  ArrowRight, 
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Clock,
  Calendar
} from 'lucide-react';
import { userManager } from '@/lib/userManager';
import { useUser } from '@clerk/clerk-react';

export function SetupWizard({ onComplete }) {
  // Get Clerk user to ensure we use the same email for local user
  const { user: clerkUser } = useUser();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [businessData, setBusinessData] = useState({
    name: '',
    address: '',
    phone: '',
    email: ''
  });
  const [ownerData, setOwnerData] = useState({
    name: '',
    email: ''
  });
  const [businessSettings, setBusinessSettings] = useState({
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    workingHours: { start: '08:00', end: '17:00' },
    serviceTypes: ['Regular Cleaning', 'Chemical Balance', 'Equipment Check'],
    chemicalTypes: ['Chlorine Tablets', 'Liquid Chlorine', 'pH Up', 'pH Down']
  });
  const [isLoading, setIsLoading] = useState(false);

  const steps = [
    { id: 1, title: 'Business Info', icon: Building2 },
    { id: 2, title: 'Owner Account', icon: User },
    { id: 3, title: 'Preferences', icon: Settings },
    { id: 4, title: 'Complete', icon: CheckCircle }
  ];

  const handleNext = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    setIsLoading(true);
    try {
      // Create business
      const business = await userManager.createBusiness({
        ...businessData,
        ownerId: '', // Will be set after user creation
        settings: businessSettings
      });

      // Use Clerk email if available, otherwise fall back to entered email
      // This ensures the local user matches the Clerk user for proper auth sync
      const userEmail = clerkUser?.primaryEmailAddress?.emailAddress || ownerData.email;
      const userName = clerkUser?.fullName || clerkUser?.firstName || ownerData.name;

      // Create owner user
      const user = await userManager.createUser({
        name: userName,
        email: userEmail,
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
      await userManager.loginUser(userEmail, business.id);

      onComplete({ user, business });
    } catch (error) {
      console.error('Setup failed:', error);
      alert('Setup failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const isStepValid = () => {
    switch (currentStep) {
      case 1:
        return businessData.name.trim().length > 0;
      case 2:
        // If Clerk user exists, we have valid email/name from there
        if (clerkUser?.primaryEmailAddress?.emailAddress) {
          return true;
        }
        return ownerData.name.trim().length > 0 && ownerData.email.trim().length > 0;
      case 3:
        return true;
      default:
        return true;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Welcome to ChemCheck</h1>
              <p className="text-blue-100">Let's set up your pool service business</p>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  currentStep >= step.id 
                    ? 'bg-white text-blue-600' 
                    : 'bg-white/20 text-white'
                }`}>
                  {currentStep > step.id ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    step.id
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div className={`w-12 h-0.5 mx-2 ${
                    currentStep > step.id ? 'bg-white' : 'bg-white/20'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Step 1: Business Information */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Business Information</h2>
                <p className="text-gray-600">Tell us about your pool service business</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Business Name *
                  </label>
                  <input
                    type="text"
                    value={businessData.name}
                    onChange={(e) => setBusinessData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Crystal Clear Pool Service"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <MapPin className="w-4 h-4 inline mr-1" />
                    Business Address
                  </label>
                  <textarea
                    value={businessData.address}
                    onChange={(e) => setBusinessData(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="123 Main St, City, State 12345"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Phone className="w-4 h-4 inline mr-1" />
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={businessData.phone}
                      onChange={(e) => setBusinessData(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="(555) 123-4567"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Mail className="w-4 h-4 inline mr-1" />
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={businessData.email}
                      onChange={(e) => setBusinessData(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="info@poolservice.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Owner Account */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Owner Account</h2>
                <p className="text-gray-600">Confirm your account details</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={clerkUser?.fullName || clerkUser?.firstName || ownerData.name}
                    onChange={(e) => setOwnerData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="John Smith"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    readOnly={!!clerkUser?.fullName}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    value={clerkUser?.primaryEmailAddress?.emailAddress || ownerData.email}
                    onChange={(e) => setOwnerData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="john@poolservice.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50"
                    readOnly={!!clerkUser?.primaryEmailAddress?.emailAddress}
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    {clerkUser?.primaryEmailAddress?.emailAddress 
                      ? 'This is your sign-in email from your account'
                      : 'This will be your login email for the app'}
                  </p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-blue-900">Owner Privileges</h4>
                      <p className="text-sm text-blue-700 mt-1">
                        As the owner, you'll have full access to all features including customer management, 
                        employee accounts, business settings, and data export.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Business Preferences */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Business Preferences</h2>
                <p className="text-gray-600">Configure your business settings</p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    <Calendar className="w-4 h-4 inline mr-1" />
                    Working Days
                  </label>
                  <div className="grid grid-cols-7 gap-2">
                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                      <label key={day} className="flex flex-col items-center">
                        <input
                          type="checkbox"
                          checked={businessSettings.workingDays.includes(day)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setBusinessSettings(prev => ({
                                ...prev,
                                workingDays: [...prev.workingDays, day]
                              }));
                            } else {
                              setBusinessSettings(prev => ({
                                ...prev,
                                workingDays: prev.workingDays.filter(d => d !== day)
                              }));
                            }
                          }}
                          className="mb-1"
                        />
                        <span className="text-xs text-center">{day.slice(0, 3)}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    <Clock className="w-4 h-4 inline mr-1" />
                    Working Hours
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Start Time</label>
                      <input
                        type="time"
                        value={businessSettings.workingHours.start}
                        onChange={(e) => setBusinessSettings(prev => ({
                          ...prev,
                          workingHours: { ...prev.workingHours, start: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">End Time</label>
                      <input
                        type="time"
                        value={businessSettings.workingHours.end}
                        onChange={(e) => setBusinessSettings(prev => ({
                          ...prev,
                          workingHours: { ...prev.workingHours, end: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Complete */}
          {currentStep === 4 && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>

              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Setup Complete!</h2>
                <p className="text-gray-600">
                  Your ChemCheck account is ready. You can now start managing your pool service business.
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 text-left">
                <h4 className="font-medium text-gray-900 mb-2">What's Next?</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Add your first customers</li>
                  <li>• Set up service routes</li>
                  <li>• Start logging service visits</li>
                  <li>• Invite employees (coming soon)</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex items-center justify-between">
          <button
            onClick={handlePrevious}
            disabled={currentStep === 1}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" />
            Previous
          </button>

          {currentStep < 4 ? (
            <button
              onClick={handleNext}
              disabled={!isStepValid()}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleComplete}
              disabled={isLoading}
              className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Setting up...
                </>
              ) : (
                <>
                  Complete Setup
                  <CheckCircle className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}