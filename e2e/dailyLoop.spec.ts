import { test, expect } from '@playwright/test';
import { format } from 'date-fns';

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

function todayWeekday() {
  return format(new Date(), 'EEEE');
}

test.describe('Daily service loop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);
    if (await isOnLoginRoute(page)) {
      test.skip(true, 'Auth bypass not enabled; skipping authenticated daily-loop test');
    }
    await expect(page.getByRole('heading', { name: /Today's Route/i })).toBeVisible({ timeout: 10000 });
  });

  test('create client, complete service log with numeric readings, and send report', async ({ page, context }) => {
    const timestamp = Date.now();
    const customerName = `E2E Pool ${timestamp}`;
    const address = '123 Test Lane, Tucson, AZ';
    const phone = '5205550100';
    const email = `e2e+${timestamp}@customer-mail.dev`;

    // 1. Create a new client
    await page.goto('/newclient');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);
    await expect(page.getByRole('heading', { name: /Basic Information/i })).toBeVisible({ timeout: 10000 });

    await page.locator('#full_name').fill(customerName);
    await page.locator('#address').fill(address);
    await page.locator('#phone').fill(phone);
    await page.locator('#email').fill(email);

    // Service day = today so it appears on Home
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: todayWeekday() }).click();

    await page.getByRole('button', { name: /Save Client/i }).click();
    await expect(page).toHaveURL(/\/clients/);
    await expect(page.locator('h3', { hasText: customerName })).toBeVisible({ timeout: 10000 });

    // 2. Home should show the new client
    await page.goto('/');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);
    await expect(page.getByRole('heading', { name: /Today's Route/i })).toBeVisible();
    await expect(page.locator('h3', { hasText: customerName })).toBeVisible({ timeout: 10000 });

    // 3. Start service (one-tap card or Start button)
    const customerCard = page.locator('div', { hasText: customerName }).first();
    const startButton = page.getByRole('button', { name: /Start/i }).first();
    if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startButton.click();
    } else {
      await customerCard.click();
    }

    // 4. Fill service log
    await expect(page.getByRole('heading', { name: /Service Log/i })).toBeVisible({ timeout: 10000 });

    // Toggle pH to numeric and enter a value
    await page.getByRole('button', { name: /^Numeric$/i }).nth(0).click();
    await page.getByTestId('ph-numeric-input').fill('7.4');

    // Toggle chlorine to numeric and enter a value
    await page.getByRole('button', { name: /^Numeric$/i }).nth(1).click();
    await page.getByTestId('chlorine-numeric-input').fill('3.0');

    await page.locator('#notes').fill('E2E automated service note');

    // Complete service
    await page.getByRole('button', { name: /Complete Service/i }).click();
    await expect(page).toHaveURL(/\/home/);
    await expect(page.getByRole('heading', { name: /Today's Route/i })).toBeVisible({ timeout: 10000 });

    // 5. Open customer detail and send report
    await page.goto('/clients');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);
    await page.getByRole('heading', { name: customerName }).click();
    await page.getByRole('button', { name: /^View$/i }).click();

    await expect(page.getByRole('heading', { name: customerName })).toBeVisible({ timeout: 10000 });
    await page.getByText(/4 readings/i).click();
    await page.getByRole('button', { name: /Send Report/i }).first().click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByTestId('custom-note-input').fill('Chlorine is high; customer should retest before swimming.');
    await page.getByTestId('email-method-button').click();
    await expect(page.getByTestId('recipient-display')).toContainText(email);

    await context.setOffline(true);
    await expect(page.getByTestId('offline-queue-notice')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('confirm-send-button').click();

    // Assert report reached a terminal status indicator (sent or queued)
    const sentIndicator = page.getByTestId('report-sent-indicator');
    const queuedIndicator = page.getByTestId('report-queued-indicator');
    await expect(sentIndicator.or(queuedIndicator)).toBeVisible({ timeout: 10000 });
    await context.setOffline(false);
  });
});
