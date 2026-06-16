import { useState, useEffect } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { serviceWorkerManager, applyUpdate } from '@/lib/serviceWorker';
import { toast } from 'sonner';

export function UpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    // Listen for service worker updates
    const handleUpdate = (event) => {
      if (event.type === 'update-available') {
        setUpdateAvailable(true);
      }
    };

    serviceWorkerManager.addEventListener(handleUpdate);

    return () => {
      serviceWorkerManager.removeEventListener(handleUpdate);
    };
  }, []);

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      await applyUpdate();
      // The page will reload automatically after update
    } catch (error) {
      console.error('Update failed:', error);
      setIsUpdating(false);
      toast.error('Update failed. Please refresh manually.');
    }
  };

  const dismissUpdate = () => {
    setUpdateAvailable(false);
  };

  return (
    <>
      {/* Update Available Notification */}
      {updateAvailable && (
        <div className="fixed top-4 right-4 z-50 max-w-sm pt-[calc(1rem+env(safe-area-inset-top))]">
          <div className="bg-blue-600 text-white rounded-lg shadow-lg p-4 border border-blue-500">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                <Download className="w-4 h-4" />
              </div>
              
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm">Update Available</h3>
                <p className="text-blue-100 text-xs mt-1">
                  A new version of ChemCheck is ready to install with improvements and bug fixes.
                </p>
                
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={handleUpdate}
                    disabled={isUpdating}
                    className="bg-white text-blue-600 px-3 py-1.5 rounded text-xs font-medium hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {isUpdating ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <Download className="w-3 h-3" />
                        Update Now
                      </>
                    )}
                  </button>
                  
                  <button
                    onClick={dismissUpdate}
                    className="text-blue-100 hover:text-white text-xs px-2 py-1.5"
                  >
                    Later
                  </button>
                </div>
              </div>
              
              <button
                onClick={dismissUpdate}
                className="text-blue-200 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Hook for using update notifications in components
export function useUpdateNotification() {
  const [state, setState] = useState({
    updateAvailable: false,
    isOnline: navigator.onLine,
    swState: serviceWorkerManager.getState()
  });

  useEffect(() => {
    const handleUpdate = (event) => {
      setState(prev => ({
        ...prev,
        updateAvailable: event.type === 'update-available',
        swState: serviceWorkerManager.getState()
      }));
    };

    const handleOnline = () => {
      setState(prev => ({ ...prev, isOnline: true }));
    };

    const handleOffline = () => {
      setState(prev => ({ ...prev, isOnline: false }));
    };

    serviceWorkerManager.addEventListener(handleUpdate);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      serviceWorkerManager.removeEventListener(handleUpdate);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const triggerUpdate = async () => {
    try {
      await applyUpdate();
    } catch (error) {
      console.error('Manual update failed:', error);
      throw error;
    }
  };

  const checkForUpdates = async () => {
    try {
      await serviceWorkerManager.checkForUpdates();
    } catch (error) {
      console.error('Update check failed:', error);
      throw error;
    }
  };

  return {
    ...state,
    triggerUpdate,
    checkForUpdates
  };
}
