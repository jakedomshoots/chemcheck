import { lazy, Suspense } from 'react';
import Layout from "./Layout.jsx";
import { Route, Routes, useLocation } from 'react-router-dom';
import { RobustAuthGuard } from '@/components/auth/RobustAuthGuard';
import { RobustLoginPage } from '@/components/auth/RobustLoginPage';
import { RobustSignUpPage } from '@/components/auth/RobustSignUpPage';
import { SetupWizardPage } from '@/components/auth/SetupWizardPage';
import { SSOCallback } from '@/components/auth/SSOCallback';
import { ChemicalBeakerLoader as Loader } from '@/components/ui/loader';
import { importWithRetry } from '@/lib/chunkErrorRecovery';

// Lazy load all page components for code splitting with error recovery
const Home = lazy(() => importWithRetry(() => import('./Home'), 'Home'));
const Clients = lazy(() => importWithRetry(() => import('./Clients'), 'Clients'));
const NewClient = lazy(() => importWithRetry(() => import('./NewClient'), 'NewClient'));
const NewServiceLog = lazy(() => importWithRetry(() => import('./NewServiceLog'), 'NewServiceLog'));
const CustomerDetail = lazy(() => importWithRetry(() => import('./CustomerDetail'), 'CustomerDetail'));
const History = lazy(() => importWithRetry(() => import('./History'), 'History'));
const WeeklyReport = lazy(() => importWithRetry(() => import('./WeeklyReport'), 'WeeklyReport'));
const RouteOptimizer = lazy(() => importWithRetry(() => import('./RouteOptimizer'), 'RouteOptimizer'));
const EditClient = lazy(() => importWithRetry(() => import('./EditClient'), 'EditClient'));
const ChemicalUsage = lazy(() => importWithRetry(() => import('./ChemicalUsage'), 'ChemicalUsage'));
const NewChemicalUsage = lazy(() => importWithRetry(() => import('./NewChemicalUsage'), 'NewChemicalUsage'));
const Notes = lazy(() => importWithRetry(() => import('./Notes'), 'Notes'));
const Settings = lazy(() => importWithRetry(() => import('./Settings'), 'Settings'));
const PoolSchool = lazy(() => importWithRetry(() => import('./PoolSchool'), 'PoolSchool'));

// Lazy load billing components (less frequently accessed)
const PricingPage = lazy(() => importWithRetry(() => import('@/components/billing/PricingPage').then(m => ({ default: m.PricingPage })), 'PricingPage'));
const BillingDashboard = lazy(() => importWithRetry(() => import('@/components/billing/BillingDashboard').then(m => ({ default: m.BillingDashboard })), 'BillingDashboard'));

// Lazy load public report page (no auth required)
const ReportPage = lazy(() => importWithRetry(() => import('./ReportPage'), 'ReportPage'));

// Loading fallback component
function PageLoader() {
    return (
        <div className="flex items-center justify-center min-h-screen">
            <Loader className="w-12 h-12" />
        </div>
    );
}

const PAGES = {
    Home,
    Clients,
    NewClient,
    NewServiceLog,
    CustomerDetail,
    History,
    WeeklyReport,
    RouteOptimizer,
    EditClient,
    ChemicalUsage,
    NewChemicalUsage,
    Notes,
    Settings,
    PoolSchool,
};

function _getCurrentPage(url) {
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    let urlLastPart = url.split('/').pop();
    if (urlLastPart.includes('?')) {
        urlLastPart = urlLastPart.split('?')[0];
    }

    const pageName = Object.keys(PAGES).find(page => page.toLowerCase() === urlLastPart.toLowerCase());
    return pageName || Object.keys(PAGES)[0];
}

// Protected routes wrapper
function ProtectedRoutes() {
    const location = useLocation();
    const currentPage = _getCurrentPage(location.pathname);
    
    return (
        <Layout currentPageName={currentPage}>
            <Suspense fallback={<PageLoader />}>
                <Routes>            
                    <Route path="/" element={<Home />} />
                    <Route path="/Home" element={<Home />} />
                    <Route path="/Clients" element={<Clients />} />
                    <Route path="/NewClient" element={<NewClient />} />
                    <Route path="/NewServiceLog" element={<NewServiceLog />} />
                    <Route path="/CustomerDetail" element={<CustomerDetail />} />
                    <Route path="/History" element={<History />} />
                    <Route path="/WeeklyReport" element={<WeeklyReport />} />
                    <Route path="/RouteOptimizer" element={<RouteOptimizer />} />
                    <Route path="/EditClient" element={<EditClient />} />
                    <Route path="/ChemicalUsage" element={<ChemicalUsage />} />
                    <Route path="/NewChemicalUsage" element={<NewChemicalUsage />} />
                    <Route path="/Notes" element={<Notes />} />
                    <Route path="/Settings" element={<Settings />} />
                    <Route path="/PoolSchool" element={<PoolSchool />} />
                    <Route path="/Billing" element={<BillingDashboard />} />
                </Routes>
            </Suspense>
        </Layout>
    );
}

// Setup page wrapper
function SetupPage() {
    return (
        <Suspense fallback={<PageLoader />}>
            <SetupWizardPage />
        </Suspense>
    );
}

export default function Pages() {
    return (
        <RobustAuthGuard>
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    {/* Public auth routes */}
                    <Route path="/login" element={<RobustLoginPage />} />
                    <Route path="/login/*" element={<RobustLoginPage />} />
                    <Route path="/signup" element={<RobustSignUpPage />} />
                    <Route path="/signup/*" element={<RobustSignUpPage />} />
                    
                    {/* SSO callback route for OAuth providers (Google, etc.) */}
                    <Route path="/sso-callback" element={<SSOCallback />} />
                    
                    {/* Public pricing page */}
                    <Route path="/pricing" element={<PricingPage />} />
                    
                    {/* Public report page - Requirements: 3.1 (no auth required) */}
                    <Route path="/report/:reportId" element={<ReportPage />} />
                    
                    {/* Setup wizard for new users */}
                    <Route path="/setup" element={<SetupPage />} />
                    
                    {/* Protected app routes */}
                    <Route path="/*" element={<ProtectedRoutes />} />
                </Routes>
            </Suspense>
        </RobustAuthGuard>
    );
}