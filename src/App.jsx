import { useEffect } from 'react'
import './App.css'
import Pages from "@/pages/index.jsx"
import { Toaster } from "@/components/ui/toaster"
import { UpdateNotification } from "@/components/UpdateNotification"
import { autoBackup } from "@/lib/backup"
import { monitoring } from "@/lib/monitoring"
import { initializeMigrations } from "@/lib/migrations"
import { registerServiceWorker } from "@/lib/serviceWorker"

function App() {
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Run database migrations first
        await initializeMigrations();
        
        // Register service worker for PWA functionality
        if (import.meta.env.PROD) {
          await registerServiceWorker();
        }
        
        // Start auto-backup system
        autoBackup.start();
        
        // Set up backup trigger from service worker
        window.addEventListener('sw-backup-request', () => {
          console.log('Service worker requested backup');
          autoBackup.start();
        });
        
        // Log app initialization
        monitoring.recordMetric('app_initialized', performance.now());
        
        console.log('ChemCheck initialized successfully');
      } catch (error) {
        console.error('App initialization failed:', error);
        monitoring.reportError({
          message: 'App initialization failed',
          severity: 'critical',
          metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
        });
      }
    };

    initializeApp();
    
    // Cleanup on unmount
    return () => {
      autoBackup.stop();
    };
  }, []);

  return (
    <>
      <Pages />
      <Toaster />
      <UpdateNotification />
    </>
  )
}

export default App
