import { useEffect, lazy, Suspense } from 'react'
import './App.css'
import Pages from "@/pages/index.jsx"
import { Toaster } from "@/components/ui/toaster"

const UpdateNotification = lazy(() =>
  import('@/components/UpdateNotification').then((mod) => ({ default: mod.UpdateNotification }))
);

function App() {
  useEffect(() => {
    // Hide the native splash screen once the web app is ready.
    // This is a no-op when running in a browser.
    const hideSplash = async () => {
      try {
        const { SplashScreen } = await import('@capacitor/splash-screen');
        await SplashScreen.hide({ fadeOutDuration: 500 });
      } catch {
        // Not running in a Capacitor native shell.
      }
    };
    void hideSplash();
  }, []);

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

        await initializeMigrations();
        if (unmounted) return;

        await registerServiceWorker();
        if (unmounted) return;

        syncAutoBackupState();

        window.addEventListener('sw-backup-request', handleBackupRequest);

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
