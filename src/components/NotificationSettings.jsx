import { useState, useEffect } from 'react';
import { 
  Bell, 
  BellOff, 
  Clock, 
  AlertTriangle,
  CheckCircle,
  Settings,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { notificationManager, requestNotificationPermission } from '@/lib/notifications';

export function NotificationSettings() {
  const [config, setConfig] = useState(notificationManager.getConfig());
  const [hasPermission, setHasPermission] = useState(notificationManager.hasPermission());
  const [isRequesting, setIsRequesting] = useState(false);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    setHasPermission(notificationManager.hasPermission());
  }, []);

  const handleRequestPermission = async () => {
    setIsRequesting(true);
    try {
      const granted = await requestNotificationPermission();
      setHasPermission(granted);
    } finally {
      setIsRequesting(false);
    }
  };

  const handleConfigChange = (key, value) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    notificationManager.updateConfig({ [key]: value });
  };

  const handleTestNotification = async () => {
    const success = await notificationManager.showNotification(
      'Test Notification',
      'This is a test notification from ChemCheck!',
      { tag: 'test', data: { type: 'test' } }
    );
    if (success) {
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
          <Bell className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Notifications</h3>
          <p className="text-sm text-slate-500">Manage your notification preferences</p>
        </div>
      </div>

      {/* Permission Status */}
      {!hasPermission && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-amber-900">Notifications Disabled</h4>
              <p className="text-sm text-amber-700 mt-1">
                Enable notifications to receive service reminders and alerts.
              </p>
              <Button
                onClick={handleRequestPermission}
                disabled={isRequesting}
                size="sm"
                className="mt-3"
              >
                {isRequesting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Bell className="w-4 h-4 mr-2" />
                )}
                Enable Notifications
              </Button>
            </div>
          </div>
        </div>
      )}

      {hasPermission && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-green-800">Notifications are enabled</span>
          </div>
        </div>
      )}

      {/* Master Toggle */}
      <div className="space-y-4">
        <div className="flex items-center justify-between py-3 border-b">
          <div>
            <p className="font-medium text-slate-900">Enable All Notifications</p>
            <p className="text-sm text-slate-500">Master switch for all notifications</p>
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={(checked) => handleConfigChange('enabled', checked)}
            disabled={!hasPermission}
          />
        </div>

        {/* Individual Settings */}
        <div className={config.enabled ? '' : 'opacity-50 pointer-events-none'}>
          <div className="flex items-center justify-between py-3 border-b">
            <div>
              <p className="font-medium text-slate-900">Service Reminders</p>
              <p className="text-sm text-slate-500">Get notified before scheduled services</p>
            </div>
            <Switch
              checked={config.serviceReminders}
              onCheckedChange={(checked) => handleConfigChange('serviceReminders', checked)}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-b">
            <div>
              <p className="font-medium text-slate-900">Low Chemical Alerts</p>
              <p className="text-sm text-slate-500">Alert when chemicals are running low</p>
            </div>
            <Switch
              checked={config.lowChemicals}
              onCheckedChange={(checked) => handleConfigChange('lowChemicals', checked)}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-b">
            <div>
              <p className="font-medium text-slate-900">Customer Updates</p>
              <p className="text-sm text-slate-500">Notifications about customer changes</p>
            </div>
            <Switch
              checked={config.customerUpdates}
              onCheckedChange={(checked) => handleConfigChange('customerUpdates', checked)}
            />
          </div>

          {/* Timing Settings */}
          <div className="py-3 border-b">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-slate-500" />
              <p className="font-medium text-slate-900">Reminder Timing</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">
                  Reminder Time
                </label>
                <input
                  type="time"
                  value={config.reminderTime}
                  onChange={(e) => handleConfigChange('reminderTime', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm text-slate-600 mb-1">
                  Advance Notice (hours)
                </label>
                <select
                  value={config.advanceNotice}
                  onChange={(e) => handleConfigChange('advanceNotice', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value={0}>At service time</option>
                  <option value={1}>1 hour before</option>
                  <option value={2}>2 hours before</option>
                  <option value={4}>4 hours before</option>
                  <option value={24}>1 day before</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Test Notification */}
        {hasPermission && config.enabled && (
          <div className="pt-4">
            <Button
              variant="outline"
              onClick={handleTestNotification}
              className="w-full"
            >
              {testSent ? (
                <>
                  <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
                  Test Sent!
                </>
              ) : (
                <>
                  <Bell className="w-4 h-4 mr-2" />
                  Send Test Notification
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default NotificationSettings;
