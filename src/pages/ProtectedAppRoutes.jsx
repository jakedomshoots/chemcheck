import { lazy, Suspense } from 'react';
import Layout from './Layout.jsx';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ChemicalBeakerLoader as Loader } from '@/components/ui/loader';
import { importWithRetry } from '@/lib/chunkErrorRecovery';
import { getDefaultWorkOrdersSectionFromStorage } from '@/lib/workOrdersNavigation';
import { useAuthContext } from '@/components/auth/ClerkAuthProvider';
import { useSyncInitialization } from '@/hooks/useSyncInitialization';
import { APP_ROUTES, ROUTE_ALIAS_REDIRECTS, SYSTEM_ROUTES, getCanonicalPageName } from '@/lib/routeConfig';

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
const NotFoundPage = lazy(() =>
  importWithRetry(() => import('./NotFoundPage').then((m) => ({ default: m.NotFoundPage })), 'NotFoundPage')
);
const AccessDeniedPage = lazy(() =>
  importWithRetry(() => import('./AccessDeniedPage').then((m) => ({ default: m.AccessDeniedPage })), 'AccessDeniedPage')
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
  return <Navigate to={`${APP_ROUTES.WorkOrders}/invoices${encodedId ? `?invoice_id=${encodedId}` : ""}`} replace />;
}

function WorkOrdersRootRedirect() {
  const defaultSection = getDefaultWorkOrdersSectionFromStorage();
  return <Navigate to={`${APP_ROUTES.WorkOrders}/${defaultSection}`} replace />;
}

const ROUTES = [
  { path: APP_ROUTES.Home, element: <Home /> },
  { path: APP_ROUTES.Clients, element: <Clients /> },
  { path: APP_ROUTES.NewClient, element: <NewClient /> },
  { path: APP_ROUTES.NewServiceLog, element: <NewServiceLog /> },
  { path: APP_ROUTES.CustomerDetail, element: <CustomerDetail /> },
  { path: APP_ROUTES.WeeklyReport, element: <WeeklyReport /> },
  { path: APP_ROUTES.RouteOptimizer, element: <RouteOptimizer /> },
  { path: APP_ROUTES.EditClient, element: <EditClient /> },
  { path: APP_ROUTES.ChemicalUsage, element: <ChemicalUsage /> },
  { path: APP_ROUTES.NewChemicalUsage, element: <NewChemicalUsage /> },
  { path: APP_ROUTES.Notes, element: <Notes /> },
  { path: APP_ROUTES.Settings, element: <Settings /> },
  { path: APP_ROUTES.PoolSchool, element: <PoolSchool /> },
  { path: APP_ROUTES.Billing, element: <BillingDashboard /> },
  { path: APP_ROUTES.WorkOrders, element: <WorkOrdersRootRedirect /> },
];

const DYNAMIC_WORKORDERS_ROUTE = `${APP_ROUTES.WorkOrders}/:section`;

function getCurrentPage(url) {
  const canonicalPage = getCanonicalPageName(url);
  if (canonicalPage === 'WorkOrders') {
    return 'WorkOrders';
  }

  return canonicalPage || 'Home';
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
        <Route path={APP_ROUTES.Home} element={<Home />} />
        {ROUTE_ALIAS_REDIRECTS.map(({ from, to }) => (
          <Route key={from} path={from} element={<Navigate to={to} replace />} />
        ))}
        {ROUTES.map((route) => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
        <Route path={DYNAMIC_WORKORDERS_ROUTE} element={<WorkOrders />} />
        <Route path="/invoice-pay/:invoiceId" element={<LegacyInvoicePayRedirect />} />
        <Route path="/Invoice-pay/:invoiceId" element={<LegacyInvoicePayRedirect />} />
        <Route path={SYSTEM_ROUTES.AccessDenied} element={<AccessDeniedPage />} />
        <Route path={SYSTEM_ROUTES.NotFound} element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to={SYSTEM_ROUTES.NotFound} replace />} />
      </Routes>
    </Suspense>
    </Layout>
  );
}
