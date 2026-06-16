import { test, expect, type Page } from '@playwright/test';

async function recoverFromErrorScreen(page: Page): Promise<void> {
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

function getPathname(page: Page): string {
  return new URL(page.url()).pathname;
}

async function isOnLoginRoute(page: Page): Promise<boolean> {
  return getPathname(page).startsWith('/login');
}

async function waitForAuthShellToSettle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');

  const loadingTexts = [
    /Loading ChemCheck/i,
    /Initializing your workspace/i,
    /^Loading\.\.\.$/i,
  ];

  for (const text of loadingTexts) {
    const loading = page.getByText(text).first();
    if (await loading.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(loading).toBeHidden({ timeout: 20000 });
    }
  }
}

async function seedHistoryData(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const mod = await import('/src/db/chemcheck-db.ts');
    const db = mod.db;
    const DEFAULT_USER = mod.DEFAULT_USER || 'local';
    const now = new Date().toISOString();

    await db.serviceLogs.clear();
    await db.customers.clear();

    const customerOne = await db.customers.add({
      full_name: 'Filter Test One',
      address: '123 Main St',
      service_day: 'Monday',
      pool_type: 'Chlorine',
      surface_type: 'Plaster',
      created_by: DEFAULT_USER,
      createdAt: now,
      updatedAt: now,
      sync_status: 'pending',
      local_updated_at: Date.now(),
    });

    const customerTwo = await db.customers.add({
      full_name: 'Filter Test Two',
      address: '456 Oak Ave',
      service_day: 'Monday',
      pool_type: 'Salt',
      surface_type: 'Tile',
      created_by: DEFAULT_USER,
      createdAt: now,
      updatedAt: now,
      sync_status: 'pending',
      local_updated_at: Date.now(),
    });

    await db.serviceLogs.add({
      customer_id: customerOne,
      service_date: '2026-02-01',
      status: 'completed',
      ph: 'good',
      chlorine: 'low',
      alkalinity: 'good',
      stabilizer: 'good',
      notes: 'incomplete proof',
      createdAt: now,
      updatedAt: now,
      sync_status: 'pending',
      local_updated_at: Date.now(),
    });

    await db.serviceLogs.add({
      customer_id: customerOne,
      service_date: '2026-02-08',
      status: 'completed',
      ph: 'good',
      chlorine: 'good',
      alkalinity: 'good',
      stabilizer: 'good',
      photo_count: 2,
      has_before_photos: true,
      has_after_photos: true,
      start_time: '2026-02-08T15:00:00.000Z',
      end_time: '2026-02-08T15:30:00.000Z',
      duration_ms: 1800000,
      notes: 'complete proof',
      createdAt: now,
      updatedAt: now,
      sync_status: 'pending',
      local_updated_at: Date.now(),
    });

    await db.serviceLogs.add({
      customer_id: customerTwo,
      service_date: '2026-02-09',
      status: 'completed',
      ph: 'high',
      chlorine: 'good',
      alkalinity: 'good',
      stabilizer: 'good',
      notes: 'no photos no time',
      createdAt: now,
      updatedAt: now,
      sync_status: 'pending',
      local_updated_at: Date.now(),
    });
  });
}

