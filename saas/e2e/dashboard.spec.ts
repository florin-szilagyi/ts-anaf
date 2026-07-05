import { expect, test, type Page } from '@playwright/test';
import { HAS_CLERK } from './support/env';

/**
 * Clerk-authenticated dashboard flows. These only run when a Clerk dev
 * instance is wired up via env:
 *   CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
 *   E2E_CLERK_USER_EMAIL, E2E_CLERK_USER_PASSWORD
 * Otherwise the whole file reports as skipped.
 */

test.describe('dashboard (Clerk)', () => {
  test.skip(!HAS_CLERK, 'Clerk e2e env not configured (see saas/README.md)');
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const { setupClerkTestingToken } = await import('@clerk/testing/playwright');
    await setupClerkTestingToken({ page });
    await signIn(page);
  });

  test('overview renders the quota card', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Live invoices today')).toBeVisible();
    await expect(page.getByText('ANAF connection')).toBeVisible();
  });

  test('API keys: create shows the secret once, then revoke', async ({ page }) => {
    await page.goto('/dashboard/api-keys');
    await page.getByPlaceholder('production backend').fill('e2e ui key');
    await page.getByRole('button', { name: 'Create key' }).click();

    await expect(page.getByText('Copy this key now')).toBeVisible();
    const secret = await page
      .locator('code', { hasText: /^sk_test_/ })
      .first()
      .textContent();
    expect(secret).toMatch(/^sk_test_[A-Za-z0-9_-]{43}$/);
    await page.getByRole('button', { name: 'done' }).click();

    page.once('dialog', (d) => void d.accept());
    await page
      .getByRole('row', { name: /e2e ui key/ })
      .getByRole('button', { name: 'Revoke' })
      .click();
    await expect(page.getByRole('row', { name: /e2e ui key/ }).getByText('revoked')).toBeVisible();
  });

  test('companies: invalid CUI shows an inline error', async ({ page }) => {
    await page.goto('/dashboard/companies');
    await page.getByPlaceholder('CUI (e.g. RO12345678)').fill('not-a-cui');
    await page.getByRole('button', { name: 'Add company' }).click();
    await expect(page.getByText('CUI must be 2–10 digits')).toBeVisible();
  });

  test('invoices page renders with a new-invoice entry point', async ({ page }) => {
    await page.goto('/dashboard/invoices');
    await expect(page.getByRole('link', { name: 'New invoice' })).toBeVisible();
  });

  test('archive page has the refresh button', async ({ page }) => {
    await page.goto('/dashboard/archive');
    await expect(page.getByRole('button', { name: 'Refresh archive' })).toBeVisible();
  });
});

async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('input[name="identifier"]').fill(process.env.E2E_CLERK_USER_EMAIL ?? '');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('input[name="password"]').fill(process.env.E2E_CLERK_USER_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL('**/dashboard**');
}
