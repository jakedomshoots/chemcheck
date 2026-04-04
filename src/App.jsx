import { useEffect, lazy, Suspense } from 'react'
import './App.css'
import Pages from "@/pages/index.jsx"
import { Toaster } from "@/components/ui/toaster"

const UpdateNotification = lazy(() =>
  import('@/components/UpdateNotification').then((mod) => ({ default: mod.UpdateNotification }))
);

function App() {
  useEffect(() => {
    let unmounted = false;
    let teardown = () => {};

    const initializeApp = async () => {
      try {
        const [
          backupMod,
          monitoringMod,
          migrationMod,
          serviceWorkerMod,
        ] = await Promise.all([
          import('@/lib/backup'),
          import('@/lib/monitoring'),
          import('@/lib/migrations'),
          import('@/lib/serviceWorker'),
        ]);

        if (unmounted) return;

        const { autoBackup } = backupMod;
        const { monitoring } = monitoringMod;
        const { initializeMigrations } = migrationMod;
        const { registerServiceWorker, cleanupServiceWorker } = serviceWorkerMod;

        const getAutoBackupPreference = () => {
          try {
            const rawCurrentUser = localStorage.getItem('chemcheck_current_user');
            if (!rawCurrentUser) return true;
            const parsedUser = JSON.parse(rawCurrentUser);
            return parsedUser?.preferences?.autoBackup ?? true;
          } catch {
            return true;
          }
        };

        const syncAutoBackupState = () => {
          const shouldAutoBackup = getAutoBackupPreference();
          if (shouldAutoBackup) {
            autoBackup.start();
          } else {
            autoBackup.stop();
          }
        };

        const handleBackupRequest = () => {
          console.log('Service worker requested backup');
          syncAutoBackupState();
        };

        // Run database migrations first
        await initializeMigrations();
        if (unmounted) return;
        
        // Register service worker for PWA functionality
        await registerServiceWorker();
        if (unmounted) return;
        
        // Start auto-backup system based on saved user preference
        syncAutoBackupState();
        
        // Set up backup trigger from service worker
        window.addEventListener('sw-backup-request', handleBackupRequest);
        
        // Log app initialization
        monitoring.recordMetric('app_initialized', performance.now());
        
        console.log('ChemCheck initialized successfully');

        teardown = () => {
          window.removeEventListener('sw-backup-request', handleBackupRequest);
          autoBackup.stop();
          cleanupServiceWorker();
        };
      } catch (error) {
        console.error('App initialization failed:', error);
        try {
          const { monitoring } = await import('@/lib/monitoring');
          monitoring.reportError({
            message: 'App initialization failed',
            severity: 'critical',
            metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
          });
        } catch (monitoringError) {
          console.error('Failed to report initialization error:', monitoringError);
        }
      }
    };

    initializeApp();
    
    // Cleanup on unmount
    return () => {
      unmounted = true;
      teardown();
    };
  }, []);

  return (
    <>
      <Pages />
      <Toaster />
      <Suspense fallback={null}>
        <UpdateNotification />
      </Suspense>
    </>
  )
}

export default App
