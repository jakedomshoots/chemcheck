import React, { useState, useEffect, lazy, Suspense } from "react";
import { Link, useLocation } from "react-router-dom";
import { APP_ROUTES, getCanonicalRoute } from '@/lib/routeConfig';
import { PoolIcon } from "@/components/ui/iconography";
import { X } from "lucide-react";
import { importWithRetry } from "@/lib/chunkErrorRecovery";
import chemcheckLogo from "@/assets/chemcheck-logo.svg";

const SyncStatusIndicator = lazy(() =>
  importWithRetry(
    () => import('@/components/sync/SyncStatusIndicator').then((mod) => ({ default: mod.SyncStatusIndicator })),
    'SyncStatusIndicator'
  )
);

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [renderSyncIndicator, setRenderSyncIndicator] = useState(false);

  // Defer sync UI hydration until idle time to keep first paint responsive.
  useEffect(() => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(() => setRenderSyncIndicator(true), { timeout: 2000 });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(() => setRenderSyncIndicator(true), 600);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const navItems = [
    { name: "Home", path: APP_ROUTES.Home, icon: "home" },
    { name: "Clients", path: APP_ROUTES.Clients, icon: "clients" },
    { name: "Work Orders", path: APP_ROUTES.WorkOrders, icon: "workOrders" },
    { name: "Reports", path: APP_ROUTES.WeeklyReport, icon: "report" },
    { name: "Notes", path: APP_ROUTES.Notes, icon: "notes" },
    { name: "Chemicals", path: APP_ROUTES.ChemicalUsage, icon: "chemicals" },
    { name: "Route Plan", path: APP_ROUTES.RouteOptimizer, icon: "route" },
    { name: "Pool School", path: APP_ROUTES.PoolSchool, icon: "poolSchool" },
    { name: "Settings", path: APP_ROUTES.Settings, icon: "settings" },
  ];

  const primaryTabs = [
    { name: "Home", path: APP_ROUTES.Home, icon: "home" },
    { name: "Clients", path: APP_ROUTES.Clients, icon: "clients" },
    { name: "Chemicals", path: APP_ROUTES.ChemicalUsage, icon: "chemicals" },
    { name: "Notes", path: APP_ROUTES.Notes, icon: "notes" },
  ];

  const moreItems = [
    { name: "Work Orders", path: APP_ROUTES.WorkOrders, icon: "workOrders" },
    { name: "Route Plan", path: APP_ROUTES.RouteOptimizer, icon: "route" },
    { name: "Reports", path: APP_ROUTES.WeeklyReport, icon: "report" },
    { name: "Pool School", path: APP_ROUTES.PoolSchool, icon: "poolSchool" },
    { name: "Settings", path: APP_ROUTES.Settings, icon: "settings" },
  ];

  const isActive = (path) => {
    const canonicalPath = getCanonicalRoute(location.pathname) === "/" ? APP_ROUTES.Home : getCanonicalRoute(location.pathname);

    if (path === APP_ROUTES.WorkOrders) {
      return canonicalPath.startsWith(APP_ROUTES.WorkOrders);
    }

    return canonicalPath === path;
  };

  const isMoreActive = moreItems.some((item) => isActive(item.path));

  return (
    <div className="min-h-screen bg-surface-0 font-sans selection:bg-brand-soft dark:selection:bg-cyan-900">
      <header className="lg:hidden sticky top-0 z-50 bg-surface-1/85 backdrop-blur-xl border-b border-line safe-area-top">
        <div className="flex items-center justify-between px-3 h-12 sm:h-14">
          <div className="flex items-center">
            <img
              src={chemcheckLogo}
              alt="ChemCheck"
              className="h-6 sm:h-8 w-auto max-w-[135px] sm:max-w-[200px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <Suspense fallback={<div className="h-8 w-8" aria-hidden="true" />}>
              {renderSyncIndicator ? <SyncStatusIndicator showPendingCount={true} /> : <div className="h-8 w-8" aria-hidden="true" />}
            </Suspense>
          </div>
        </div>
      </header>

      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-64 bg-surface-1 border-r border-line flex-col z-40">
        <div className="p-6 border-b border-line">
          <div className="space-y-2">
            <img
              src={chemcheckLogo}
              alt="ChemCheck"
              className="h-10 w-auto max-w-[220px]"
            />
            <p className="text-xs font-medium text-ink-muted">Pool Service Manager</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors duration-150 group ${active
                  ? "bg-primary text-primary-foreground"
                  : "text-ink-secondary hover:bg-surface-2"
                  }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors ${active ? "" : "group-hover:bg-surface-2"}`}>
                  <PoolIcon
                    name={item.icon}
                    className={`h-5 w-5 transition-colors ${active ? "text-primary-foreground" : "text-ink-secondary group-hover:text-ink"}`}
                  />
                </span>
                <span className="font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-line">
          <Suspense fallback={<div className="h-8 w-full" aria-hidden="true" />}>
            {renderSyncIndicator ? (
              <SyncStatusIndicator showLabel={true} showPendingCount={true} />
            ) : (
              <div className="h-8 w-full" aria-hidden="true" />
            )}
          </Suspense>
        </div>
      </aside>

      <main className="lg:ml-64 min-h-screen pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>

      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface-1/90 backdrop-blur-xl border-t border-line pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary navigation"
      >
        <div className="flex items-center justify-around h-16">
          {primaryTabs.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 py-1 mx-1 rounded-xl transition-colors duration-150 ${active
                  ? "bg-primary text-primary-foreground"
                  : "text-ink-muted hover:text-ink-secondary hover:bg-surface-2"
                  }`}
                aria-current={active ? "page" : undefined}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg">
                  <PoolIcon name={item.icon} className={`h-5 w-5 ${active ? "text-primary-foreground" : ""}`} />
                </span>
                <span className="text-xs font-medium truncate px-1">{item.name}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 py-1 mx-1 rounded-xl transition-colors duration-150 ${isMoreActive ? "bg-primary text-primary-foreground" : "text-ink-muted hover:text-ink-secondary hover:bg-surface-2"}`}
            aria-label="More navigation"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-controls="mobile-more-navigation"
            aria-current={isMoreActive ? "page" : undefined}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg">
              <PoolIcon name="more" className="h-5 w-5" />
            </span>
            <span className="text-xs font-medium truncate px-1">More</span>
          </button>
        </div>
      </nav>

      {/* More bottom sheet */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-[60] flex items-end justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-200"
            onClick={() => setMoreOpen(false)}
          />
          <div
            id="mobile-more-navigation"
            className="relative w-full max-w-md mx-auto bg-surface-1 rounded-t-sheet shadow-raised p-4 pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-bottom duration-200"
            role="dialog"
            aria-modal="true"
            aria-label="More options"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-ink">More</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="p-2 -mr-2 hover:bg-surface-2 active:bg-surface-2 active:scale-95 rounded-lg transition-colors touch-manipulation"
                aria-label="Close more options"
              >
                <PoolIcon name="close" className="h-5 w-5 text-ink-muted" />
              </button>
            </div>
            <nav className="grid grid-cols-1 gap-1">
              {moreItems.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors duration-150 ${active
                      ? "bg-primary text-primary-foreground"
                      : "text-ink-secondary hover:bg-surface-2"
                      }`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                      <PoolIcon name={item.icon} className={`h-5 w-5 ${active ? "text-primary-foreground" : "text-ink-secondary"}`} />
                    </span>
                    <span className="font-medium">{item.name}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
