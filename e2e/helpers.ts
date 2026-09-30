import { Page, expect, test } from '@playwright/test';

/**
 * Authenticated specs need the dev-server auth bypass. Locally that is an
 * optional setup, so the spec skips with a clear message. Under CI the bypass
 * is required (the workflow sets VITE_ENABLE_LOCALHOST_AUTH_BYPASS=true), so a
 * missing bypass is a broken pipeline and the spec fails instead of skipping.
 */
export function skipLocallyOrFailInCi(reason: string): never {
  const isCi = !!process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0';
  if (isCi) {
    throw new Error(
      `${reason}. CI=${process.env.CI} so this spec must not be skipped: ` +
        'enable the auth bypass for the E2E dev server (VITE_ENABLE_LOCALHOST_AUTH_BYPASS=true) or fix the login flow.',
    );
  }
  test.skip(true, `${reason} (skipped locally; this would fail under CI)`);
  // test.skip throws; this keeps the return type honest for callers.
  throw new Error(reason);
}

export async function waitForAuthShellToSettle(page: Page): Promise<void> {
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

  // In dev auth-bypass mode, auth routes can redirect after initial paint.
  // Wait for pathname to settle before route-based assertions.
  let lastPath = new URL(page.url()).pathname;
  let stableCycles = 0;
  const maxCycles = 30;

  for (let i = 0; i < maxCycles; i++) {
    await page.waitForTimeout(100);
    const currentPath = new URL(page.url()).pathname;
    if (currentPath === lastPath) {
      stableCycles += 1;
      if (stableCycles >= 3) break;
    } else {
      lastPath = currentPath;
      stableCycles = 0;
    }
  }
}

export function getPathname(page: Page): string {
  return new URL(page.url()).pathname;
}

export async function isOnLoginRoute(page: Page): Promise<boolean> {
  return getPathname(page).startsWith('/login');
}

export async function isOnAppShell(page: Page): Promise<boolean> {
  return page.getByRole('heading', { name: /Today's Route/i }).isVisible({ timeout: 1000 }).catch(() => false);
}

export async function setupDemoUser(page: Page): Promise<void> {
  await page.goto('/');
  await waitForAuthShellToSettle(page);

  if (await isOnLoginRoute(page)) {
    const demoButton = page.getByRole('button', { name: /demo account/i });
    if (await demoButton.isVisible().catch(() => false)) {
      await demoButton.click();
      await waitForAuthShellToSettle(page);
    }
  }
}

export function todayServiceDay(): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
}

/**
 * Query the local IndexedDB customer count. Used to assert account deletion
 * cleared on-device data.
 */
export async function getIndexedDbCustomerCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    try {
      const mod = await import('/src/db/chemcheck-db.ts');
      return await mod.db.customers.count();
    } catch {
      return 0;
    }
  });
}

/**
 * Query the local IndexedDB for a customer by exact full name.
 */
export async function getIndexedDbCustomerCountByName(page: Page, fullName: string): Promise<number> {
  return page.evaluate(async (name) => {
    try {
      const mod = await import('/src/db/chemcheck-db.ts');
      return await mod.db.customers.where('full_name').equals(name).count();
    } catch {
      return 0;
    }
  }, fullName);
}
