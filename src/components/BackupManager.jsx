import React, { useState, useRef } from 'react';
import { Download, Upload, Shield, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { downloadBackup, restoreFromBackup, autoBackup } from '@/lib/backup';

export function BackupManager({ onClose }) {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [exportOptions, setExportOptions] = useState({
    includeCustomers: true,
    includeServiceLogs: true,
    includeChemicalUsage: true,
    includeNotes: true,
    dateRange: null
  });
  const fileInputRef = useRef(null);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await downloadBackup(exportOptions);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed: ' + error.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      setIsImporting(true);
      try {
        const backupData = JSON.parse(e.target.result);
        const result = await restoreFromBackup(backupData, {
          clearExisting: false,
          mergeStrategy: 'replace'
        });
        setImportResult(result);
      } catch (error) {
        console.error('Import failed:', error);
        setImportResult({
          success: false,
          imported: { customers: 0, serviceLogs: 0, chemicalUsage: 0, notes: 0 },
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          warnings: [],
        });
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsText(file);
  };

  const lastBackup = autoBackup.getLastBackupTime();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-line">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[var(--status-info-soft)] rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-info" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">Data Backup</h2>
                <p className="text-sm text-ink-muted">Protect your pool service data</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-ink-muted hover:text-ink-secondary text-xl font-semibold"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Auto-backup Status */}
          <div className="bg-[var(--status-info-soft)] border border-[var(--status-info-line)] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-info" />
              <span className="text-sm font-medium text-info">Auto-Backup Status</span>
            </div>
            <p className="text-sm text-info">
              {lastBackup 
                ? `Last backup: ${new Date(lastBackup).toLocaleString()}`
                : 'No automatic backup yet'
              }
            </p>
            <p className="text-xs text-info mt-1">
              Automatic backups run every 24 hours and are stored locally for emergency recovery.
            </p>
          </div>

          {/* Export Section */}
          <div className="space-y-4">
            <h3 className="font-medium text-ink flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export Data
            </h3>
            
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={exportOptions.includeCustomers}
                    onChange={(e) => setExportOptions(prev => ({
                      ...prev,
                      includeCustomers: e.target.checked
                    }))}
                    className="rounded"
                  />
                  Customers
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={exportOptions.includeServiceLogs}
                    onChange={(e) => setExportOptions(prev => ({
                      ...prev,
                      includeServiceLogs: e.target.checked
                    }))}
                    className="rounded"
                  />
                  Service Logs
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={exportOptions.includeChemicalUsage}
                    onChange={(e) => setExportOptions(prev => ({
                      ...prev,
                      includeChemicalUsage: e.target.checked
                    }))}
                    className="rounded"
                  />
                  Chemical Usage
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={exportOptions.includeNotes}
                    onChange={(e) => setExportOptions(prev => ({
                      ...prev,
                      includeNotes: e.target.checked
                    }))}
                    className="rounded"
                  />
                  Notes
                </label>
              </div>

              <button
                onClick={handleExport}
                disabled={isExporting}
                className="w-full bg-brand text-white py-2 px-4 rounded-lg hover:bg-brand-strong disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isExporting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Download Backup
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Import Section */}
          <div className="space-y-4">
            <h3 className="font-medium text-ink flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Import Data
            </h3>
            
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
              />
              
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="w-full bg-surface-2 text-ink py-2 px-4 rounded-lg hover:bg-line disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isImporting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Select Backup File
                  </>
                )}
              </button>

              {importResult && (
                <div className={`p-3 rounded-lg border ${
                  importResult.success 
                    ? 'bg-[var(--status-ok-soft)] border-[var(--status-ok-line)]' 
                    : 'bg-[var(--status-critical-soft)] border-[var(--status-critical-line)]'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {importResult.success ? (
                      <CheckCircle className="w-4 h-4 text-ok" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-critical" />
                    )}
                    <span className={`text-sm font-medium ${
                      importResult.success ? 'text-ok' : 'text-critical'
                    }`}>
                      {importResult.success ? 'Import Successful' : 'Import Failed'}
                    </span>
                  </div>
                  
                  {importResult.success && (
                    <div className="text-sm text-ok space-y-1">
                      <p>Imported:</p>
                      <ul className="text-xs space-y-0.5 ml-4">
                        <li>• {importResult.imported.customers} customers</li>
                        <li>• {importResult.imported.serviceLogs} service logs</li>
                        <li>• {importResult.imported.chemicalUsage} chemical usage records</li>
                        <li>• {importResult.imported.notes} notes</li>
                        {importResult.warnings?.length > 0 && (
                          <li>• Includes {importResult.warnings.length} compatibility warning{importResult.warnings.length > 1 ? 's' : ''}</li>
                        )}
                      </ul>
                    </div>
                  )}
                  
                  {importResult.warnings?.length > 0 && (
                    <div className="text-sm text-watch mt-2">
                      <p>Warnings:</p>
                      <ul className="text-xs space-y-0.5 ml-4">
                        {importResult.warnings.slice(0, 3).map((warning, index) => (
                          <li key={index}>• {warning}</li>
                        ))}
                        {importResult.warnings.length > 3 && (
                          <li>• ... and {importResult.warnings.length - 3} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                  
                  {importResult.errors.length > 0 && (
                    <div className="text-sm text-critical mt-2">
                      <p>Errors:</p>
                      <ul className="text-xs space-y-0.5 ml-4">
                        {importResult.errors.slice(0, 3).map((error, index) => (
                          <li key={index}>• {error}</li>
                        ))}
                        {importResult.errors.length > 3 && (
                          <li>• ... and {importResult.errors.length - 3} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Warning */}
          <div className="bg-[var(--status-watch-soft)] border border-[var(--status-watch-line)] rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-watch mt-0.5 flex-shrink-0" />
              <div className="text-sm text-watch">
                <p className="font-medium mb-1">Important:</p>
                <ul className="text-xs space-y-1">
                  <li>• Importing will add to existing data (no overwrite)</li>
                  <li>• Always test imports with a backup copy first</li>
                  <li>• Keep regular backups in a safe location</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
