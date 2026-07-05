import { expect, test } from '@playwright/test';

test.describe('public pages', () => {
  // 'domcontentloaded': with a dummy Clerk publishable key the async clerk-js
  // script never loads, so waiting for the full 'load' event would hang.
  test('landing page renders the pitch', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('e-Factura API');
    await expect(page.getByRole('link', { name: 'API docs' })).toBeVisible();
    await expect(page.getByText('Your permanent archive')).toBeVisible();
  });

  test('docs page lists the API surface', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'API reference' })).toBeVisible();
    await expect(page.getByText('/api/v1/invoices/{id}', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('QUOTA_EXCEEDED').first()).toBeVisible();
  });

  test('dashboard requires authentication', async ({ request }) => {
    // Clerk's auth.protect() only redirects requests it recognizes as page
    // navigations; anything else gets a 404. Emulate a browser navigation.
    const res = await request.get('/dashboard', {
      maxRedirects: 0,
      headers: { accept: 'text/html', 'sec-fetch-dest': 'document' },
    });
    expect([302, 307]).toContain(res.status());
    // Local sign-in page, or Clerk's hosted/handshake URL depending on the key type.
    expect(res.headers()['location'] ?? '').toMatch(/sign-in|clerk/);
  });
});
