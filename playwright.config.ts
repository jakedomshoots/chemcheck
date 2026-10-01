import { existsSync, readdirSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const host = process.env.PLAYWRIGHT_HOST || '127.0.0.1';
const port = Number(process.env.PLAYWRIGHT_PORT || 5174);
const baseURL = `http://${host}:${port}`;

type BrowserFamily = 'chromium' | 'firefox' | 'webkit';

const allProjects: Array<{ name: string; family: BrowserFamily; use: Record<string, unknown> }> = [
  { name: 'chromium', family: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', family: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', family: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'Mobile Chrome', family: 'chromium', use: { ...devices['Pixel 5'] } },
  { name: 'Mobile Safari', family: 'webkit', use: { ...devices['iPhone 12'] } },
  { name: 'iPad', family: 'webkit', use: { ...devices['iPad (gen 7)'] } },
  { name: 'offline', family: 'chromium', use: { ...devices['Desktop Chrome'], offline: true } },
];

/**
 * When PLAYWRIGHT_BROWSERS_PATH points at a custom browser store (sandboxes,
 * minimal CI images), only the browser families actually installed there are
 * run so a missing Firefox/WebKit does not fail the whole suite. The default
 * cache location and PLAYWRIGHT_ALL_PROJECTS=true keep the full matrix.
 */
function installedFamilies(): Set<BrowserFamily> | null {
  if (process.env.PLAYWRIGHT_ALL_PROJECTS === 'true') return null;
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!dir || dir === '0' || !existsSync(dir)) return null;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const has = (prefix: string) => entries.some((entry) => entry.startsWith(prefix));
  const families = new Set<BrowserFamily>();
  if (has('chromium')) families.add('chromium');
  if (has('firefox')) families.add('firefox');
  if (has('webkit')) families.add('webkit');
  return families.size > 0 ? families : null;
}

const families = installedFamilies();
const projects = allProjects
  .filter((project) => !families || families.has(project.family))
  .map(({ name, use }) => ({ name, use }));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects,
  webServer: {
    command: `PLAYWRIGHT_E2E=true npm run dev -- --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
