import { createPageUrl } from '@/utils'

export const APP_ROUTES = {
  Home: createPageUrl('Home'),
  Clients: createPageUrl('Clients'),
  NewClient: createPageUrl('NewClient'),
  NewServiceLog: createPageUrl('NewServiceLog'),
  CustomerDetail: createPageUrl('CustomerDetail'),
  WeeklyReport: createPageUrl('WeeklyReport'),
  RouteOptimizer: createPageUrl('RouteOptimizer'),
  EditClient: createPageUrl('EditClient'),
  ChemicalUsage: createPageUrl('ChemicalUsage'),
  NewChemicalUsage: createPageUrl('NewChemicalUsage'),
  Notes: createPageUrl('Notes'),
  Settings: createPageUrl('Settings'),
  PoolSchool: createPageUrl('PoolSchool'),
  WorkOrders: createPageUrl('WorkOrders'),
  Billing: createPageUrl('Billing'),
}

export const SYSTEM_ROUTES = {
  NotFound: '/not-found',
  AccessDenied: '/access-denied',
  Health: '/health',
  Ready: '/ready',
};

export const HEALTH_ROUTE = '/health';
export const READY_ROUTE = '/ready';
const canonicalRoutes = Object.entries(APP_ROUTES)
const PUBLIC_STATIC_ROUTES = new Set([
  '/login',
  '/signup',
  '/sso-callback',
  '/pricing',
  HEALTH_ROUTE,
  READY_ROUTE,
  '/privacy-policy.html',
  '/terms-of-service.html',
]);

const canonicalPaths = new Set(canonicalRoutes.map(([, path]) => path))
export const PUBLIC_REPORT_PATH = '/report/:reportId/*';
export const REPORT_ROUTE_PATTERN = /^\/report\/[A-Za-z0-9_-]{8,128}(?:\/.*)?$/;

function normalizeRoutePath(pathname = '/') {
  const pathOnly = pathname.split(/[?#]/)[0] || '/';
  if (!pathOnly.length) {
    return '/';
  }

  const withLeadingSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  const trimmedSlashless = withLeadingSlash.replace(/\/+$/, '');
  return trimmedSlashless.length === 0 ? '/' : trimmedSlashless;
}

function normalizeAlias(alias: string) {
  return normalizeRoutePath(alias).toLowerCase();
}

export const APP_ROUTE_ALIAS_MAP: Record<string, string> = (() => {
  const aliasMap: Record<string, string> = {};

  for (const [, path] of canonicalRoutes) {
    aliasMap[normalizeAlias(path)] = path;
  }

  const compatibilityAliases = {
    '/home': APP_ROUTES.Home,
    '/clients': APP_ROUTES.Clients,
    '/newclient': APP_ROUTES.NewClient,
    '/newservicelog': APP_ROUTES.NewServiceLog,
    '/customerdetail': APP_ROUTES.CustomerDetail,
    '/weeklyreport': APP_ROUTES.WeeklyReport,
    '/routeoptimizer': APP_ROUTES.RouteOptimizer,
    '/editclient': APP_ROUTES.EditClient,
    '/chemicalusage': APP_ROUTES.ChemicalUsage,
    '/newchemicalusage': APP_ROUTES.NewChemicalUsage,
    '/notes': APP_ROUTES.Notes,
    '/settings': APP_ROUTES.Settings,
    '/poolschool': APP_ROUTES.PoolSchool,
    '/workorders': APP_ROUTES.WorkOrders,
    '/billing': APP_ROUTES.Billing,
    '/history': APP_ROUTES.Clients,
    '/health': HEALTH_ROUTE,
    '/ready': READY_ROUTE,
  };

  for (const [alias, canonical] of Object.entries(compatibilityAliases)) {
    aliasMap[normalizeAlias(alias)] = canonical;
  }

  aliasMap['/'] = APP_ROUTES.Home;
  return aliasMap;
})();

export const ROUTE_ALIAS_REDIRECTS: Array<{ from: string; to: string }> = Object.entries(APP_ROUTE_ALIAS_MAP)
  .filter(([alias, canonical]) => alias !== '/' && alias !== normalizeAlias(canonical))
  .map(([alias, canonical]) => ({
    from: alias,
    to: canonical,
  }));

export const ROUTE_PATH_TO_PAGE: Record<string, string> = canonicalRoutes.reduce((acc, [name, path]) => {
  acc[path.toLowerCase()] = name;
  return acc;
}, {} as Record<string, string>);

export const APP_ROUTE_PATHS = Array.from(canonicalPaths);

export function isReportPath(pathname = '/') {
  return REPORT_ROUTE_PATTERN.test(normalizeRoutePath(pathname).toLowerCase());
}

export function isPublicRoute(pathname = '/') {
  const normalizedLower = normalizeRoutePath(pathname).toLowerCase();

  if (isReportPath(normalizedLower)) return true;
  if (PUBLIC_STATIC_ROUTES.has(normalizedLower)) return true;

  if (normalizedLower.startsWith('/login/')) return true;
  if (normalizedLower.startsWith('/signup/')) return true;
  if (normalizedLower.startsWith('/sso-callback')) return true;

  return false;
}

export function isStandalonePublicRoute(pathname = '/') {
  const normalizedLower = normalizeRoutePath(pathname).toLowerCase();
  return normalizedLower === HEALTH_ROUTE || normalizedLower === READY_ROUTE;
}

export function getCanonicalRoute(pathname = '/') {
  const normalizedPath = normalizeRoutePath(pathname);
  const lowered = normalizeAlias(normalizedPath);
  return APP_ROUTE_ALIAS_MAP[lowered] || normalizedPath;
}

export function getCanonicalPageName(pathname = '/') {
  const canonicalPath = getCanonicalRoute(pathname)
  const canonicalPathNoSlash = canonicalPath === '/' ? canonicalPath : normalizeRoutePath(canonicalPath)

  if (canonicalPathNoSlash.startsWith(`${APP_ROUTES.WorkOrders}/`)) {
    return 'WorkOrders'
  }

  return ROUTE_PATH_TO_PAGE[canonicalPathNoSlash.toLowerCase()] || null
}
