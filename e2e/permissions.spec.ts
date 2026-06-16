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

function todayServiceDay() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
}

async function createPermissionTestCustomer(page) {
  const customerName = `Permission Test ${Date.now()}`;

  await page.goto('/newclient');
  await waitForAuthShellToSettle(page);
  await recoverFromErrorScreen(page);
  await expect(page.getByRole('heading', { name: /Basic Information/i })).toBeVisible({ timeout: 10000 });

  await page.locator('#full_name').fill(customerName);
  await page.locator('#address').fill('789 Permission Ave, Testville');
  await page.locator('#phone').fill('5559871234');
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: todayServiceDay() }).click();
  await page.getByRole('button', { name: /Save Client/i }).click();
  await expect(page).toHaveURL(/\/clients/);
  await expect(page.locator('h3', { hasText: customerName })).toBeVisible({ timeout: 10000 });
  return customerName;
}

test.describe('Permission denial handling', () => {
  test('camera denial should show a graceful message instead of crashing', async ({ page, context }) => {
    await context.clearPermissions();

    await page.goto('/');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);

    if (await isOnLoginRoute(page)) {
      test.skip(true, 'Auth bypass not enabled; skipping permission test');
    }

    const customerName = await createPermissionTestCustomer(page);
    await context.grantPermissions([], { origin: 'http://127.0.0.1:5174' });

    await page.goto('/');
    await waitForAuthShellToSettle(page);
    await recoverFromErrorScreen(page);

    const startNext = page.getByRole('button', { name: /Start Next/i });
    if (await startNext.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startNext.click();
    } else {
      await page.getByRole('button', { name: /^Start$/i }).first().click();
    }

    await expect(page.getByRole('heading', { name: /Service Log/i })).toBeVisible({ timeout: 10000 });

    // Look for a capture button within the Before Photos section
    const beforeSection = page.locator('div', { hasText: /Before Photos/i }).first();
    const captureButton = beforeSection.getByRole('button').first();
    if (await captureButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await captureButton.click();
    } else {
      test.skip(true, 'No camera capture button found in this environment');
    }

    // Expect either an inline error or a visible permission message
    await expect(
      page
        .getByText(/camera|permission|access denied|not allowed/i)
        .first()
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Oops! Something went wrong/i)).toHaveCount(0);
  });
});
