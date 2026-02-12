import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', msg => {
  console.log('[console]', msg.type(), msg.text());
});
page.on('pageerror', err => {
  console.log('[pageerror]', err.message);
  console.log(err.stack || '');
});
page.on('requestfailed', req => {
  console.log('[requestfailed]', req.url(), req.failure()?.errorText || 'unknown');
});

await page.goto('http://localhost:5173/report/c3ad2d7d-f5c2-41db-8f90-8a03b7f7e266', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/report-debug.png', fullPage: true });

await browser.close();
