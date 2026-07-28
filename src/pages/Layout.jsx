import React, { useState, useEffect, lazy, Suspense } from "react";
import { Link, useLocation } from "react-router-dom";
import { APP_ROUTES, getCanonicalRoute } from '@/lib/routeConfig';
import { PoolIcon } from "@/components/ui/iconography";
import { importWithRetry } from "@/lib/chunkErrorRecovery";
import chemcheckLogo from "@/assets/chemcheck-logo.svg";
import { useBottomNavigation } from '@/hooks/useBottomNavigation';
import { MOBILE_NAV_ITEMS, getMobileNavItems, getOverflowNavItems } from '@/lib/bottomNavigation';
import { RouteScrollManager } from '@/components/navigation/RouteScrollManager';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';

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
  const { itemIds: primaryTabIds } = useBottomNavigation();

  // Defer sync UI hydration until idle time to keep first paint responsive.
  useEffect(() => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(() => setRenderSyncIndicator(true), { timeout: 2000 });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(() => setRenderSyncIndicator(true), 600);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const navItems = MOBILE_NAV_ITEMS;
  const primaryTabs = getMobileNavItems(primaryTabIds);
  const moreItems = getOverflowNavItems(primaryTabIds);

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
      <RouteScrollManager />

      <header className="relative z-40 border-b border-line bg-surface-1 safe-area-top lg:hidden">
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
                className={`group flex items-center gap-3 rounded-xl px-4 py-3 transition-[color,background-color,transform] duration-150 active:scale-[0.985] motion-reduce:transform-none ${active
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
        className="app-chrome fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-surface-1/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
        aria-label="Primary navigation"
      >
        <div className="flex items-center justify-around h-16">
          {primaryTabs.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`mx-1 flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 transition-[color,background-color,transform] duration-150 active:scale-[0.97] motion-reduce:transform-none ${active
                  ? "bg-primary text-primary-foreground"
                  : "text-ink-muted hover:text-ink-secondary hover:bg-surface-2"
                  }`}
                aria-current={active ? "page" : undefined}
                aria-label={item.name}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg">
                  <PoolIcon name={item.icon} className={`h-5 w-5 ${active ? "text-primary-foreground" : ""}`} />
                </span>
                <span className="truncate px-1 text-xs font-medium">{item.shortLabel}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={`mx-1 flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 transition-[color,background-color,transform] duration-150 active:scale-[0.97] motion-reduce:transform-none ${isMoreActive ? "bg-primary text-primary-foreground" : "text-ink-muted hover:text-ink-secondary hover:bg-surface-2"}`}
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

      <Drawer open={moreOpen} onOpenChange={setMoreOpen} shouldScaleBackground={false}>
        <DrawerContent
          id="mobile-more-navigation"
          aria-label="More options"
          className="mx-auto max-w-md px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:hidden"
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <DrawerTitle className="text-base font-semibold text-ink">More</DrawerTitle>
              <DrawerDescription className="sr-only">Destinations not pinned to the bottom menu.</DrawerDescription>
            </div>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className="-mr-2 flex h-11 w-11 touch-manipulation items-center justify-center rounded-control transition-[background-color,transform] hover:bg-surface-2 active:scale-95 active:bg-surface-2 motion-reduce:transform-none"
              aria-label="Close more options"
            >
              <PoolIcon name="close" className="h-5 w-5 text-ink-muted" />
            </button>
          </div>
          <nav className="native-scroll grid max-h-[min(65dvh,32rem)] grid-cols-1 gap-1 overflow-y-auto" aria-label="More destinations">
            {moreItems.map((item) => {
              const active = isActive(item.path);
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  onClick={() => setMoreOpen(false)}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 transition-[color,background-color,transform] duration-150 active:scale-[0.985] motion-reduce:transform-none ${active
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
        </DrawerContent>
      </Drawer>
    </div>
  );
}
