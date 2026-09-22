import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupDemoUser, waitForAuthShellToSettle } from './helpers';

const fixturePath = path.resolve('artifacts/lsi-screenshots/aquachek-synthetic-strip.jpg');

test.use({ viewport: { width: 390, height: 844 } });

test.describe('AquaChek daily-log dogfood', () => {
  test('decodes a real image, previews uncertainty, and persists the audited scan', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await setupDemoUser(page);

    const customerName = `AquaChek Dogfood ${Date.now()}`;
    await page.goto('/newclient');
    await waitForAuthShellToSettle(page);
    await expect(page.getByRole('heading', { name: /Basic Information/i })).toBeVisible();
    await page.locator('#full_name').fill(customerName);
    await page.locator('#address').fill('100 Calibration Way, Test City, FL');
    await page.getByRole('button', { name: /Save Client/i }).click();
    await expect(page).toHaveURL(/\/clients/);
    await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
    const customerId = await page.evaluate(async (name) => {
      const { db } = await import('/src/db/chemcheck-db.ts');
      return (await db.customers.toArray()).find((customer) => customer.full_name === name)?.id ?? null;
    }, customerName);
    expect(customerId).not.toBeNull();
    await page.goto(`/newservicelog?customerId=${encodeURIComponent(String(customerId))}`);
    await waitForAuthShellToSettle(page);

    await expect(page.getByRole('heading', { name: /Service Log/i })).toBeVisible();
    await page.getByRole('button', { name: /Expand AquaChek 7 and LSI/i }).click();
    await page.getByLabel(/Take strip photo/i).setInputFiles(fixturePath);
    await expect(page.getByText('Most probable LSI')).toBeVisible();
    await expect(page.getByText(/Likely strip range/i)).toBeVisible();
    await expect(page.getByText(/Photo quality verified/i)).toBeVisible();
    await page.getByText('Most probable LSI').scrollIntoViewIfNeeded();

    const stripResult = page.locator('section[aria-labelledby="strip-result-title"]');
    const completeServiceBar = page.getByRole('button', { name: /Complete Service/i }).locator('..');
    const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
    const [stripResultBox, completeServiceBox, primaryNavigationBox] = await Promise.all([
      stripResult.boundingBox(),
      completeServiceBar.boundingBox(),
      primaryNavigation.boundingBox(),
    ]);
    expect(stripResultBox, 'strip result should be rendered').not.toBeNull();
    expect(completeServiceBox, 'Complete Service bar should be visible').not.toBeNull();
    expect(primaryNavigationBox, 'bottom navigation should be visible').not.toBeNull();
    const actionOverlap = Math.min(
      stripResultBox!.y + stripResultBox!.height,
      completeServiceBox!.y + completeServiceBox!.height,
    ) - Math.max(stripResultBox!.y, completeServiceBox!.y);
    expect(actionOverlap, 'Complete Service bar must not cover strip-result controls').toBeLessThanOrEqual(0);
    const actionBarIsInViewport = completeServiceBox!.y < 844 && completeServiceBox!.y + completeServiceBox!.height > 0;
    if (actionBarIsInViewport) {
      expect(
        completeServiceBox!.y + completeServiceBox!.height,
        'Complete Service bar must remain above the bottom navigation',
      ).toBeLessThanOrEqual(primaryNavigationBox!.y + 1);
    }

    const screenshot = await page.screenshot({
      path: path.resolve('output/playwright/aquachek-mobile-layout.png'),
      animations: 'disabled',
    });
    const screenshotScale = await page.evaluate(() => ({
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    }));
    expect(
      screenshot.readUInt32BE(20),
      'feature screenshot should match the phone viewport at the browser device scale',
    ).toBe(Math.round(screenshotScale.height * screenshotScale.devicePixelRatio));
    await stripResult.screenshot({
      path: path.resolve('output/playwright/aquachek-dogfood-result.png'),
      animations: 'disabled',
    });

    await page.getByRole('button', { name: /Use probable readings/i }).click();
    await expect(page.getByText(/saved with this daily log/i)).toBeVisible();
    await page.getByRole('button', { name: /Complete Service/i }).click();
    await expect(page).toHaveURL(/\/(home|clients)/);
    await waitForAuthShellToSettle(page);

    const savedLog = await page.evaluate(async (name) => {
      const { db } = await import('/src/db/chemcheck-db.ts');
      const customer = (await db.customers.toArray()).find((candidate) => candidate.full_name === name);
      if (!customer) return null;
      const logs = await db.serviceLogs.toArray();
      return logs
        .filter((log) => String(log.customer_id) === String(customer.id))
        .sort((left, right) => Number(right.created_at ?? 0) - Number(left.created_at ?? 0))[0] ?? null;
    }, customerName);

    expect(savedLog).toMatchObject({
      strip_scan_method: 'aquachek_select_photo',
      strip_scan_analysis_version: 'aquachek-select-v3',
      hardness_source: 'aquachek_total',
      hardness_value: 250,
      total_chlorine_value: 3,
      chlorine_value: 3,
      ph_value: 7.2,
      alkalinity_value: 120,
      stabilizer_value: 100,
      water_temperature: 80,
      water_temperature_source: 'assumed',
      tds_value: 1000,
      tds_source: 'assumed',
    });
    expect(savedLog?.strip_scan_pad_confidence?.ph).toBeGreaterThan(0);
    expect(savedLog?.strip_scan_quality?.framing).toBeGreaterThan(0);

    await page.goto('/lsi');
    await waitForAuthShellToSettle(page);
    await expect(page.getByRole('heading', { name: 'LSI history' })).toBeVisible();
    const customerHistory = page.getByRole('button', { name: new RegExp(customerName) });
    await expect(customerHistory).toContainText('-0.42');
    await customerHistory.click();
    await expect(page.getByText('Latest calculated visit')).toBeVisible();
    await expect(page.getByText('-0.42', { exact: true }).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
