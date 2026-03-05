import { expect, test } from '@playwright/test';

test.describe('Dashboard', () => {
  test('shows login prompt when not authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Should show login required message or redirect to auth
    await expect(page.locator('text=Login').or(page.locator('text=auth'))).toBeVisible({ timeout: 5000 });
  });
});

test.describe('History', () => {
  test('shows history page with filters', async ({ page }) => {
    await page.goto('/history');
    
    // Should show history title
    await expect(page.locator('text=History')).toBeVisible();
    
    // Should have status filter chips
    await expect(page.locator('text=All')).toBeVisible();
    await expect(page.locator('text=Completed')).toBeVisible();
    await expect(page.locator('text=Error')).toBeVisible();
  });
});

test.describe('Analytics', () => {
  test('shows analytics page with stats', async ({ page }) => {
    await page.goto('/analytics');
    
    // Should show analytics cards
    await expect(page.locator('text=Success rate')).toBeVisible();
    await expect(page.locator('text=Filament used')).toBeVisible();
  });
});

test.describe('Settings', () => {
  test('shows settings page', async ({ page }) => {
    await page.goto('/settings');
    
    // Should show settings sections
    await expect(page.locator('text=Settings')).toBeVisible();
  });
});

test.describe('Mobile viewport', () => {
  test.use({ viewport: { width: 375, height: 667 } });
  
  test('dashboard renders on mobile', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Page should render without horizontal scroll
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 10);
  });
});
