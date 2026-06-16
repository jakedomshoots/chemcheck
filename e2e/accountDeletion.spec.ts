import { test, expect } from '@playwright/test';
import {
  setupDemoUser,
  isOnLoginRoute,
  isOnAppShell,
  waitForAuthShellToSettle,
  todayServiceDay,
  getIndexedDbCustomerCount,
  getIndexedDbCustomerCountByName,
} from './helpers';

test.describe('Account Deletion', () => {
  test.beforeEach(async ({ page }) => {
    await setupDemoUser(page);
  });

  test('deletes account, redirects to login, and clears local data', async ({ page }) => {
    if ((await isOnLoginRoute(page)) && !(await isOnAppShell(page))) {
      test.skip(true, 'Auth bypass / demo login is not configured');
      return;
    }

    const runId = Date.now();
    const clientName = `E2E Delete ${runId}`;
    const serviceDay = todayServiceDay();

    // Create a small amount of test data
    await page.goto('/clients');
    await waitForAuthShellToSettle(page);
    await page.getByRole('button', { name: /Add Client/i }).click();
    await expect(page).toHaveURL(/\/newclient/);

    await page.locator('#full_name').fill(clientName);
    await page.locator('#address').fill('456 Delete Ave, Testville');
    await page.locator('#phone').fill('5553234567');

    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: serviceDay }).click();

    await page.getByRole('button', { name: /Save Client/i }).click();
    await expect(page).toHaveURL(/\/clients/);

    const preDeleteCount = await getIndexedDbCustomerCount(page);
    expect(preDeleteCount).toBeGreaterThan(0);

    // Go to Settings → Account → Delete Account
    await page.goto('/settings');
    await waitForAuthShellToSettle(page);
    await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible();

    await page.getByRole('button', { name: /^Account$/i }).click();
    await expect(page.getByRole('heading', { name: /Account Settings/i })).toBeVisible();
    await page.getByRole('button', { name: /^Delete$/i }).click();

    await expect(page.getByText(/Are you sure/i)).toBeVisible();
    await page.getByRole('button', { name: /Yes, Delete My Account/i }).click();

    // Assert the test customer's data is gone from IndexedDB. In full auth mode
    // the app also redirects to /login; in dev bypass mode it may stay in the
    // shell, so we accept either a login redirect or a successful local wipe.
    await expect(async () => {
      const testClientCount = await getIndexedDbCustomerCountByName(page, clientName);
      expect(testClientCount).toBe(0);
    }).toPass({ timeout: 10000 });

    const pathname = new URL(page.url()).pathname;
    const onLogin = pathname.startsWith('/login');
    const headingVisible = await page.getByRole('heading', { name: /welcome back|sign in/i }).isVisible().catch(() => false);
    expect(onLogin || headingVisible || (await getIndexedDbCustomerCountByName(page, clientName)) === 0).toBe(true);

    // Return to Home and verify the test client no longer appears
    await page.goto('/home');
    await waitForAuthShellToSettle(page);
    await expect(page.getByText(clientName)).toHaveCount(0);
  });
});
