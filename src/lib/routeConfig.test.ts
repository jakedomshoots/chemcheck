import { describe, expect, it } from 'vitest';
import {
  APP_ROUTES,
  getCanonicalPageName,
  getCanonicalRoute,
  isPublicRoute,
  isReportPath,
} from './routeConfig';

describe('routeConfig', () => {
  it('normalizes route casing and trailing separators through canonicalization', () => {
    expect(getCanonicalRoute('/home')).toBe(APP_ROUTES.Home);
    expect(getCanonicalRoute('home')).toBe(APP_ROUTES.Home);
    expect(getCanonicalRoute('home/')).toBe(APP_ROUTES.Home);
  });

  it('returns canonical routes for alias casing variations', () => {
    expect(getCanonicalRoute('/home')).toBe(APP_ROUTES.Home);
    expect(getCanonicalRoute('/HOME')).toBe(APP_ROUTES.Home);
    expect(getCanonicalRoute('/report/abc123')).toBe('/report/abc123');
  });

  it('classifies canonical public routes', () => {
    expect(isPublicRoute('/login')).toBe(true);
    expect(isPublicRoute('/signup')).toBe(true);
    expect(isPublicRoute('/pricing')).toBe(true);
    expect(isPublicRoute('/privacy-policy.html')).toBe(true);
    expect(isPublicRoute('/terms-of-service.html')).toBe(true);
    expect(isPublicRoute('/Report/ABC123')).toBe(false);
  });

  it('classifies route aliases for compatibility', () => {
    expect(getCanonicalRoute('/newclient')).toBe(APP_ROUTES.NewClient);
    expect(getCanonicalPageName('/newclient')).toBe('NewClient');
    expect(getCanonicalRoute('/history')).toBe(APP_ROUTES.Clients);
    expect(getCanonicalPageName('/history')).toBe('Clients');
  });

  it('identifies standalone and report entry points', () => {
    expect(isReportPath('/report/abcdef12')).toBe(true);
    expect(isReportPath('/report/abcdef12/notes')).toBe(true);
    expect(isReportPath('/Report/ABCDEF12')).toBe(true);
  });

  it('maps canonical page names from known paths', () => {
    expect(getCanonicalPageName(APP_ROUTES.Home)).toBe('Home');
    expect(getCanonicalPageName('/routeoptimizer')).toBe('RouteOptimizer');
  });
});
