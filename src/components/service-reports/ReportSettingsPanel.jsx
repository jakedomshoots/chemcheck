/**
 * Report Settings Panel Component
 * 
 * Allows customization of what information is shown on customer reports.
 * Settings are stored per customer and applied to all their reports.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Settings, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const DEFAULT_SETTINGS = {
  show_chemical_readings: true,
  show_photos: true,
  show_service_notes: true,
  show_technician_name: true,
  show_service_duration: true,
  show_overall_status: true,
};

const SETTING_DESCRIPTIONS = {
  show_overall_status: {
    label: 'Overall Pool Status',
    description: 'Show "All Good" or "Needs Attention" badge',
  },
  show_chemical_readings: {
    label: 'Chemical Readings',
    description: 'Show pH, Chlorine, Alkalinity, Stabilizer, and Salt levels',
  },
  show_photos: {
    label: 'Before/After Photos',
    description: 'Show photos taken during the service',
  },
  show_service_notes: {
    label: 'Service Notes',
    description: 'Show technician notes and observations',
  },
  show_technician_name: {
    label: 'Technician Name',
    description: 'Show who performed the service',
  },
  show_service_duration: {
    label: 'Service Duration',
    description: 'Show how long the service took',
  },
};

export function ReportSettingsPanel({
  isOpen,
  onClose,
  onSave,
  currentSettings,
  customerName,
  isLoading = false,
  error,
}) {
  const [settings, setSettings] = useState(
    currentSettings || DEFAULT_SETTINGS
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (currentSettings) {
      setSettings(currentSettings);
    }
  }, [currentSettings]);

  const handleToggle = (key) => {
    setSettings(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await onSave(settings);
      setSaveSuccess(true);
      // Let users close the dialog manually when they're ready
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (!isSaving) {
      setSaveSuccess(false);
      setSaveError(null);
      onClose();
    }
  };

  const allEnabled = Object.values(settings).every(v => v === true);
  const allDisabled = Object.values(settings).every(v => v === false);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-[90%] sm:max-w-md rounded-xl bg-white border-slate-200">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2 text-slate-900">
            <Settings className="w-4 h-4 text-cyan-600" />
            Report Settings
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            Customize what {customerName} sees on their service reports
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
          {/* Info Alert */}
          <Alert className="py-2 bg-blue-50 border-blue-200">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-xs text-blue-700">
              These settings apply to all reports sent to this customer.
            </AlertDescription>
          </Alert>

          {/* Settings Checkboxes */}
          <div className="space-y-3">
            {Object.entries(SETTING_DESCRIPTIONS).map(([key, { label, description }]) => (
              <div
                key={key}
                className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors"
              >
                <div className="flex items-center h-5 mt-0.5">
                  <input
                    type="checkbox"
                    id={`setting-${key}`}
                    checked={settings[key]}
                    onChange={() => handleToggle(key)}
                    className="w-4 h-4 rounded border-slate-300 text-cyan-600 cursor-pointer focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2"
                    data-testid={`setting-${key}`}
                    aria-describedby={`setting-${key}-description`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label 
                    htmlFor={`setting-${key}`}
                    className="text-sm font-medium text-slate-900 cursor-pointer block"
                  >
                    {label}
                  </label>
                  <p 
                    id={`setting-${key}-description`}
                    className="text-xs text-slate-500 mt-0.5"
                  >
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSettings(DEFAULT_SETTINGS)}
              className="flex-1 text-xs"
              disabled={isSaving}
            >
              Reset to Default
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSettings({
                  ...DEFAULT_SETTINGS
                })
              }
              className="flex-1 text-xs"
              disabled={allEnabled || isSaving}
            >
              Show All
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSettings({
                  show_chemical_readings: false,
                  show_photos: false,
                  show_service_notes: false,
                  show_technician_name: false,
                  show_service_duration: false,
                  show_overall_status: false,
                })
              }
              className="flex-1 text-xs"
              disabled={allDisabled || isSaving}
            >
              Hide All
            </Button>
          </div>

          {/* Error Display */}
          {(error || saveError) && (
            <Alert variant="destructive" className="py-2 bg-red-50 border-red-200">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-xs text-red-700">
                {error || saveError}
              </AlertDescription>
            </Alert>
          )}

          {/* Success Display */}
          {saveSuccess && (
            <Alert className="py-2 bg-green-50 border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-xs text-green-700">
                Settings saved successfully!
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 bg-white">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSaving}
            className="text-sm bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white text-sm"
            data-testid="save-settings-button"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                Save Settings
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReportSettingsPanel;
