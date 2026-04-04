import { appRuntime } from '@/lib/platformPolicy';
import { getServiceWorkerState } from '@/lib/serviceWorker';
import { migrationManager } from '@/lib/migrations';
import { monitoring } from '@/lib/monitoring';
import { ROUTE_ALIAS_REDIRECTS } from '@/lib/routeConfig';

export type ReadinessLevel = 'ok' | 'degraded' | 'down';

export interface ReadinessCheck {
  status: ReadinessLevel;
  details: Record<string, unknown>;
}

export interface ReadinessReport {
  status: ReadinessLevel;
  appVersion: string;
  dataVersion: number;
  checks: {
    routingReady: ReadinessCheck;
    storageReady: ReadinessCheck;
    migrationReady: ReadinessCheck;
    serviceWorkerReady: ReadinessCheck;
    monitoringReady: ReadinessCheck;
  };
  timestamp: string;
  metadata: {
    environment: 'browser' | 'server';
    isOnline: boolean;
    swRegistrationSource: 'existing' | 'registered' | 'none';
    routingRoot: string;
  };
}

interface MigrationStateSnapshot {
  currentVersion: number;
  appliedMigrations: number[];
  lastMigration: string;
}

function storageReady(): ReadinessCheck {
  try {
    localStorage.setItem('__chemcheck_readiness_probe__', '1');
    localStorage.removeItem('__chemcheck_readiness_probe__');
    return { status: 'ok', details: { available: true } };
  } catch (error) {
    return {
      status: 'degraded',
      details: {
        available: false,
        reason: error instanceof Error ? error.message : 'Storage unavailable',
      },
    };
  }
}

async function getMigrationState(): Promise<{
  check: ReadinessCheck;
  state: MigrationStateSnapshot | null;
}> {
  try {
    const state = await migrationManager.getCurrentState();
    return {
      state,
      check: {
        status: state.currentVersion >= 1 ? 'ok' : 'degraded',
        details: {
          currentVersion: state.currentVersion,
          applied: state.appliedMigrations,
          lastMigration: state.lastMigration,
        },
      },
    };
  } catch (error) {
    return {
      state: null,
      check: {
        status: 'down',
        details: {
          error: error instanceof Error ? error.message : 'Migration state unavailable',
        },
      },
    };
  }
}

function serviceWorkerReady(): ReadinessCheck {
  try {
    const state = getServiceWorkerState();
    return {
      status: state.isSupported
        ? state.isRegistered
          ? 'ok'
          : 'degraded'
        : 'degraded',
      details: {
        isSupported: state.isSupported,
        isRegistered: state.isRegistered,
        isControlling: state.isControlling,
        hasUpdate: state.hasUpdate,
      },
    };
  } catch (error) {
    return {
      status: 'degraded',
      details: {
        error: error instanceof Error ? error.message : 'Service worker status unavailable',
      },
    };
  }
}

function monitoringReady(): ReadinessCheck {
  const diagnostics = monitoring.getPerformanceReport();
  const hasRecentSignals = diagnostics.summary.totalErrors < 20;
  return {
    status: hasRecentSignals ? 'ok' : 'degraded',
    details: {
      totalErrors: diagnostics.summary.totalErrors,
      avgPageLoadMs: diagnostics.summary.avgPageLoadTime,
      slowQueries: diagnostics.summary.slowQueries,
      memoryIssues: diagnostics.summary.memoryIssues,
    },
  };
}

function routingReady(): ReadinessCheck {
  return {
    status: 'ok',
    details: {
      enabled: true,
      supportsSPA: true,
      canonicalAliasCount: ROUTE_ALIAS_REDIRECTS.length,
    },
  };
}

function buildMetadata(routeName: string, swState: ReturnType<typeof getServiceWorkerState>): ReadinessReport['metadata'] {
  return {
    environment: typeof window === 'undefined' ? 'server' : 'browser',
    isOnline: typeof navigator === 'undefined' ? false : navigator.onLine,
    swRegistrationSource: swState.isSupported && swState.isRegistered ? 'registered' : 'none',
    routingRoot: routeName,
  };
}

export async function getReadinessReport(): Promise<ReadinessReport> {
  const migrationStatus = await getMigrationState();
  const swState = getServiceWorkerState();
  const routeName = typeof window === 'undefined' ? '/' : (window.location.pathname || '/');
  const migrationVersion = migrationStatus.state?.currentVersion || 1;

  const report: ReadinessReport = {
    status: 'ok',
    appVersion: appRuntime.appVersion,
    dataVersion: migrationVersion,
    checks: {
      routingReady: routingReady(),
      storageReady: storageReady(),
      migrationReady: migrationStatus.check,
      serviceWorkerReady: serviceWorkerReady(),
      monitoringReady: monitoringReady(),
    },
    timestamp: new Date().toISOString(),
    metadata: buildMetadata(routeName, swState),
  };

  if (
    report.checks.storageReady.status === 'down' ||
    report.checks.migrationReady.status === 'down' ||
    report.checks.serviceWorkerReady.status === 'down'
  ) {
    report.status = 'down';
  } else if (
    report.checks.storageReady.status === 'degraded' ||
    report.checks.migrationReady.status === 'degraded' ||
    report.checks.serviceWorkerReady.status === 'degraded' ||
    report.checks.monitoringReady.status === 'degraded'
  ) {
    report.status = 'degraded';
  }

  return report;
}

