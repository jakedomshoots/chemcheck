import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Home, Users, BarChart3, FileText, TestTube, StickyNote, Menu, X, Settings, BookOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AdminDashboard } from "@/components/AdminDashboard";
import { SyncStatusIndicator } from "@/components/sync/SyncStatusIndicator";

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);

  // Admin dashboard keyboard shortcut (Ctrl+Shift+A)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'A') {
        event.preventDefault();
        setShowAdminDashboard(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navItems = [
    { name: "Home", path: createPageUrl("Home"), icon: Home },
    { name: "Clients", path: createPageUrl("Clients"), icon: Users },
    { name: "History", path: createPageUrl("History"), icon: BarChart3 },
    { name: "Report", path: createPageUrl("WeeklyReport"), icon: FileText },
    { name: "Notes", path: createPageUrl("Notes"), icon: StickyNote },
    { name: "Chemicals", path: createPageUrl("ChemicalUsage"), icon: TestTube },
    { name: "Pool School", path: createPageUrl("PoolSchool"), icon: BookOpen },
    { name: "Settings", path: createPageUrl("Settings"), icon: Settings },
  ];

  const isActive = (path) => location.pathname === path;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-100/50 font-sans selection:bg-cyan-100">
      {/* Header - Mobile Only */}
      <header className="lg:hidden sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <TestTube className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
              ChemCheck
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <SyncStatusIndicator showPendingCount={true} />
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-4 -mr-3 hover:bg-slate-100/80 active:bg-slate-200/80 active:scale-90 rounded-2xl transition-all touch-manipulation flex items-center justify-center min-w-[48px] min-h-[48px]"
              aria-label="Open navigation menu"
            >
              <Menu className="w-8 h-8 stroke-[2]" />
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-64 bg-white/80 backdrop-blur-xl border-r border-slate-200/60 shadow-2xl flex-col z-40">
        {/* Logo */}
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <TestTube className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                ChemCheck
              </h1>
              <p className="text-xs font-medium text-slate-500">Pool Service Manager</p>
            </div>
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
          <SyncStatusIndicator showLabel={true} showPendingCount={true} />
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="lg:hidden fixed inset-0 z-[60]"
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="absolute left-0 top-0 h-full w-72 bg-white shadow-2xl flex flex-col"
            >
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                    <TestTube className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                      ChemCheck
                    </h1>
                  </div>
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
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="lg:ml-64 min-h-screen">
        {children}
      </main>

      {/* Admin Dashboard */}
      {showAdminDashboard && (
        <AdminDashboard onClose={() => setShowAdminDashboard(false)} />
      )}
    </div>
  );
}
