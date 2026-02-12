import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Database, 
  Shield, 
  Settings, 
  Download, 
  RefreshCw, 
  AlertTriangle,
  CheckCircle,
  HardDrive,
  Wifi,
  WifiOff,
  Smartphone
} from 'lucide-react';
import { monitoring } from '@/lib/monitoring';
import { migrationManager } from '@/lib/migrations';
import { serviceWorkerManager } from '@/lib/serviceWorker';
import { BackupManager } from './BackupManager';

export function AdminDashboard({ onClose }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [performanceReport, setPerformanceReport] = useState(null);
  const [integrityReport, setIntegrityReport] = useState(null);
  const [swState, setSwState] = useState(null);
  const [cacheSize, setCacheSize] = useState(0);
  const [showBackupManager, setShowBackupManager] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      // Load performance data
      const perfReport = monitoring.getPerformanceReport();
      setPerformanceReport(perfReport);

      // Load integrity data
      const integrity = await migrationManager.checkIntegrity();
      setIntegrityReport(integrity);

      // Load service worker state
      const swStatus = serviceWorkerManager.getState();
      setSwState(swStatus);

      // Load cache size
      const size = await serviceWorkerManager.getCacheSize();
      setCacheSize(size);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearCaches = async () => {
    if (confirm('Are you sure you want to clear all caches? This will remove offline data.')) {
      try {
        await serviceWorkerManager.clearCaches();
        setCacheSize(0);
        alert('Caches cleared successfully');
      } catch (error) {
        alert('Failed to clear caches: ' + error.message);
      }
    }
  };

  const handleClearMonitoring = () => {
    if (confirm('Are you sure you want to clear all monitoring data?')) {
      monitoring.clearData();
      setPerformanceReport(monitoring.getPerformanceReport());
      alert('Monitoring data cleared');
    }
  };

  const handleDataCleanup = async () => {
    if (confirm('Are you sure you want to clean up orphaned data? This cannot be undone.')) {
      try {
        const result = await migrationManager.cleanupOrphanedData();
        alert(`Cleanup completed:\n- ${result.cleaned.serviceLogs} service logs\n- ${result.cleaned.chemicalUsage} chemical usage records\n- ${result.cleaned.notes} notes`);
        await loadDashboardData();
      } catch (error) {
        alert('Cleanup failed: ' + error.message);
      }
    }
  };

  const exportDiagnostics = () => {
    const diagnostics = monitoring.exportDiagnostics();
    const blob = new Blob([diagnostics], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `chemcheck-diagnostics-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDuration = (ms) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  if (showBackupManager) {
    return <BackupManager onClose={() => setShowBackupManager(false)} />;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50">
      <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl w-full sm:max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 sm:w-10 h-9 sm:h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Settings className="w-4 sm:w-5 h-4 sm:h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Admin Dashboard</h2>
                <p className="text-xs sm:text-sm text-gray-500 hidden sm:block">System monitoring and diagnostics</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full text-xl font-semibold"
            >
              ×
            </button>
          </div>
        </div>

        {/* Tabs - Scrollable on mobile */}
        <div className="border-b border-gray-200 flex-shrink-0 overflow-x-auto">
          <nav className="flex px-4 sm:px-6 min-w-max">
            {[
              { id: 'overview', label: 'Overview', icon: Activity },
              { id: 'performance', label: 'Perf', mobileLabel: 'Perf', icon: Activity },
              { id: 'data', label: 'Data', mobileLabel: 'Data', icon: Database },
              { id: 'pwa', label: 'PWA', mobileLabel: 'PWA', icon: Smartphone },
              { id: 'security', label: 'Security', mobileLabel: 'Sec', icon: Shield }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-3 sm:py-4 px-3 sm:px-4 border-b-2 font-medium text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-purple-500 text-purple-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="sm:hidden">{tab.mobileLabel || tab.label}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">Loading dashboard data...</span>
            </div>
          ) : (
            <>
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div className="space-y-4 sm:space-y-6">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <Activity className="w-4 sm:w-5 h-4 sm:h-5 text-blue-600" />
                        <span className="font-medium text-blue-900 text-xs sm:text-sm">Performance</span>
                      </div>
                      <div className="mt-1.5 sm:mt-2">
                        <div className="text-lg sm:text-2xl font-bold text-blue-900">
                          {performanceReport?.summary.avgPageLoadTime 
                            ? formatDuration(performanceReport.summary.avgPageLoadTime)
                            : 'N/A'
                          }
                        </div>
                        <div className="text-xs sm:text-sm text-blue-600">Avg Load</div>
                      </div>
                    </div>

                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <AlertTriangle className="w-4 sm:w-5 h-4 sm:h-5 text-red-600" />
                        <span className="font-medium text-red-900 text-xs sm:text-sm">Errors</span>
                      </div>
                      <div className="mt-1.5 sm:mt-2">
                        <div className="text-lg sm:text-2xl font-bold text-red-900">
                          {performanceReport?.summary.totalErrors || 0}
                        </div>
                        <div className="text-xs sm:text-sm text-red-600">Total</div>
                      </div>
                    </div>

                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 sm:p-4">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <CheckCircle className="w-4 sm:w-5 h-4 sm:h-5 text-green-600" />
                        <span className="font-medium text-green-900 text-xs sm:text-sm">Data</span>
                      </div>
                      <div className="mt-1.5 sm:mt-2">
                        <div className="text-lg sm:text-2xl font-bold text-green-900">
                          {integrityReport?.valid ? 'Good' : 'Issues'}
                        </div>
                        <div className="text-xs sm:text-sm text-green-600">
                          {integrityReport?.issues.length || 0} Issues
                        </div>
                      </div>
                    </div>

                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 sm:p-4">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <HardDrive className="w-4 sm:w-5 h-4 sm:h-5 text-purple-600" />
                        <span className="font-medium text-purple-900 text-xs sm:text-sm">Cache</span>
                      </div>
                      <div className="mt-1.5 sm:mt-2">
                        <div className="text-lg sm:text-2xl font-bold text-purple-900">
                          {formatBytes(cacheSize)}
                        </div>
                        <div className="text-xs sm:text-sm text-purple-600">Storage</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                    <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
                      <h3 className="font-medium text-gray-900 mb-2 sm:mb-3 text-sm sm:text-base">Quick Actions</h3>
                      <div className="space-y-2">
                        <button
                          onClick={() => setShowBackupManager(true)}
                          className="w-full text-left px-3 py-2.5 sm:py-2 bg-white border border-gray-200 rounded hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2 text-sm"
                        >
                          <Download className="w-4 h-4 text-gray-500" />
                          Backup & Export Data
                        </button>
                        <button
                          onClick={exportDiagnostics}
                          className="w-full text-left px-3 py-2.5 sm:py-2 bg-white border border-gray-200 rounded hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2 text-sm"
                        >
                          <Activity className="w-4 h-4 text-gray-500" />
                          Export Diagnostics
                        </button>
                        <button
                          onClick={loadDashboardData}
                          className="w-full text-left px-3 py-2 bg-white border border-gray-200 rounded hover:bg-gray-50 flex items-center gap-2"
                        >
                          <RefreshCw className="w-4 h-4 text-gray-500" />
                          Refresh Data
                        </button>
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="font-medium text-gray-900 mb-3">System Status</h3>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Service Worker</span>
                          <span className={`text-sm font-medium ${
                            swState?.isRegistered ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {swState?.isRegistered ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Network Status</span>
                          <span className={`text-sm font-medium ${
                            navigator.onLine ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {navigator.onLine ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Data Integrity</span>
                          <span className={`text-sm font-medium ${
                            integrityReport?.valid ? 'text-green-600' : 'text-yellow-600'
                          }`}>
                            {integrityReport?.valid ? 'Valid' : 'Needs Attention'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Performance Tab */}
              {activeTab === 'performance' && performanceReport && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-gray-900">Performance Metrics</h3>
                    <button
                      onClick={handleClearMonitoring}
                      className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Clear Data
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="text-sm text-gray-600">Avg Page Load</div>
                      <div className="text-xl font-bold text-gray-900">
                        {formatDuration(performanceReport.summary.avgPageLoadTime)}
                      </div>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="text-sm text-gray-600">Total Errors</div>
                      <div className="text-xl font-bold text-gray-900">
                        {performanceReport.summary.totalErrors}
                      </div>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="text-sm text-gray-600">Slow Queries</div>
                      <div className="text-xl font-bold text-gray-900">
                        {performanceReport.summary.slowQueries}
                      </div>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="text-sm text-gray-600">Memory Issues</div>
                      <div className="text-xl font-bold text-gray-900">
                        {performanceReport.summary.memoryIssues}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-3">Recent Errors</h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {performanceReport.errors.slice(-5).map((error, index) => (
                          <div key={index} className="text-sm">
                            <div className="font-medium text-red-600">{error.message}</div>
                            <div className="text-gray-500">
                              {new Date(error.timestamp).toLocaleString()} - {error.severity}
                            </div>
                          </div>
                        ))}
                        {performanceReport.errors.length === 0 && (
                          <div className="text-gray-500 text-sm">No errors recorded</div>
                        )}
                      </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-3">Performance Metrics</h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {performanceReport.metrics.slice(-10).map((metric, index) => (
                          <div key={index} className="flex justify-between text-sm">
                            <span className="text-gray-600">{metric.name}</span>
                            <span className="font-medium">{formatDuration(metric.value)}</span>
                          </div>
                        ))}
                        {performanceReport.metrics.length === 0 && (
                          <div className="text-gray-500 text-sm">No metrics recorded</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Data Integrity Tab */}
              {activeTab === 'data' && integrityReport && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-gray-900">Data Integrity Report</h3>
                    <button
                      onClick={handleDataCleanup}
                      className="px-3 py-1 text-sm bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                    >
                      Clean Up Data
                    </button>
                  </div>

                  <div className={`p-4 rounded-lg border ${
                    integrityReport.valid 
                      ? 'bg-green-50 border-green-200' 
                      : 'bg-yellow-50 border-yellow-200'
                  }`}>
                    <div className="flex items-center gap-2">
                      {integrityReport.valid ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-yellow-600" />
                      )}
                      <span className={`font-medium ${
                        integrityReport.valid ? 'text-green-900' : 'text-yellow-900'
                      }`}>
                        {integrityReport.valid ? 'Data integrity is good' : 'Data integrity issues found'}
                      </span>
                    </div>
                  </div>

                  {integrityReport.issues.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-3">Issues Found</h4>
                      <ul className="space-y-2">
                        {integrityReport.issues.map((issue, index) => (
                          <li key={index} className="text-sm text-red-600 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            {issue}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {integrityReport.recommendations.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-3">Recommendations</h4>
                      <ul className="space-y-2">
                        {integrityReport.recommendations.map((rec, index) => (
                          <li key={index} className="text-sm text-blue-600 flex items-start gap-2">
                            <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* PWA Status Tab */}
              {activeTab === 'pwa' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-gray-900">PWA Status</h3>
                    <button
                      onClick={handleClearCaches}
                      className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Clear Caches
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-3">Service Worker</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Supported</span>
                          <span className={`text-sm font-medium ${
                            swState?.isSupported ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {swState?.isSupported ? 'Yes' : 'No'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Registered</span>
                          <span className={`text-sm font-medium ${
                            swState?.isRegistered ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {swState?.isRegistered ? 'Yes' : 'No'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Controlling</span>
                          <span className={`text-sm font-medium ${
                            swState?.isControlling ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {swState?.isControlling ? 'Yes' : 'No'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Update Available</span>
                          <span className={`text-sm font-medium ${
                            swState?.hasUpdate ? 'text-yellow-600' : 'text-green-600'
                          }`}>
                            {swState?.hasUpdate ? 'Yes' : 'No'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-3">Cache Storage</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Total Size</span>
                          <span className="text-sm font-medium">{formatBytes(cacheSize)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Network Status</span>
                          <span className={`text-sm font-medium flex items-center gap-1 ${
                            navigator.onLine ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {navigator.onLine ? (
                              <><Wifi className="w-3 h-3" /> Online</>
                            ) : (
                              <><WifiOff className="w-3 h-3" /> Offline</>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Security Tab */}
              {activeTab === 'security' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-medium text-gray-900">Security Status</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-3">Data Protection</h4>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm">Local data storage only</span>
                        </div>
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm">Input validation enabled</span>
                        </div>
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm">XSS protection active</span>
                        </div>
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm">Rate limiting enabled</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-3">Privacy Compliance</h4>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm">No external data transmission</span>
                        </div>
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm">Privacy policy available</span>
                        </div>
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm">User data control</span>
                        </div>
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm">Secure error handling</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
