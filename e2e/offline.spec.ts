import { test, expect } from '@playwright/test';

async function waitForAuthShellToSettle(page) {
  await page.waitForLoadState('domcontentloaded');
  const loadingTexts = [/Loading ChemCheck/i, /Initializing your workspace/i, /^Loading\.+$/i];
  for (const text of loadingTexts) {
    const loading = page.getByText(text).first();
    if (await loading.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(loading).toBeHidden({ timeout: 20000 });
    }
  }
}

async function recoverFromErrorScreen(page) {
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

function isOnLoginRoute(page) {
  return new URL(page.url()).pathname.startsWith('/login');
}

async function setOfflineAndNotify(context, page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('load').catch(() => {});
  await context.setOffline(true);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.waitForLoadState('domcontentloaded');
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      return;
    } catch (error) {
      const message = String(error);
      if (!message.includes('Execution context was destroyed') || attempt === 2) {
        throw error;
      }
    }
  }
}

async function expectBrowserOffline(page) {
  await expect.poll(async () => page.evaluate(() => navigator.onLine)).toBe(false);
}

test.describe('Offline resilience', () => {
  async function openAuthenticatedHome(page) {
    await page.goto('/');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);

    if (await isOnLoginRoute(page)) {
      test.skip(true, 'Auth bypass not enabled; skipping offline test');
    }

    await expect(page.getByRole('heading', { name: /Today's Route/i })).toBeVisible();
  }

  test('history renders from local data while offline', async ({ page, context }) => {
    await openAuthenticatedHome(page);
    await page.goto('/history');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);
    await expect(page.getByRole('heading', { name: 'Service History', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/history$/);
    await page.waitForLoadState('load').catch(() => {});

    await setOfflineAndNotify(context, page);
    await expectBrowserOffline(page);
    await expect(page.getByRole('heading', { name: 'Service History', exact: true })).toBeVisible();
    await expect(page.getByText(/Oops! Something went wrong/i)).toHaveCount(0);
  });

  test('customer list renders from local data while offline', async ({ page, context }) => {
    await openAuthenticatedHome(page);
    await page.goto('/clients');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/clients$/);
    await page.waitForLoadState('load').catch(() => {});

    await setOfflineAndNotify(context, page);
    await expectBrowserOffline(page);
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
    await expect(page.getByText(/Oops! Something went wrong/i)).toHaveCount(0);
  });
});
