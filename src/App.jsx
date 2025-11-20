import './App.css'
import Pages from "@/pages/index.jsx"
import { Toaster } from "@/components/ui/toaster"
import { Authenticated, Unauthenticated, AuthLoading, useConvexAuth } from "convex/react";
import { SignIn, useAuth as useClerkAuth } from "@clerk/clerk-react";

function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn } = useClerkAuth();

  return (
    <>
      <AuthLoading>
        <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-slate-500">Connecting to Convex...</p>
        </div>
      </AuthLoading>

      <Unauthenticated>
        <div className="flex items-center justify-center min-h-screen bg-slate-50">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-slate-900">Pool Chemical Log</h1>
              <p className="text-slate-600 mt-2">Sign in to manage your pool service business</p>
            </div>
            <div className="flex justify-center">
              <SignIn />
            </div>
          </div>
        </div>
      </Unauthenticated>

      <Authenticated>
        <Pages />
        <Toaster />
      </Authenticated>
    </>
  )
}

export default App 