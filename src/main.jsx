import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL;
const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

console.log("Initializing App...");
console.log("Convex URL:", CONVEX_URL);
console.log("Clerk Key:", CLERK_KEY ? "Present" : "Missing");

if (!CONVEX_URL || !CLERK_KEY) {
    const errorMsg = `Missing Environment Variables! 
  Convex URL: ${CONVEX_URL ? 'OK' : 'MISSING'}
  Clerk Key: ${CLERK_KEY ? 'OK' : 'MISSING'}`;

    document.body.innerHTML = `<div style="color: red; padding: 20px; font-family: sans-serif;">
    <h1>Startup Error</h1>
    <pre>${errorMsg}</pre>
    <p>Please check your .env.local file</p>
  </div>`;
    throw new Error(errorMsg);
}

const convex = new ConvexReactClient(CONVEX_URL);

try {
    createRoot(document.getElementById('root')).render(
        <StrictMode>
            <ErrorBoundary>
                <ClerkProvider publishableKey={CLERK_KEY}>
                    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
                        <App />
                    </ConvexProviderWithClerk>
                </ClerkProvider>
            </ErrorBoundary>
        </StrictMode>,
    )
} catch (e) {
    console.error("Render Error:", e);
    document.body.innerHTML = `<div style="color: red; padding: 20px;"><h1>Render Error</h1><pre>${e.message}</pre></div>`;
}