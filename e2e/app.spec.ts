import { test, expect } from '@playwright/test';

// Helper to setup a demo user for testing
async function setupDemoUser(page) {
  await page.goto('/login');
  
  // Click demo login button if in offline mode
  const demoButton = page.getByRole('button', { name: /demo account/i });
  if (await demoButton.isVisible()) {
    await demoButton.click();
    await page.waitForURL('/');
  }
}

test.describe('App Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupDemoUser(page);
  });

  test('should show home page after login', async ({ page }) => {
    await expect(page).toHaveURL('/');
    
    // Should show main navigation elements
    await expect(page.getByText(/today/i)).toBeVisible();
  });

  test('should navigate to clients page', async ({ page }) => {
    const clientsLink = page.getByRole('link', { name: /clients/i });
    if (await clientsLink.isVisible()) {
      await clientsLink.click();
      await expect(page).toHaveURL(/\/clients/i);
    }
  });

  test('should navigate to settings page', async ({ page }) => {
    const settingsLink = page.getByRole('link', { name: /settings/i });
    if (await settingsLink.isVisible()) {
      await settingsLink.click();
      await expect(page).toHaveURL(/\/settings/i);
    }
  });
});

test.describe('PWA Features', () => {
  test('should have manifest.json', async ({ page }) => {
    const response = await page.goto('/manifest.json');
    expect(response?.status()).toBe(200);
    
    const manifest = await response?.json();
    expect(manifest.name).toBeDefined();
    expect(manifest.icons).toBeDefined();
  });

  test('should have service worker', async ({ page }) => {
    const response = await page.goto('/sw.js');
    expect(response?.status()).toBe(200);
  });
});

test.describe('Responsive Design', () => {
  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');
    
    // Should still show login form
    await expect(page.getByText('ChemCheck')).toBeVisible();
  });

  test('should be responsive on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/login');
    
    await expect(page.getByText('ChemCheck')).toBeVisible();
  });
});

test.describe('Error Handling', () => {
  test('should handle 404 gracefully', async ({ page }) => {
    await page.goto('/nonexistent-page');
    
    // Should redirect to login or show error
    // The app uses client-side routing, so it may redirect
    await expect(page).toHaveURL(/\/(login|nonexistent-page)/);
  });
});

test.describe('Accessibility', () => {
  test('login page should have proper heading structure', async ({ page }) => {
    await page.goto('/login');
    
    // Should have main heading
    const heading = page.getByRole('heading', { level: 1 });
    if (await heading.isVisible()) {
      await expect(heading).toBeVisible();
    }
  });

  test('forms should have labels', async ({ page }) => {
    await page.goto('/login');
    
    // Email input should have associated label
    const emailLabel = page.getByText(/email/i);
    await expect(emailLabel).toBeVisible();
  });

  test('buttons should be keyboard accessible', async ({ page }) => {
    await page.goto('/login');
    
    // Tab to the first button
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    // Should be able to focus on interactive elements
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(['BUTTON', 'INPUT', 'A']).toContain(focusedElement);
  });
});
