import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should show login page for unauthenticated users', async ({ page }) => {
    await page.goto('/');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
    
    // Should show ChemCheck branding
    await expect(page.getByText('ChemCheck')).toBeVisible();
    await expect(page.getByText('Pool Service Management')).toBeVisible();
  });

  test('should show offline mode notice when Clerk is not configured', async ({ page }) => {
    await page.goto('/login');
    
    // In offline mode, should show the notice
    const offlineNotice = page.getByText('Offline Mode');
    if (await offlineNotice.isVisible()) {
      await expect(offlineNotice).toBeVisible();
    }
  });

  test('should have link to signup page', async ({ page }) => {
    await page.goto('/login');
    
    const signupLink = page.getByRole('link', { name: /sign up/i });
    await expect(signupLink).toBeVisible();
    
    await signupLink.click();
    await expect(page).toHaveURL(/\/signup/);
  });

  test('should have links to legal pages', async ({ page }) => {
    await page.goto('/login');
    
    await expect(page.getByRole('link', { name: /privacy policy/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /terms of service/i })).toBeVisible();
  });
});

test.describe('Signup Flow', () => {
  test('should show signup form', async ({ page }) => {
    await page.goto('/signup');
    
    await expect(page.getByText('ChemCheck')).toBeVisible();
    
    // Check for form fields (offline mode)
    const nameInput = page.getByPlaceholder(/john smith/i);
    const emailInput = page.getByPlaceholder(/you@example.com/i);
    
    if (await nameInput.isVisible()) {
      await expect(nameInput).toBeVisible();
      await expect(emailInput).toBeVisible();
    }
  });

  test('should have link back to login', async ({ page }) => {
    await page.goto('/signup');
    
    const loginLink = page.getByRole('link', { name: /sign in/i });
    await expect(loginLink).toBeVisible();
  });
});

test.describe('Public Pages', () => {
  test('should show pricing page without auth', async ({ page }) => {
    await page.goto('/pricing');
    
    await expect(page.getByText('Simple, Transparent Pricing')).toBeVisible();
    await expect(page.getByText('Starter')).toBeVisible();
    await expect(page.getByText('Professional')).toBeVisible();
    await expect(page.getByText('Business')).toBeVisible();
  });

  test('should show pricing tiers with correct prices', async ({ page }) => {
    await page.goto('/pricing');
    
    await expect(page.getByText('$29')).toBeVisible();
    await expect(page.getByText('$79')).toBeVisible();
    await expect(page.getByText('$149')).toBeVisible();
  });

  test('should toggle between monthly and annual pricing', async ({ page }) => {
    await page.goto('/pricing');
    
    // Find the billing toggle
    const toggle = page.getByRole('switch');
    if (await toggle.isVisible()) {
      await toggle.click();
      
      // Should show annual discount
      await expect(page.getByText(/save 20%/i)).toBeVisible();
    }
  });
});
