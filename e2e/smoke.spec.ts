import { expect, test, type Page } from '@playwright/test';

function trackCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

test.describe('security headers', () => {
  test('pages carry a strict nonce CSP and the required headers', async ({ page }) => {
    const res = await page.goto('/login');
    expect(res?.status()).toBe(200);
    const h = res!.headers();
    const csp = h['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self' https://example.sharepoint.com");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(h['strict-transport-security']).toContain('max-age=63072000');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['permissions-policy']).toContain('camera=(self)');
    expect(h['x-powered-by']).toBeUndefined();
  });

  test('every page load gets a fresh nonce', async ({ request }) => {
    const a = (await request.get('/login')).headers()['content-security-policy'];
    const b = (await request.get('/login')).headers()['content-security-policy'];
    expect(a).not.toEqual(b);
  });

  test('API responses are not cacheable', async ({ request }) => {
    const res = await request.post('/api/uploads/start', { data: {} });
    expect(res.headers()['cache-control']).toContain('no-store');
  });
});

test.describe('public pages render without CSP violations', () => {
  for (const path of ['/login', '/admin/signin']) {
    test(path, async ({ page }) => {
      const violations = trackCspViolations(page);
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(violations).toEqual([]);
      // No horizontal scrolling on phones.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('route protection', () => {
  test('client pages redirect to sign in', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/request/00000000-0000-4000-8000-000000000001');
    await expect(page).toHaveURL(/\/login\?next=%2Frequest%2F/);
  });

  test('admin pages redirect to admin sign in', async ({ page }) => {
    await page.goto('/admin/clients');
    await expect(page).toHaveURL(/\/admin\/signin\?next=%2Fadmin%2Fclients/);
  });

  test('client and admin APIs refuse requests without a session', async ({ request }) => {
    expect((await request.post('/api/uploads/start', { data: {} })).status()).toBe(401);
    expect((await request.post('/api/uploads/complete', { data: {} })).status()).toBe(401);
    expect((await request.get('/api/admin/folders')).status()).toBe(401);
  });

  test('forged session cookies are rejected', async ({ request, baseURL }) => {
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        aid: '00000000-0000-4000-8000-000000000001',
        email: 'aleida@quailhollowaccounting.com',
        name: 'X',
        iat: Date.now(),
        lat: Date.now(),
      }),
    ).toString('base64url');
    const res = await request.get('/api/admin/folders', {
      headers: { cookie: `__Host-qh_as=${forged}.AAAA; qh_as=${forged}.AAAA`, origin: baseURL! },
    });
    expect(res.status()).toBe(401);
  });

  test('state-changing endpoints reject other origins', async ({ request }) => {
    const evil = { origin: 'https://evil.example' };
    expect(
      (
        await request.post('/api/auth/otp/request', {
          headers: evil,
          data: { email: 'a@example.com' },
        })
      ).status(),
    ).toBe(403);
    expect((await request.post('/api/auth/otp/verify', { headers: evil, data: {} })).status()).toBe(
      403,
    );
    expect((await request.post('/api/auth/logout', { headers: evil })).status()).toBe(403);
  });

  test('robots are told not to index the portal', async ({ request }) => {
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /');
  });
});

test.describe('sign-in form', () => {
  test('validates the email and moves to the code step', async ({ page }) => {
    await page.route('**/api/auth/otp/request', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
    );
    await page.route('**/api/auth/otp/verify', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: '{"error":"invalid_code"}',
      }),
    );
    await page.goto('/login');
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByText('Please enter a valid email address.')).toBeVisible();

    await page.getByLabel('Email address').fill('test.client@example.com');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    const code = page.getByLabel('Enter your code');
    await expect(code).toBeVisible();
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await expect(page.getByRole('button', { name: /Send a new code in/ })).toBeDisabled();

    await code.fill('123456');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/That code is not right or has expired/)).toBeVisible();
  });

  test('shows a clear message when rate limited', async ({ page }) => {
    await page.route('**/api/auth/otp/request', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: '{"error":"rate_limited"}',
      }),
    );
    await page.goto('/login');
    await page.getByLabel('Email address').fill('test.client@example.com');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByText(/Too many attempts/)).toBeVisible();
  });

  test('the office phone number is a tappable link', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: '352-723-5062' })).toHaveAttribute(
      'href',
      'tel:+13527235062',
    );
  });
});
