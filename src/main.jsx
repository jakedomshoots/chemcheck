import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { initSentry, reportError } from '@/lib/sentry';
import { ChemicalBeakerLoader as Loader } from '@/components/ui/loader';
import { importWithRetry } from '@/lib/chunkErrorRecovery';
import { initializeCacheLifecycle } from '@/api/dexieHooks';

const AppRouterShell = lazy(() =>
    importWithRetry(() => import('@/components/routing/AppRouterShell.jsx'), 'AppRouterShell')
);

function RootLoader() {
    return (
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-slate-100">
            <Loader className="w-12 h-12" />
        </div>
    );
}

console.log("Initializing ChemCheck...");

// Initialize Sentry for error tracking and performance monitoring
initSentry();
initializeCacheLifecycle();

// Initialize Google Analytics after first paint/idle time to keep startup lean.
function scheduleAnalyticsInitialization() {
    const initialize = async () => {
        try {
            const { initAnalytics } = await import('@/lib/analytics');
            initAnalytics();
        } catch (error) {
            console.warn('Analytics initialization skipped:', error);
        }
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(() => {
            void initialize();
        }, { timeout: 3000 });
        return;
    }

    setTimeout(() => {
        void initialize();
    }, 0);
}

scheduleAnalyticsInitialization();

async function initializeApp() {
    try {
        createRoot(document.getElementById('root')).render(
            <StrictMode>
                <ErrorBoundary>
                    <Suspense fallback={<RootLoader />}>
                        <AppRouterShell />
                    </Suspense>
                </ErrorBoundary>
            </StrictMode>,
        )
    } catch (e) {
        const errorId = `INIT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Secure error logging
        const isDev = import.meta.env.DEV;
        if (isDev) {
            console.error(`[${errorId}] Render Error:`, e);
        } else {
            console.error(`[${errorId}] Application initialization failed`);
        }

        // Send to Sentry
        try {
            reportError(e, { errorId, context: 'app_initialization' });
        } catch (sentryError) {
            console.error('Failed to report error to Sentry:', sentryError);
        }

        // Safe error display
        document.body.innerHTML = `
        <div style="
            min-height: 100vh; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
        ">
            <div style="
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 400px;
                width: 100%;
            ">
                <div style="
                    width: 60px;
                    height: 60px;
                    background: #fee2e2;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 20px;
                    font-size: 24px;
                ">⚠️</div>
                
                <h1 style="
                    color: #dc2626;
                    margin: 0 0 10px;
                    font-size: 24px;
                    font-weight: 600;
                ">ChemCheck Failed to Load</h1>
                
                <p style="
                    color: #6b7280;
                    margin: 0 0 20px;
                    line-height: 1.5;
                ">We're sorry, but the application failed to initialize. Please try refreshing the page.</p>
                
                <p style="
                    color: #9ca3af;
                    font-size: 12px;
                    font-family: monospace;
                    margin: 0 0 20px;
                    background: #f9fafb;
                    padding: 8px;
                    border-radius: 4px;
                ">Error ID: ${errorId}</p>
                
                <button onclick="window.location.reload()" style="
                    background: #3b82f6;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background-color 0.2s;
                " onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
                    Reload Application
                </button>
                
                ${isDev ? `
                    <details style="margin-top: 20px; text-align: left;">
                        <summary style="cursor: pointer; color: #6b7280; font-size: 12px;">
                            Developer Info (Dev Mode Only)
                        </summary>
                        <pre style="
                            background: #f3f4f6;
                            padding: 12px;
                            border-radius: 4px;
                            overflow: auto;
                            font-size: 11px;
                            margin-top: 8px;
                            max-height: 200px;
                        ">${e.stack || e.message}</pre>
                    </details>
                ` : ''}
            </div>
        </div>
    `;
    }
}

// Initialize the app
initializeApp();
