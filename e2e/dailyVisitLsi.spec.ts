import { test, expect } from '@playwright/test';
import { setupDemoUser, waitForAuthShellToSettle } from './helpers';

const todayWeekday = () => new Date().toLocaleDateString('en-US', { weekday: 'long' });

test.use({ viewport: { width: 390, height: 844 } });

test('normal daily visit with detailed manual LSI entry stays intact', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await setupDemoUser(page);

  const customerName = `Release Dogfood ${Date.now()}`;
  await page.goto('/newclient');
  await waitForAuthShellToSettle(page);
  await expect(page.getByRole('heading', { name: /Basic Information/i })).toBeVisible();
  await page.locator('#full_name').fill(customerName);
  await page.locator('#address').fill('123 Test Lane, Tucson, AZ');
  await page.locator('#phone').fill('5205550100');
  await page.locator('#email').fill(`e2e+${Date.now()}@customer-mail.dev`);
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: todayWeekday() }).click();
  await page.getByRole('button', { name: /Save Client/i }).click();
  await expect(page).toHaveURL(/\/clients/);

  // Clients page defaults to the Mon tab; switch to today's tab before asserting.
  await page.getByRole('tab', { name: new RegExp(todayWeekday().slice(0, 3), 'i') }).click();
  await expect(page.getByRole('button', { name: new RegExp(customerName) })).toBeVisible({ timeout: 10000 });

  await page.goto('/');
  await waitForAuthShellToSettle(page);
  await expect(page.getByRole('heading', { name: /Today's Route/i })).toBeVisible();
  await expect(page.getByText(customerName).first()).toBeVisible({ timeout: 10000 });

  const startButton = page.getByRole('button', { name: /Start/i }).first();
  if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await startButton.click();
  } else {
    await page.locator('div', { hasText: customerName }).first().click();
  }

  await expect(page.getByRole('heading', { name: /Service Log/i })).toBeVisible({ timeout: 10000 });

  // Ordinary numeric chemistry, untouched by the feature.
  const enterNumeric = async (nth: number, testId: string, value: string) => {
    await page.getByRole('tab', { name: /^Numeric$/i }).nth(nth).click();
    const input = page.getByTestId(testId);
    await input.fill(value);
    await expect(input).toHaveValue(value);
  };
  await enterNumeric(0, 'ph-numeric-input', '7.4');
  await enterNumeric(1, 'chlorine-numeric-input', '3.0');
  await enterNumeric(2, 'alkalinity-numeric-input', '100');
  await enterNumeric(3, 'stabilizer-numeric-input', '50');

  // Detailed manual LSI entry: exercises value/source pairing end to end.
  await page.getByRole('button', { name: /Expand AquaChek 7 and LSI/i }).click();
  await page.getByRole('button', { name: /Enter detailed LSI readings/i }).click();
  await page.getByText('Detailed', { exact: true }).click();
  await page.locator('#lsi-hardness').fill('350');
  await page.locator('#lsi-temperature').fill('82');
  await page.locator('#lsi-tds').fill('900');
  const lsiResult = page.getByRole('status').filter({ hasText: /calculation/i });
  await expect(lsiResult).toBeVisible({ timeout: 5000 });
  await expect(lsiResult).toContainText('Detailed calculation');

  // Fully collapse the feature so the main page stays lean, then finish.
  await page.getByRole('button', { name: /Collapse LSI details/i }).click();
  await expect(page.getByRole('button', { name: /Adjust LSI details/i })).toBeVisible();
  await page.getByRole('button', { name: /Collapse AquaChek 7 and LSI/i }).click();
  await expect(page.getByRole('button', { name: /Expand AquaChek 7 and LSI/i })).toBeVisible();

  await page.locator('#notes').fill('Release dogfood note');
  await page.getByRole('button', { name: /Complete Service/i }).click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole('heading', { name: /Today's Route/i })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/1 of 1 stops logged/i).first()).toBeVisible({ timeout: 10000 });

  expect(pageErrors, 'zero browser errors during normal daily visit').toEqual([]);
});