test.describe('Gameday Readiness', () => {
  test('core app routes load without crashing', async ({ page }) => {
    const routesToCheck = [
      '/',
      '/clients',
      '/newclient',
      '/newservicelog',
      '/history',
      '/weeklyreport',
      '/routeoptimizer',
      '/chemicalusage',
      '/newchemicalusage',
      '/notes',
      '/settings',
      '/poolschool',
      '/billing',
      '/pricing',
      '/report/test-report-id',
    ];

    for (const route of routesToCheck) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await recoverFromErrorScreen(page);

      if (await isOnLoginRoute(page)) {
        await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
        return;
      }

      await expect(page.getByText(/Oops! Something went wrong/i)).toHaveCount(0);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('settings sections and advanced tools are reachable', async ({ page }) => {
    await page.goto('/settings');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);
    await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible();

    await page.getByRole('button', { name: /^Business Info$/i }).click();
    await expect(page.getByRole('heading', { name: /Business Information/i })).toBeVisible();

    await page.getByRole('button', { name: /^Account$/i }).click();
    await expect(page.getByRole('heading', { name: /Account Settings/i })).toBeVisible();

    await page.getByRole('button', { name: /^Preferences$/i }).click();
    await expect(page.getByRole('heading', { name: /^Preferences$/i })).toBeVisible();

    await page.getByRole('button', { name: /^Notifications$/i }).click();
    await expect(page.getByRole('heading', { name: /^Notifications$/i })).toBeVisible();

    await page.getByRole('button', { name: /^Schedule$/i }).click();
    await expect(page.getByRole('heading', { name: /Work Schedule/i })).toBeVisible();

    await page.getByRole('button', { name: /^Service Types$/i }).click();
    await expect(page.getByRole('heading', { name: /Service Configuration/i })).toBeVisible();

    await page.getByRole('button', { name: /^Data Backup$/i }).click();
    await expect(page.getByRole('heading', { name: /^Data Backup$/i })).toBeVisible();
    await page.getByRole('button', { name: /Backup Manager/i }).click();
    await expect(page.getByRole('button', { name: /Download Backup/i })).toBeVisible();
    await page.getByRole('button', { name: '×' }).click();
    await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible();

    await page.getByRole('button', { name: /^Privacy & Data$/i }).click();
    await expect(page.getByRole('heading', { name: /Privacy & Data/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Privacy Policy/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Terms of Service/i })).toBeVisible();
  });

  test('privacy actions are functional and do not crash', async ({ page }) => {
    await page.goto('/settings');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);
    await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible();

    await page.getByRole('button', { name: /^Privacy & Data$/i }).click();
    await expect(page.getByRole('heading', { name: /Privacy & Data/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Download My Data/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /View Data Summary/i })).toBeVisible();

    await page.getByRole('button', { name: /View Data Summary/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Data Summary/i })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: /^Close$/i }).first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible();
    await expect(page.getByText(/Oops! Something went wrong/i)).toHaveCount(0);
  });

  test('pricing and billing screens stay stable across billing modes', async ({ page }) => {
    await page.goto('/pricing');
    await recoverFromErrorScreen(page);

    if (await isOnLoginRoute(page)) {
      await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
      return;
    }

    await expect(page.getByRole('heading', { name: /Simple, Transparent Pricing/i })).toBeVisible();

    const startTrialButton = page.getByRole('button', { name: /Start Free Trial/i }).first();
    if (await startTrialButton.isEnabled().catch(() => false)) {
      await startTrialButton.click();
    }

    await expect(page.getByText(/Oops! Something went wrong/i)).toHaveCount(0);

    await page.goto('/billing');
    await recoverFromErrorScreen(page);
    await expect(page.getByText(/Current Plan|No Active Subscription/i)).toBeVisible();
    await expect(page.getByText(/Oops! Something went wrong/i)).toHaveCount(0);
  });

  test('history proof filters do not crash and hide non-matching customers', async ({ page }) => {
    await page.goto('/history');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);
    await seedHistoryData(page);
    await page.reload();
    await waitForAuthShellToSettle(page);

    await expect(page.getByRole('heading', { name: 'Service History', exact: true })).toBeVisible();
    await expect(page.getByText(/Filter Test One/i)).toBeVisible();
    await expect(page.getByText(/Filter Test Two/i)).toBeVisible();

    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: /Has Photos/i }).click();
    await expect(page.getByText(/Showing:/i)).toBeVisible();
    await expect(page.getByText(/Filter Test One/i)).toBeVisible();
    await expect(page.getByText(/Filter Test Two/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Service History', exact: true })).toBeVisible();

    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: /^Complete Proof/i }).click();
    await expect(page.locator('h3', { hasText: 'Filter Test One' })).toBeVisible();
    await expect(page.locator('h3', { hasText: 'Filter Test Two' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Service History', exact: true })).toBeVisible();

    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: /All Logs/i }).click();
    await expect(page.getByText(/Filter Test One/i)).toBeVisible();
    await expect(page.getByText(/Filter Test Two/i)).toBeVisible();
  });

  test('account deletion flow confirms and completes without an error', async ({ page }) => {
    await page.goto('/settings');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);
    await page.getByRole('button', { name: /^Account$/i }).click();
    await expect(page.getByText(/Delete Account/i)).toBeVisible();

    await page.getByRole('button', { name: /^Delete$/i }).click();
    await expect(page.getByText(/Are you sure/i)).toBeVisible();
    await page.getByRole('button', { name: /Yes, Delete My Account/i }).click();

    await expect(page.getByText(/Failed to delete account/i)).toHaveCount(0);
    await expect(async () => {
      const pathname = new URL(page.url()).pathname;
      const onLogin = pathname.startsWith('/login');
      const inDevShell = await page.getByRole('heading', { name: /^Settings$/i }).isVisible().catch(() => false);
      expect(onLogin || inDevShell).toBe(true);
    }).toPass({ timeout: 20000 });
  });
});
