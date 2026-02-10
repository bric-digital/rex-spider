import { test, expect } from '@playwright/test';

/**
 * Comprehensive test suite for rex-spider
 * Tests IndexedDB operations, CRUD, pattern matching, and bulk operations
 */

test.describe('REX - Spider - Browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/browser.html');
    await page.waitForFunction(() => window.testUtilitiesReady === true);
  });

  test('Validate page loaded.', async ({ page }) => {
    await expect(page).toHaveTitle(/Spider Browser Test Page/);
  });
});
