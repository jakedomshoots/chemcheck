import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { skipLocallyOrFailInCi, waitForAuthShellToSettle } from './helpers';

/**
 * End-to-end coverage against a realistic, deterministic local dataset
 * (scripts/seed-dev-data.ts). Nothing here needs a Convex deployment: the
 * app runs under the dev auth bypass, and the sync client is replaced at the
 * window level by an in-page fake that acknowledges every push.
 */

type SeedSummary = {
  owner: string;
  today: string;
  todayServiceDay: string;
  counts: Record<string, number>;
  todayStops: Array<{ id: number; full_name: string }>;
  customers: Array<{ id: number; full_name: string; service_day: string; logCount: number }>;
};

async function recoverFromErrorScreen(page: Page) {
  const errorHeading = page.getByRole('heading', { name: /Oops! Something went wrong/i });
  if (await errorHeading.isVisible({ timeout: 1500 }).catch(() => false)) {
    const tryAgain = page.getByRole('button', { name: /Try Again/i });
    if (await tryAgain.isVisible().catch(() => false)) {
      await tryAgain.click();
    } else {
      await page.getByRole('button', { name: /Reload App/i }).click();
    }
  }
}

async function openAuthenticatedHome(page: Page) {
  await page.goto('/');
  await waitForAuthShellToSettle(page);
  await recoverFromErrorScreen(page);
  if (new URL(page.url()).pathname.startsWith('/login')) {
    skipLocallyOrFailInCi('Auth bypass not enabled; seeded specs require an authenticated shell');
  }
  await expect(page.getByRole('heading', { name: /Today's Route/i })).toBeVisible({ timeout: 15000 });
}

/** Seed Dexie through the Vite dev server module and reload so live queries pick it up. */
async function seedAndReload(page: Page): Promise<SeedSummary> {
  const summary = await page.evaluate(async () => {
    const mod = await import('/scripts/seed-dev-data.ts');
    return mod.seedDevData({ reset: true });
  }) as SeedSummary;
  await page.reload();
  await waitForAuthShellToSettle(page);
  await recoverFromErrorScreen(page);
  await expect(page.getByRole('heading', { name: /Today's Route/i })).toBeVisible({ timeout: 15000 });
  return summary;
}

/**
 * Replace the app's Convex client with an in-page fake that acknowledges
 * every push and returns an empty pull. Needed because the dev bypass points
 * the real client at a placeholder deployment that never answers.
 */
async function installFakeConvexClient(page: Page) {
  await page.evaluate(async () => {
    const mod = await import('/src/lib/sync/SyncService.ts');
    const calls: Array<{ ref: unknown; args: any }> = [];
    const fakeClient = {
      __fake: true,
      calls,
      mutation: async (ref: unknown, args: any) => {
        calls.push({ ref, args });
        return {
          success: true,
          convex_id: args?.convex_id || `fake_${Math.random().toString(36).slice(2)}`,
          local_id: args?.local_id,
          operation: args?.convex_id ? 'update' : 'create',
          updated_at: Date.now(),
        };
      },
      query: async () => ({ hasMore: false, cursor: null, watermark: Date.now() }),
    };
    (window as any).__chemcheckFakeConvex = fakeClient;
    mod.syncService.initialize(fakeClient as any, 'anonymous');
    mod.syncService.startAutoSync();
  });
}

async function setOffline(context: BrowserContext, page: Page, offline: boolean) {
  await context.setOffline(offline);
  await page.evaluate((isOffline) => {
    window.dispatchEvent(new Event(isOffline ? 'offline' : 'online'));
  }, offline);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(!offline);
}

async function openSyncHealthPanel(page: Page) {
  // Layout renders one trigger in the mobile header and one in the desktop
  // sidebar; only one of them is visible at a given viewport.
  const trigger = page.getByTestId('sync-status-trigger').filter({ visible: true }).first();
  await expect(trigger).toBeVisible({ timeout: 10000 });
  try {
    await trigger.click({ timeout: 3000 });
  } catch {
    // The desktop sidebar is position: fixed and its footer (where the sync
    // control lives) falls below a 720px-tall viewport, so a pointer click
    // cannot reach it. Fire the DOM click instead; it exercises the same
    // trigger handler.
    await trigger.dispatchEvent('click');
  }
  const panel = page.getByTestId('sync-health-panel');
  await expect(panel).toBeVisible({ timeout: 10000 });
  return panel;
}

test.describe('Seeded local dataset', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'offline', 'Seeding needs the dev server reachable on first load');
    await openAuthenticatedHome(page);
  });

  test("today's route lists the seeded stops", async ({ page }) => {
    const summary = await seedAndReload(page);

    expect(summary.counts.customers).toBe(12);
    expect(summary.todayStops.length).toBeGreaterThanOrEqual(1);

    for (const stop of summary.todayStops) {
      await expect(page.locator('h3', { hasText: stop.full_name })).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('button', { name: `Start ${stop.full_name}` })).toBeVisible();
    }

    // Customers scheduled on other days are not on today's route.
    const offDay = summary.customers.find((customer) => customer.service_day !== summary.todayServiceDay);
    expect(offDay).toBeDefined();
    await expect(page.locator('h3', { hasText: offDay!.full_name })).toHaveCount(0);
  });

  test('saves a service log offline, shows it pending, and clears it after reconnecting', async ({ page, context }) => {
    const summary = await seedAndReload(page);
    const stop = summary.todayStops[0];

    await page.getByRole('button', { name: `Start ${stop.full_name}` }).click();
    await expect(page.getByRole('heading', { name: /Service Log/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(stop.full_name).first()).toBeVisible();

    await setOffline(context, page, true);

    // Reading entry mode is a segmented control (tablist) per chemical.
    await page.getByRole('tab', { name: /^Numeric$/i }).nth(0).click();
    await page.getByTestId('ph-numeric-input').fill('7.4');
    await page.getByRole('tab', { name: /^Numeric$/i }).nth(1).click();
    await page.getByTestId('chlorine-numeric-input').fill('2.5');
    await page.locator('#notes').fill('Seeded e2e visit while offline');

    await page.getByRole('button', { name: /Complete Service/i }).click();
    await expect(page.getByRole('heading', { name: /Today's Route/i })).toBeVisible({ timeout: 10000 });

    // The row exists locally and is waiting for the network.
    const pendingRow = await page.evaluate(async (customerId) => {
      const mod = await import('/src/db/chemcheck-db.ts');
      const rows = await mod.db.serviceLogs.where('customer_id').equals(customerId).toArray();
      const pending = rows.filter((row: any) => row.sync_status === 'pending');
      return { pending: pending.length, notes: pending[0]?.notes, ph: pending[0]?.ph_value };
    }, stop.id);
    expect(pendingRow.pending).toBe(1);
    expect(pendingRow.notes).toBe('Seeded e2e visit while offline');
    expect(pendingRow.ph).toBe(7.4);

    const panel = await openSyncHealthPanel(page);
    await expect(panel.getByTestId('sync-health-connection')).toHaveText(/Offline/);
    await expect(panel.getByTestId('sync-health-pending')).toHaveText(/^1/, { timeout: 20000 });
    await expect(panel.getByRole('button', { name: 'Sync Now' })).toBeDisabled();

    // Coming back online with a responsive backend drains the queue.
    await installFakeConvexClient(page);
    await setOffline(context, page, false);

    await expect(panel.getByTestId('sync-health-connection')).toHaveText(/Online/, { timeout: 10000 });
    await expect(panel.getByTestId('sync-health-pending')).toHaveText(/^0/, { timeout: 30000 });
    await expect(panel.getByTestId('sync-health-last-success')).not.toHaveText('Never', { timeout: 10000 });
    await expect(panel.getByTestId('sync-health-dead-count')).toHaveText('0');

    const synced = await page.evaluate(async (customerId) => {
      const mod = await import('/src/db/chemcheck-db.ts');
      const rows = await mod.db.serviceLogs.where('customer_id').equals(customerId).toArray();
      const row = rows.find((candidate: any) => candidate.notes === 'Seeded e2e visit while offline');
      const fake = (window as any).__chemcheckFakeConvex;
      return {
        status: row?.sync_status,
        convexId: row?.convex_id,
        pushes: fake?.calls?.length ?? 0,
      };
    }, stop.id);
    expect(synced.status).toBe('synced');
    expect(synced.convexId).toMatch(/^fake_/);
    expect(synced.pushes).toBeGreaterThanOrEqual(1);
  });

  test('customer detail shows the seeded service history', async ({ page }) => {
    const summary = await seedAndReload(page);
    const customer = summary.customers.find((entry) => entry.logCount === 8)!;

    await page.goto(`/customerdetail?id=${customer.id}`);
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);

    await expect(page.getByRole('heading', { name: customer.full_name })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Service History', exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ readings?/i).first()).toBeVisible();
    await expect(page.getByText(/\d+ readings?/i)).toHaveCount(customer.logCount, { timeout: 10000 });
  });
});
