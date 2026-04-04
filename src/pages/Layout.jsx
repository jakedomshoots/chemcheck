import React, { useState, useEffect, lazy, Suspense } from "react";
import { Link, useLocation } from "react-router-dom";
import { APP_ROUTES, getCanonicalRoute } from '@/lib/routeConfig';
import { Home, Users, FileText, TestTube, StickyNote, Menu, X, Settings, BookOpen, ClipboardList, Navigation } from "lucide-react";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    { name: "Home", path: APP_ROUTES.Home, icon: Home },
    { name: "Clients", path: APP_ROUTES.Clients, icon: Users },
    { name: "Work Orders", path: APP_ROUTES.WorkOrders, icon: ClipboardList },
    { name: "Report", path: APP_ROUTES.WeeklyReport, icon: FileText },
    { name: "Notes", path: APP_ROUTES.Notes, icon: StickyNote },
    { name: "Chemicals", path: APP_ROUTES.ChemicalUsage, icon: TestTube },
    { name: "Route Plan", path: APP_ROUTES.RouteOptimizer, icon: Navigation },
    { name: "Pool School", path: APP_ROUTES.PoolSchool, icon: BookOpen },
    { name: "Settings", path: APP_ROUTES.Settings, icon: Settings },
  ];

  const isActive = (path) => {
    const canonicalPath = getCanonicalRoute(location.pathname) === "/" ? APP_ROUTES.Home : getCanonicalRoute(location.pathname);

    if (path === APP_ROUTES.WorkOrders) {
      return canonicalPath.startsWith(APP_ROUTES.WorkOrders);
    }

    return canonicalPath === path;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-100/50 font-sans selection:bg-cyan-100">
      {/* Header - Mobile Only */}
      <header className="lg:hidden sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm safe-area-top">
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
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2.5 -mr-1 hover:bg-slate-100/80 active:bg-slate-200/80 active:scale-90 rounded-xl transition-all touch-manipulation flex items-center justify-center min-w-[40px] min-h-[40px]"
              aria-label="Open navigation menu"
            >
              <Menu className="w-7 h-7 stroke-[2]" />
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-64 bg-white/80 backdrop-blur-xl border-r border-slate-200/60 shadow-2xl flex-col z-40">
        {/* Logo */}
        <div className="p-6 border-b border-slate-200">
          <div className="space-y-2">
            <img
              src={chemcheckLogo}
              alt="ChemCheck"
              className="h-10 w-auto max-w-[220px]"
            />
            <p className="text-xs font-medium text-slate-500">Pool Service Manager</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${active
                  ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg"
                  : "text-slate-700 hover:bg-slate-100"
                  }`}
              >
                <item.icon className={`h-5 w-5 stroke-[1.75] transition-all ${active ? "text-white" : "text-muted-foreground group-hover:text-primary"
                  }`} />
                <span className="font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sync Status - Desktop */}
        <div className="p-4 border-t border-slate-200">
          <Suspense fallback={<div className="h-8 w-full" aria-hidden="true" />}>
            {renderSyncIndicator ? (
              <SyncStatusIndicator showLabel={true} showPendingCount={true} />
            ) : (
              <div className="h-8 w-full" aria-hidden="true" />
            )}
          </Suspense>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-200"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white shadow-2xl flex flex-col transform transition-transform duration-200 ease-out translate-x-0">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center">
                <img
                  src={chemcheckLogo}
                  alt="ChemCheck"
                  className="h-7 sm:h-8 w-auto max-w-[160px] sm:max-w-[200px]"
                />
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 -mr-2 hover:bg-slate-100 active:bg-slate-200 active:scale-95 rounded-lg transition-all touch-manipulation"
                aria-label="Close navigation menu"
              >
                <X className="w-6 h-6 stroke-[1.75] text-slate-500" />
              </button>
            </div>

            <nav className="p-4 space-y-1">
              {navItems.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${active
                      ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg"
                      : "text-slate-700 hover:bg-slate-100"
                      }`}
                  >
                    <item.icon className={`h-5 w-5 stroke-[1.75] transition-all ${active ? "text-white" : "text-muted-foreground group-hover:text-primary"
                      }`} />
                    <span className="font-medium">{item.name}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="lg:ml-64 min-h-screen safe-area-bottom">
        {children}
      </main>

    </div>
  );
}
