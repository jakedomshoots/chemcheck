import { lazy, Suspense } from 'react';
import Layout from './Layout.jsx';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ChemicalBeakerLoader as Loader } from '@/components/ui/loader';
import { importWithRetry } from '@/lib/chunkErrorRecovery';
import { getDefaultWorkOrdersSectionFromStorage } from '@/lib/workOrdersNavigation';
import { useAuthContext } from '@/components/auth/ClerkAuthProvider';
import { useSyncInitialization } from '@/hooks/useSyncInitialization';

const Home = lazy(() => importWithRetry(() => import('./Home'), 'Home'));
const Clients = lazy(() => importWithRetry(() => import('./Clients'), 'Clients'));
const NewClient = lazy(() => importWithRetry(() => import('./NewClient'), 'NewClient'));
const NewServiceLog = lazy(() => importWithRetry(() => import('./NewServiceLog'), 'NewServiceLog'));
const CustomerDetail = lazy(() => importWithRetry(() => import('./CustomerDetail'), 'CustomerDetail'));
const WeeklyReport = lazy(() => importWithRetry(() => import('./WeeklyReport'), 'WeeklyReport'));
const RouteOptimizer = lazy(() => importWithRetry(() => import('./RouteOptimizer'), 'RouteOptimizer'));
const EditClient = lazy(() => importWithRetry(() => import('./EditClient'), 'EditClient'));
const ChemicalUsage = lazy(() => importWithRetry(() => import('./ChemicalUsage'), 'ChemicalUsage'));
const NewChemicalUsage = lazy(() => importWithRetry(() => import('./NewChemicalUsage'), 'NewChemicalUsage'));
const Notes = lazy(() => importWithRetry(() => import('./Notes'), 'Notes'));
const Settings = lazy(() => importWithRetry(() => import('./Settings'), 'Settings'));
const PoolSchool = lazy(() => importWithRetry(() => import('./PoolSchool'), 'PoolSchool'));
const WorkOrders = lazy(() => importWithRetry(() => import('./WorkOrders'), 'WorkOrders'));
const BillingDashboard = lazy(() =>
  importWithRetry(
    () => import('@/components/billing/BillingDashboard').then((m) => ({ default: m.BillingDashboard })),
    'BillingDashboard'
  )
);

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader className="w-12 h-12" />
    </div>
  );
}

function LegacyInvoicePayRedirect() {
  const { invoiceId } = useParams();
  const encodedId = invoiceId ? encodeURIComponent(invoiceId) : "";
  return <Navigate to={`/workorders/invoices${encodedId ? `?invoice_id=${encodedId}` : ""}`} replace />;
}

function WorkOrdersRootRedirect() {
  const defaultSection = getDefaultWorkOrdersSectionFromStorage();
  return <Navigate to={`/workorders/${defaultSection}`} replace />;
}

const PAGES = {
  Home,
  Clients,
  NewClient,
  NewServiceLog,
  CustomerDetail,
  WeeklyReport,
  RouteOptimizer,
  EditClient,
  ChemicalUsage,
  NewChemicalUsage,
  Notes,
  Settings,
  PoolSchool,
  WorkOrders,
};

function getCurrentPage(url) {
  const normalized = url.toLowerCase();
  if (normalized.startsWith('/workorders')) return 'WorkOrders';
  if (normalized.startsWith('/routeoptimizer')) return 'RouteOptimizer';

  let normalizedUrl = url;
  if (normalizedUrl.endsWith('/')) {
    normalizedUrl = normalizedUrl.slice(0, -1);
  }

  let urlLastPart = normalizedUrl.split('/').pop() || '';
  if (urlLastPart.includes('?')) {
    urlLastPart = urlLastPart.split('?')[0];
  }

  const pageName = Object.keys(PAGES).find((page) => page.toLowerCase() === urlLastPart.toLowerCase());
  return pageName || Object.keys(PAGES)[0];
}

export default function ProtectedAppRoutes() {
  const location = useLocation();
  const auth = useAuthContext();
  const currentPage = getCurrentPage(location.pathname);
  useSyncInitialization(Boolean(auth?.isSignedIn));

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
          <Route path="/History" element={<Navigate to="/clients" replace />} />
          <Route path="/history" element={<Navigate to="/clients" replace />} />
          <Route path="/WeeklyReport" element={<WeeklyReport />} />
          <Route path="/RouteOptimizer" element={<RouteOptimizer />} />
          <Route path="/EditClient" element={<EditClient />} />
          <Route path="/ChemicalUsage" element={<ChemicalUsage />} />
          <Route path="/NewChemicalUsage" element={<NewChemicalUsage />} />
          <Route path="/Notes" element={<Notes />} />
          <Route path="/Settings" element={<Settings />} />
          <Route path="/PoolSchool" element={<PoolSchool />} />
          <Route path="/WorkOrders" element={<WorkOrdersRootRedirect />} />
          <Route path="/workorders" element={<WorkOrdersRootRedirect />} />
          <Route path="/workorders/:section" element={<WorkOrders />} />
          <Route path="/invoice-pay/:invoiceId" element={<LegacyInvoicePayRedirect />} />
          <Route path="/Billing" element={<BillingDashboard />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
