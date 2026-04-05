import { useState, useEffect } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import {
  Building2,
  User,
  Bell,
  Database,
  ChevronRight,
  Save,
  MapPin,
  Phone,
  Mail,
  Clock,
  Calendar,
  Globe,
  Activity,
  HardDrive,
  Camera,
  FileSignature,
  Route,
  Beaker,
  Download,
  Trash2,
  Eye,
  BarChart3,
  LogOut,
  AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { userManager } from '@/lib/userManager';
import { autoBackup } from '@/lib/backup';
import { notificationManager } from '@/lib/notifications';
import { BackupManager } from '@/components/BackupManager';
import { downloadUserData, deleteAllUserData, getDataRetentionSummary } from '@/lib/gdpr';
import { optOutAnalytics, optInAnalytics, hasOptedOut } from '@/lib/analytics';
import { useAuthContext } from '@/components/auth/ClerkAuthProvider';
import {
  getPhotoStorageStats,
  clearSyncedPhotos,
  clearAllPhotos as clearAllLocalPhotos,
  formatStorageBytes,
} from '@/lib/proof-of-service';

function AccountSection({ userData, setUserData }) {
  const auth = useAuthContext();
  const deleteAccountData = useMutation(api.account.deleteMyAccount);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleLogout = async () => {
    if (!auth?.logout) {
      setLogoutError('Authentication service is not available');
      return;
    }

    setIsLoggingOut(true);
    setLogoutError('');

    try {
      await auth.logout();
    } catch (error) {
      console.error('Logout failed:', error);
      setLogoutError('Failed to sign out. Please try again.');
      setIsLoggingOut(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError('');

    try {
      if (auth?.isSignedIn && auth?.clerkUser) {
        await deleteAccountData({});
      }

      await deleteAllUserData();

      if (auth?.clerkUser && typeof auth.clerkUser.delete === 'function') {
        await auth.clerkUser.delete();
      }

      if (auth?.logout) {
        await auth.logout();
      }

      setShowDeleteConfirm(false);
      setIsDeleting(false);
    } catch (error) {
      console.error('Account deletion failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setDeleteError(`Failed to delete account: ${errorMessage}`);
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Account Settings</h2>
        <p className="text-sm text-slate-600">Manage your personal account</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Full Name
          </label>
          <input
            type="text"
            value={userData.name}
            onChange={(e) => setUserData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Enter your full name"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900 placeholder:text-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Email Address
          </label>
          <input
            type="email"
            value={userData.email}
            disabled
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-500"
          />
          <p className="text-xs text-slate-500 mt-1">Email cannot be changed</p>
        </div>
      </div>

      <div className="pt-6 border-t border-slate-200">
        {logoutError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{logoutError}</p>
          </div>
        )}
        <div className="p-4 bg-slate-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-900">Sign Out</p>
              <p className="text-sm text-slate-600">Sign out of your ChemCheck account</p>
            </div>
            <Button
              onClick={handleLogout}
              disabled={isLoggingOut}
              variant="outline"
              className="border-red-300 text-red-700 hover:bg-red-50 hover:border-red-400"
            >
              {isLoggingOut ? (
                <>
                  <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin mr-2" />
                  Signing out...
                </>
              ) : (
                <>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-red-200">
        {deleteError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{deleteError}</p>
          </div>
        )}

        {!showDeleteConfirm ? (
          <div className="p-4 bg-red-50/50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-red-800">Delete Account</p>
                <p className="text-sm text-red-600">Permanently delete your account and all data</p>
              </div>
              <Button
                onClick={() => setShowDeleteConfirm(true)}
                variant="outline"
                className="border-red-400 text-red-700 hover:bg-red-100 hover:border-red-500"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-red-50 border-2 border-red-300 rounded-lg space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 rounded-full flex-shrink-0 mt-0.5">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-red-800">Are you sure?</p>
                <p className="text-sm text-red-700 mt-1">
                  This will permanently delete your account, all customer data, service logs, photos, and settings. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button
                onClick={() => setShowDeleteConfirm(false)}
                variant="outline"
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Yes, Delete My Account
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export default function Settings() {
  const [activeSection, setActiveSection] = useState('business');
  const [showBackupManager, setShowBackupManager] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [photoStorage, setPhotoStorage] = useState({
    count: 0,
    totalSizeBytes: 0,
    maxSizeBytes: 100 * 1024 * 1024,
    usagePercent: 0,
  });
  const [isStorageLoading, setIsStorageLoading] = useState(false);
  const [privacyConfirmAction, setPrivacyConfirmAction] = useState(null);
  const [dataSummaryRows, setDataSummaryRows] = useState([]);
  const [isDataSummaryOpen, setIsDataSummaryOpen] = useState(false);
  const [isDeleteAllDataDialogOpen, setIsDeleteAllDataDialogOpen] = useState(false);
  const [deleteAllDataConfirmText, setDeleteAllDataConfirmText] = useState('');
  const [isDeletingAllData, setIsDeletingAllData] = useState(false);

  const convexBusiness = useQuery(api.businesses.getCurrent);
  const updateBusiness = useMutation(api.businesses.update);
  const updateBusinessSettings = useMutation(api.businesses.updateSettings);

  const [businessData, setBusinessData] = useState({
    name: '',
    address: '',
    phone: '',
    email: ''
  });

  const [userData, setUserData] = useState({
    name: '',
    email: ''
  });

  const [preferences, setPreferences] = useState({
    language: 'en',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    notifications: {
      serviceReminders: true,
      lowChemicals: true,
      customerUpdates: true
    },
    defaultView: 'route',
    autoBackup: true,
    default_workorders_section: 'dispatch',
    home_primary_action: 'start_next_pending',
    show_ops_brief: true,
  });
  const showPlaceholderLabels = import.meta.env.VITE_SHOW_PLACEHOLDERS === 'true';

  const [businessSettings, setBusinessSettings] = useState({
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    workingHours: { start: '08:00', end: '17:00' },
    serviceTypes: ['Regular Cleaning', 'Chemical Balance', 'Equipment Check', 'Repair'],
    chemicalTypes: ['Chlorine Tablets', 'Liquid Chlorine', 'pH Up', 'pH Down', 'Alkalinity Up', 'Stabilizer'],
    defaultPoolTypes: ['Chlorine', 'Salt'],
    defaultSurfaceTypes: ['Plaster', 'Vinyl', 'Fiberglass', 'Tile'],
    routeOptimization: true,
    requirePhotos: false,
    requireSignatures: false,
    defaultWorkordersSection: 'dispatch',
    homePrimaryAction: 'start_next_pending',
    showOpsBrief: true,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (activeSection === 'privacy') {
      void refreshPhotoStorageStats();
    }
  }, [activeSection]);

  useEffect(() => {
    if (convexBusiness) {
      setBusinessData({
        name: convexBusiness.name || '',
        address: convexBusiness.address || '',
        phone: convexBusiness.phone || '',
        email: convexBusiness.email || ''
      });
      if (convexBusiness.settings) {
        setBusinessSettings({
          workingDays: convexBusiness.settings.working_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          workingHours: {
            start: convexBusiness.settings.working_hours_start || '08:00',
            end: convexBusiness.settings.working_hours_end || '17:00'
          },
          serviceTypes: convexBusiness.settings.service_types || ['Regular Cleaning', 'Chemical Balance', 'Equipment Check', 'Repair'],
          chemicalTypes: convexBusiness.settings.chemical_types || ['Chlorine Tablets', 'Liquid Chlorine', 'pH Up', 'pH Down', 'Alkalinity Up', 'Stabilizer'],
          defaultPoolTypes: ['Chlorine', 'Salt'],
          defaultSurfaceTypes: ['Plaster', 'Vinyl', 'Fiberglass', 'Tile'],
          routeOptimization: convexBusiness.settings.route_optimization ?? true,
          requirePhotos: convexBusiness.settings.require_photos ?? false,
          requireSignatures: convexBusiness.settings.require_signatures ?? false,
          defaultWorkordersSection: convexBusiness.settings.default_workorders_section || 'dispatch',
          homePrimaryAction: convexBusiness.settings.home_primary_action || 'start_next_pending',
          showOpsBrief: convexBusiness.settings.show_ops_brief ?? true,
        });
      }
    }
  }, [convexBusiness]);

  const loadSettings = () => {
    const currentUser = userManager.getCurrentUser();
    const currentBusiness = userManager.getCurrentBusiness();
    const defaultNotifications = {
      serviceReminders: true,
      lowChemicals: true,
      customerUpdates: true
    };

    if (currentUser) {
      let syncedNotifications = currentUser.preferences?.notifications || defaultNotifications;
      try {
        const storedNotificationConfig = localStorage.getItem('notification_config');
        if (storedNotificationConfig) {
          const parsed = JSON.parse(storedNotificationConfig);
          syncedNotifications = {
            ...syncedNotifications,
            serviceReminders: parsed.serviceReminders ?? syncedNotifications.serviceReminders,
            lowChemicals: parsed.lowChemicals ?? syncedNotifications.lowChemicals,
            customerUpdates: parsed.customerUpdates ?? syncedNotifications.customerUpdates
          };
        }
      } catch (error) {
        console.error('Failed to load notification config:', error);
      }

      setUserData({
        name: currentUser.name || '',
        email: currentUser.email || ''
      });
      setPreferences({
        language: currentUser.preferences?.language || 'en',
        timezone: currentUser.preferences?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        notifications: syncedNotifications,
        defaultView: currentUser.preferences?.defaultView || 'route',
        autoBackup: currentUser.preferences?.autoBackup ?? true,
        default_workorders_section: currentUser.preferences?.default_workorders_section || 'dispatch',
        home_primary_action: currentUser.preferences?.home_primary_action || 'start_next_pending',
        show_ops_brief: currentUser.preferences?.show_ops_brief ?? true,
      });
    } else {
      try {
        const rawFallback = localStorage.getItem('chemcheck_settings_fallback');
        if (rawFallback) {
          const fallback = JSON.parse(rawFallback);
          if (fallback?.userData?.name || fallback?.userData?.email) {
            setUserData({
              name: fallback.userData?.name || '',
              email: fallback.userData?.email || ''
            });
          }
          if (fallback?.preferences) {
            setPreferences(prev => ({
              ...prev,
              ...fallback.preferences,
              notifications: {
                ...prev.notifications,
                ...(fallback.preferences.notifications || {})
              }
            }));
          }
        }
      } catch (error) {
        console.error('Failed to load fallback settings:', error);
      }
    }

    if (currentBusiness) {
      const settings = currentBusiness.settings || {};
      setBusinessData({
        name: currentBusiness.name || '',
        address: currentBusiness.address || '',
        phone: currentBusiness.phone || '',
        email: currentBusiness.email || ''
      });
      setBusinessSettings({
        workingDays: settings.workingDays || settings.working_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        workingHours: {
          start: settings.workingHours?.start || settings.working_hours_start || '08:00',
          end: settings.workingHours?.end || settings.working_hours_end || '17:00'
        },
        serviceTypes: settings.serviceTypes || settings.service_types || ['Regular Cleaning', 'Chemical Balance', 'Equipment Check', 'Repair'],
        chemicalTypes: settings.chemicalTypes || settings.chemical_types || ['Chlorine Tablets', 'Liquid Chlorine', 'pH Up', 'pH Down', 'Alkalinity Up', 'Stabilizer'],
        defaultPoolTypes: settings.defaultPoolTypes || ['Chlorine', 'Salt'],
        defaultSurfaceTypes: settings.defaultSurfaceTypes || ['Plaster', 'Vinyl', 'Fiberglass', 'Tile'],
        routeOptimization: settings.routeOptimization ?? settings.route_optimization ?? true,
        requirePhotos: settings.requirePhotos ?? settings.require_photos ?? false,
        requireSignatures: settings.requireSignatures ?? settings.require_signatures ?? false,
        defaultWorkordersSection: settings.defaultWorkordersSection || settings.default_workorders_section || 'dispatch',
        homePrimaryAction: settings.homePrimaryAction || settings.home_primary_action || 'start_next_pending',
        showOpsBrief: settings.showOpsBrief ?? settings.show_ops_brief ?? true,
      });
    }
  };

  const refreshPhotoStorageStats = async () => {
    setIsStorageLoading(true);
    try {
      const stats = await getPhotoStorageStats();
      setPhotoStorage(stats);
    } catch (error) {
      console.error('Failed to load photo storage stats:', error);
    } finally {
      setIsStorageLoading(false);
    }
  };

  const handleClearSyncedPhotos = async () => {
    try {
      const deletedCount = await clearSyncedPhotos();
      setSaveMessage(`Synced photo cleanup successful: cleared ${deletedCount} photo${deletedCount === 1 ? '' : 's'}.`);
      await refreshPhotoStorageStats();
    } catch (error) {
      console.error('Failed to clear synced photos:', error);
      setSaveMessage('Failed to clear synced photos.');
    }
  };

  const handleClearAllLocalPhotos = async () => {
    try {
      await clearAllLocalPhotos();
      setSaveMessage('Local photo cleanup successful: cleared all local photos.');
      await refreshPhotoStorageStats();
    } catch (error) {
      console.error('Failed to clear local photos:', error);
      setSaveMessage('Failed to clear local photos.');
    }
  };

  const handleLoadDataSummary = async () => {
    try {
      const summary = await getDataRetentionSummary();
      setDataSummaryRows(summary?.dataTypes || []);
      setIsDataSummaryOpen(true);
    } catch (error) {
      console.error('Failed to load data summary:', error);
      setSaveMessage('Failed to load data summary. Please try again.');
    }
  };

  const handleDeleteAllData = async () => {
    if (deleteAllDataConfirmText.trim() !== 'DELETE') return;
    setIsDeletingAllData(true);

    try {
      const result = await deleteAllUserData();
      setSaveMessage(
        `Data deleted: ${result.deleted.customers} customers, ${result.deleted.serviceLogs} service logs, ${result.deleted.chemicalUsage} chemical records, ${result.deleted.notes} notes.`
      );
      setIsDeleteAllDataDialogOpen(false);
      setDeleteAllDataConfirmText('');
      window.location.reload();
    } catch (error) {
      console.error('Failed to delete all data:', error);
      setSaveMessage('Failed to delete all data. Please try again.');
    } finally {
      setIsDeletingAllData(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');
    const normalizedPreferences = {
      ...preferences,
      default_workorders_section: businessSettings.defaultWorkordersSection,
      home_primary_action: businessSettings.homePrimaryAction,
      show_ops_brief: businessSettings.showOpsBrief,
    };

    try {
      if (convexBusiness) {
        await updateBusiness({
          name: businessData.name,
          address: businessData.address,
          phone: businessData.phone,
          email: businessData.email,
        });

        await updateBusinessSettings({
          working_days: businessSettings.workingDays,
          working_hours_start: businessSettings.workingHours.start,
          working_hours_end: businessSettings.workingHours.end,
          service_types: businessSettings.serviceTypes,
          chemical_types: businessSettings.chemicalTypes,
          route_optimization: businessSettings.routeOptimization,
          require_photos: businessSettings.requirePhotos,
          require_signatures: businessSettings.requireSignatures,
          default_workorders_section: businessSettings.defaultWorkordersSection,
          home_primary_action: businessSettings.homePrimaryAction,
          show_ops_brief: businessSettings.showOpsBrief,
        });
      } else {
        const businesses = JSON.parse(localStorage.getItem('chemcheck_businesses') || '[]');
        const currentBusiness = userManager.getCurrentBusiness();

        if (currentBusiness) {
          const businessIndex = businesses.findIndex(b => b.id === currentBusiness.id);
          if (businessIndex >= 0) {
            businesses[businessIndex] = {
              ...businesses[businessIndex],
              ...businessData,
              settings: {
                ...businesses[businessIndex].settings,
                ...businessSettings
              }
            };
            localStorage.setItem('chemcheck_businesses', JSON.stringify(businesses));
            localStorage.setItem('chemcheck_current_business', JSON.stringify(businesses[businessIndex]));
          }

          await userManager.updateBusinessSettings(businessSettings);
        }
      }

      const currentUser = userManager.getCurrentUser();

      if (currentUser) {
        await userManager.updateUserPreferences(normalizedPreferences);
      } else {
        localStorage.setItem('chemcheck_settings_fallback', JSON.stringify({
          userData,
          preferences: normalizedPreferences,
          savedAt: Date.now(),
        }));
      }

      notificationManager.updateConfig({
        serviceReminders: preferences.notifications.serviceReminders,
        lowChemicals: preferences.notifications.lowChemicals,
        customerUpdates: preferences.notifications.customerUpdates,
      });
      if (preferences.autoBackup) {
        autoBackup.start();
      } else {
        autoBackup.stop();
      }

      if (currentUser) {
        const users = JSON.parse(localStorage.getItem('chemcheck_users') || '[]');
        const userIndex = users.findIndex(u => u.id === currentUser.id);
        if (userIndex >= 0) {
          users[userIndex] = {
            ...users[userIndex],
            name: userData.name
          };
          localStorage.setItem('chemcheck_users', JSON.stringify(users));
          localStorage.setItem('chemcheck_current_user', JSON.stringify(users[userIndex]));
        }
      }

      setSaveMessage('Settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveMessage('Failed to save settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const sections = [
    { id: 'business', label: 'Business Info', icon: Building2 },
    { id: 'account', label: 'Account', icon: User },
    { id: 'preferences', label: 'Preferences', icon: Globe },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'schedule', label: 'Schedule', icon: Calendar },
    { id: 'services', label: 'Service Types', icon: Beaker },
    { id: 'backup', label: 'Data Backup', icon: HardDrive },
    { id: 'privacy', label: 'Privacy & Data', icon: Eye }
  ];

  if (showBackupManager) {
    return <BackupManager onClose={() => setShowBackupManager(false)} />;
  }

  return (
    <>
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-24">
      <div className="mb-4 sm:mb-6">
        <div className="mb-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Settings</h1>
            <p className="text-xs sm:text-sm text-slate-600">Manage your business and account</p>
          </div>
        </div>
      </div>

      <div className="lg:hidden mb-4 -mx-3 px-3 overflow-x-auto">
        <div className="flex gap-2 pb-2 min-w-max">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${activeSection === section.id
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
                : 'bg-white text-slate-700 border border-slate-200'
                }`}
            >
              <section.icon className="w-4 h-4" />
              <span>{section.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="hidden lg:block lg:col-span-1">
          <Card className="p-2">
            <nav className="space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${activeSection === section.id
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
                    : 'text-slate-700 hover:bg-slate-100'
                    }`}
                >
                  <section.icon className="w-5 h-5" />
                  <span className="font-medium">{section.label}</span>
                  <ChevronRight className={`w-4 h-4 ml-auto ${activeSection === section.id ? 'text-white' : 'text-slate-400'}`} />
                </button>
              ))}
            </nav>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card className="p-4 sm:p-6">
            {activeSection === 'business' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-1">Business Information</h2>
                  <p className="text-sm text-slate-600">Update your business details</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      <Building2 className="w-4 h-4 inline mr-2" />
                      Business Name
                    </label>
                    <input
                      type="text"
                      value={businessData.name}
                      onChange={(e) => setBusinessData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Enter your business name"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900 placeholder:text-gray-400"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      <MapPin className="w-4 h-4 inline mr-2" />
                      Address
                    </label>
                    <textarea
                      value={businessData.address}
                      onChange={(e) => setBusinessData(prev => ({ ...prev, address: e.target.value }))}
                      rows={2}
                      placeholder="Enter your business address"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900 placeholder:text-gray-400"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        <Phone className="w-4 h-4 inline mr-2" />
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={businessData.phone}
                        onChange={(e) => setBusinessData(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="(555) 123-4567"
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-base text-slate-900 placeholder:text-gray-400"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        <Mail className="w-4 h-4 inline mr-2" />
                        Email
                      </label>
                      <input
                        type="email"
                        value={businessData.email}
                        onChange={(e) => setBusinessData(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="business@example.com"
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-base text-slate-900 placeholder:text-gray-400"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'account' && (
              <AccountSection
                userData={userData}
                setUserData={setUserData}
              />
            )}

            {activeSection === 'preferences' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-1">Preferences</h2>
                  <p className="text-sm text-slate-600">Customize your app experience</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      <Globe className="w-4 h-4 inline mr-2" />
                      Language
                    </label>
                    <select
                      value={preferences.language}
                      onChange={(e) => setPreferences(prev => ({ ...prev, language: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900 disabled:text-slate-500 disabled:bg-slate-50"
                      disabled
                    >
                      <option value="en">English</option>
                    </select>
                    {showPlaceholderLabels && (
                      <p className="text-xs text-slate-500 mt-1">Additional languages coming soon</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Default View
                    </label>
                    <select
                      value={preferences.defaultView}
                      onChange={(e) => setPreferences(prev => ({ ...prev, defaultView: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900"
                    >
                      <option value="route">Route View</option>
                      <option value="customers">Customer List</option>
                    </select>
                    {showPlaceholderLabels && (
                      <p className="text-xs text-slate-500 mt-1">Calendar view coming soon</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Default Work Orders Section
                    </label>
                    <select
                      value={businessSettings.defaultWorkordersSection}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setBusinessSettings((prev) => ({ ...prev, defaultWorkordersSection: nextValue }));
                        setPreferences((prev) => ({ ...prev, default_workorders_section: nextValue }));
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900"
                    >
                      <option value="dispatch">Dispatch</option>
                      <option value="quotes">Quotes</option>
                      <option value="invoices">Invoices</option>
                      <option value="comms">Communications</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Home Primary Action
                    </label>
                    <select
                      value={businessSettings.homePrimaryAction}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setBusinessSettings((prev) => ({ ...prev, homePrimaryAction: nextValue }));
                        setPreferences((prev) => ({ ...prev, home_primary_action: nextValue }));
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900"
                    >
                      <option value="start_next_pending">Start Next Pending</option>
                      <option value="open_route_plan">Open Route Plan</option>
                      <option value="add_client">Add Client</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div>
                      <p className="font-medium text-slate-900">Show Daily Ops Brief</p>
                      <p className="text-sm text-slate-600">Display estimated route summary on Home.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={businessSettings.showOpsBrief}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setBusinessSettings((prev) => ({ ...prev, showOpsBrief: checked }));
                          setPreferences((prev) => ({ ...prev, show_ops_brief: checked }));
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-cyan-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'notifications' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-1">Notifications</h2>
                  <p className="text-sm text-slate-600">Configure notification preferences</p>
                </div>

                <div className="space-y-3">
                  {[
                    { key: 'serviceReminders', label: 'Service Reminders', desc: 'Get reminded about upcoming services' },
                    { key: 'lowChemicals', label: 'Low Chemical Alerts', desc: 'Alert when chemical levels are low' },
                    { key: 'customerUpdates', label: 'Customer Updates', desc: 'Notifications about customer changes' }
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <div>
                        <p className="font-medium text-slate-900">{item.label}</p>
                        <p className="text-sm text-slate-600">{item.desc}</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.notifications[item.key]}
                          onChange={(e) => setPreferences(prev => ({
                            ...prev,
                            notifications: { ...prev.notifications, [item.key]: e.target.checked }
                          }))}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-cyan-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeSection === 'schedule' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-1">Work Schedule</h2>
                  <p className="text-sm text-slate-600">Set your business working hours</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-3">
                      <Calendar className="w-4 h-4 inline mr-2" />
                      Working Days
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                        <label
                          key={day}
                          className={`px-4 py-2 rounded-lg cursor-pointer transition-all ${businessSettings.workingDays.includes(day)
                            ? 'bg-cyan-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                        >
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
                            className="sr-only"
                          />
                          {day.slice(0, 3)}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-3">
                      <Clock className="w-4 h-4 inline mr-2" />
                      Working Hours
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Start Time</label>
                        <input
                          type="time"
                          value={businessSettings.workingHours.start}
                          onChange={(e) => setBusinessSettings(prev => ({
                            ...prev,
                            workingHours: { ...prev.workingHours, start: e.target.value }
                          }))}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">End Time</label>
                        <input
                          type="time"
                          value={businessSettings.workingHours.end}
                          onChange={(e) => setBusinessSettings(prev => ({
                            ...prev,
                            workingHours: { ...prev.workingHours, end: e.target.value }
                          }))}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'services' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-1">Service Configuration</h2>
                  <p className="text-sm text-slate-600">Configure service types, chemicals, and requirements</p>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-3">
                      <Beaker className="w-4 h-4 inline mr-2" />
                      Service Types
                    </label>
                    <div className="space-y-2">
                      {businessSettings.serviceTypes.map((type, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={type}
                            onChange={(e) => {
                              const newTypes = [...businessSettings.serviceTypes];
                              newTypes[index] = e.target.value;
                              setBusinessSettings(prev => ({ ...prev, serviceTypes: newTypes }));
                            }}
                            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900 placeholder:text-gray-400"
                          />
                          <Button
                            onClick={() => {
                              const newTypes = businessSettings.serviceTypes.filter((_, i) => i !== index);
                              setBusinessSettings(prev => ({ ...prev, serviceTypes: newTypes }));
                            }}
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <Button
                        onClick={() => {
                          setBusinessSettings(prev => ({
                            ...prev,
                            serviceTypes: [...prev.serviceTypes, 'New Service Type']
                          }));
                        }}
                        variant="outline"
                        size="sm"
                        className="w-full"
                      >
                        Add Service Type
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-3">
                      Chemical Types
                    </label>
                    <div className="space-y-2">
                      {businessSettings.chemicalTypes.map((type, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={type}
                            onChange={(e) => {
                              const newTypes = [...businessSettings.chemicalTypes];
                              newTypes[index] = e.target.value;
                              setBusinessSettings(prev => ({ ...prev, chemicalTypes: newTypes }));
                            }}
                            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-slate-900 placeholder:text-gray-400"
                          />
                          <Button
                            onClick={() => {
                              const newTypes = businessSettings.chemicalTypes.filter((_, i) => i !== index);
                              setBusinessSettings(prev => ({ ...prev, chemicalTypes: newTypes }));
                            }}
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <Button
                        onClick={() => {
                          setBusinessSettings(prev => ({
                            ...prev,
                            chemicalTypes: [...prev.chemicalTypes, 'New Chemical']
                          }));
                        }}
                        variant="outline"
                        size="sm"
                        className="w-full"
                      >
                        Add Chemical Type
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div className="flex items-start sm:items-center justify-between gap-3 p-4 bg-slate-50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 text-sm sm:text-base flex items-center gap-2">
                          <Route className="w-4 h-4" />
                          Route Optimization
                        </p>
                        <p className="text-xs sm:text-sm text-slate-600">Automatically optimize daily routes</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={businessSettings.routeOptimization}
                          onChange={(e) => setBusinessSettings(prev => ({ ...prev, routeOptimization: e.target.checked }))}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-cyan-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                      </label>
                    </div>

                    <div className="flex items-start sm:items-center justify-between gap-3 p-4 bg-slate-50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 text-sm sm:text-base flex items-center gap-2">
                          <Camera className="w-4 h-4" />
                          Require Photos
                        </p>
                        <p className="text-xs sm:text-sm text-slate-600">Require before/after photos for service completion</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={businessSettings.requirePhotos}
                          onChange={(e) => {
                            setBusinessSettings(prev => ({ ...prev, requirePhotos: e.target.checked }));
                            try {
                              const stored = localStorage.getItem('chemcheck_business_proof_settings');
                              const proofSettings = stored ? JSON.parse(stored) : { proof_of_service: {} };
                              proofSettings.proof_of_service = {
                                ...proofSettings.proof_of_service,
                                require_before_photos: e.target.checked,
                                require_after_photos: e.target.checked,
                                min_photos_before: e.target.checked ? 1 : 0,
                                min_photos_after: e.target.checked ? 1 : 0,
                              };
                              localStorage.setItem('chemcheck_business_proof_settings', JSON.stringify(proofSettings));
                            } catch (err) {
                              console.error('Failed to update proof settings:', err);
                            }
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-cyan-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                      </label>
                    </div>

                    {showPlaceholderLabels && (
                      <div className="flex items-start sm:items-center justify-between gap-3 p-4 bg-slate-50 rounded-lg opacity-60">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 text-sm sm:text-base flex items-center gap-2">
                            <FileSignature className="w-4 h-4" />
                            Require Signatures
                            <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">Coming Soon</span>
                          </p>
                          <p className="text-xs sm:text-sm text-slate-600">Require customer signatures for services</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-not-allowed flex-shrink-0">
                          <input
                            type="checkbox"
                            checked={businessSettings.requireSignatures}
                            disabled
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'backup' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-1">Data Backup</h2>
                  <p className="text-sm text-slate-600">Protect and manage your pool service data</p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => setShowBackupManager(true)}
                    className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-lg hover:from-blue-100 hover:to-cyan-100 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-600 rounded-lg">
                        <HardDrive className="w-5 h-5 text-white" />
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-slate-900">Backup Manager</p>
                        <p className="text-sm text-slate-600">Export, import, and manage data backups</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  </button>

                  <div className="p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-slate-600" />
                      <span className="text-sm font-medium text-slate-900">Auto-Backup Status</span>
                    </div>
                    <p className="text-sm text-slate-600 mb-3">
                      {preferences.autoBackup
                        ? 'Automatic backups are enabled and run every 24 hours'
                        : 'Automatic backups are disabled'
                      }
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-700">Enable Auto-Backup</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.autoBackup}
                          onChange={(e) => setPreferences(prev => ({ ...prev, autoBackup: e.target.checked }))}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-cyan-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'privacy' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-1">Privacy & Data</h2>
                  <p className="text-sm text-slate-600">Manage your data and privacy settings (GDPR compliant)</p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-blue-600 rounded-lg">
                        <Download className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">Export Your Data</p>
                        <p className="text-sm text-slate-600 mb-3">
                          Download all your data in a machine-readable format (JSON).
                          This includes customers, service logs, chemical usage, and notes.
                        </p>
                        <Button
                          onClick={async () => {
                            try {
                              await downloadUserData();
                              setSaveMessage('Data exported successfully!');
                              setTimeout(() => setSaveMessage(''), 3000);
                            } catch (error) {
                              setSaveMessage('Failed to export data');
                            }
                          }}
                          variant="outline"
                          className="border-blue-300 text-blue-700 hover:bg-blue-100"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download My Data
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <BarChart3 className="w-5 h-5 text-slate-600" />
                        <div>
                          <p className="font-medium text-slate-900">Usage Analytics</p>
                          <p className="text-sm text-slate-600">
                            Help improve ChemCheck by sharing anonymous usage data
                          </p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!hasOptedOut()}
                          onChange={(e) => {
                            if (e.target.checked) {
                              optInAnalytics();
                            } else {
                              optOutAnalytics();
                            }
                            setPreferences(prev => ({ ...prev }));
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-cyan-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                      </label>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Database className="w-4 h-4 text-slate-600" />
                      <span className="font-medium text-slate-900">Data Storage</span>
                    </div>
                    <p className="text-sm text-slate-600 mb-2">
                      Your data is stored locally on this device and synced to our secure cloud servers.
                      We retain your data as long as your account is active.
                    </p>
                    <Button
                      onClick={handleLoadDataSummary}
                      variant="outline"
                      size="sm"
                    >
                      View Data Summary
                    </Button>
                    <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-700">Local photo storage</span>
                        <span className="text-sm font-medium text-slate-900">
                          {isStorageLoading
                            ? 'Loading...'
                            : `${formatStorageBytes(photoStorage.totalSizeBytes)} / ${formatStorageBytes(photoStorage.maxSizeBytes)}`}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${photoStorage.usagePercent >= 85 ? 'bg-red-500' : 'bg-cyan-600'}`}
                          style={{ width: `${Math.min(100, photoStorage.usagePercent)}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-500">
                        {photoStorage.count} local photo{photoStorage.count === 1 ? '' : 's'} ({photoStorage.usagePercent}% used)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => setPrivacyConfirmAction('clear_synced')}
                          variant="outline"
                          size="sm"
                        >
                          Clear Synced Photos
                        </Button>
                        <Button
                          onClick={() => setPrivacyConfirmAction('clear_all')}
                          variant="outline"
                          size="sm"
                          className="border-red-300 text-red-700 hover:bg-red-100"
                        >
                          Clear All Local Photos
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-red-600 rounded-lg">
                        <Trash2 className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-red-900">Delete All My Data</p>
                        <p className="text-sm text-red-700 mb-3">
                          Permanently delete all your data from ChemCheck. This action cannot be undone.
                          We recommend exporting your data first.
                        </p>
                        <Button
                          onClick={() => setIsDeleteAllDataDialogOpen(true)}
                          variant="outline"
                          className="border-red-300 text-red-700 hover:bg-red-100"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete All Data
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-lg">
                    <p className="text-sm text-slate-600">
                      For more information about how we handle your data, please read our{' '}
                      <a href="/privacy-policy.html" target="_blank" className="text-cyan-600 hover:underline">
                        Privacy Policy
                      </a>{' '}
                      and{' '}
                      <a href="/terms-of-service.html" target="_blank" className="text-cyan-600 hover:underline">
                        Terms of Service
                      </a>.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:justify-between">
              {saveMessage && (
                <p className={`text-sm text-center sm:text-left ${saveMessage.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
                  {saveMessage}
                </p>
              )}
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full sm:w-auto sm:ml-auto bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white py-3 sm:py-2"
              >
                {isSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>
      </div>
      </div>

      <AlertDialog open={Boolean(privacyConfirmAction)} onOpenChange={(open) => !open && setPrivacyConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {privacyConfirmAction === 'clear_all' ? 'Clear All Local Photos?' : 'Clear Synced Photos?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {privacyConfirmAction === 'clear_all'
                ? 'This removes all local photo files from this device. Synced cloud copies remain available.'
                : 'This removes only photos that are already synced to cloud from local storage.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (privacyConfirmAction === 'clear_all') {
                  void handleClearAllLocalPhotos();
                } else {
                  void handleClearSyncedPhotos();
                }
                setPrivacyConfirmAction(null);
              }}
              className={privacyConfirmAction === 'clear_all' ? 'bg-red-600 hover:bg-red-700 text-white' : undefined}
            >
              {privacyConfirmAction === 'clear_all' ? 'Clear All Photos' : 'Clear Synced Photos'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isDataSummaryOpen} onOpenChange={setIsDataSummaryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Data Summary</DialogTitle>
            <DialogDescription>Current retained records by data type.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {dataSummaryRows.length === 0 ? (
              <p className="text-sm text-slate-600">No data available.</p>
            ) : (
              dataSummaryRows.map((item) => (
                <div key={item.type} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                  <span className="text-sm text-slate-700">{item.type}</span>
                  <span className="text-sm font-semibold text-slate-900">{item.count}</span>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDataSummaryOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteAllDataDialogOpen} onOpenChange={setIsDeleteAllDataDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes all customers, service logs, chemical usage records, and notes.
              Type <span className="font-semibold">DELETE</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            value={deleteAllDataConfirmText}
            onChange={(e) => setDeleteAllDataConfirmText(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            placeholder="Type DELETE"
          />
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setDeleteAllDataConfirmText('')}
              disabled={isDeletingAllData}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteAllData();
              }}
              disabled={deleteAllDataConfirmText.trim() !== 'DELETE' || isDeletingAllData}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
            >
              {isDeletingAllData ? 'Deleting...' : 'Delete All Data'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
