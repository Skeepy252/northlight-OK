const { test, expect } = require('@playwright/test');
const PW = 'NorthlightDemo-Only-2026'; // public demo password (see README)

async function login(page, email, pw = PW) {
  await page.goto('staff.html');
  await expect(page.locator('#login-btn')).toBeEnabled({ timeout: 20000 });
  await page.fill('#l-email', email);
  await page.fill('#l-pw', pw);
  await page.click('#login-btn');
  await expect(page.locator('#m-code')).toBeVisible();
  await page.fill('#m-code', (await page.locator('#demo-code').textContent()).trim());
  await page.click('#mfa-btn');
}

test.describe('staff & identity demo', () => {
  test('RFC 6238 TOTP test vector', async ({ page }) => {
    await page.goto('staff.html');
    const code = await page.evaluate(async () => {
      const secret = NL.crypto.base32Encode(new TextEncoder().encode('12345678901234567890'));
      return NL.crypto.totp(secret, 59000, 8);
    });
    expect(code).toBe('94287082');
  });

  test('IT admin signs in with password + TOTP and sees admin panel', async ({ page }) => {
    await login(page, 'jordan.lee@northlight.example');
    await expect(page.locator('#whoami')).toHaveText('Jordan Lee');
    await expect(page.locator('#admin-panel')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'Maya Chen' }).first()).toBeVisible();
  });

  test('wrong password and wrong TOTP are rejected', async ({ page }) => {
    await page.goto('staff.html');
    await expect(page.locator('#login-btn')).toBeEnabled({ timeout: 20000 });
    await page.fill('#l-email', 'jordan.lee@northlight.example');
    await page.fill('#l-pw', 'wrong-password');
    await page.click('#login-btn');
    await expect(page.locator('#login-form')).toContainText('Sign-in failed');
    await page.fill('#l-email', 'jordan.lee@northlight.example');
    await page.fill('#l-pw', PW);
    await page.click('#login-btn');
    await page.fill('#m-code', '000000');
    await page.click('#mfa-btn');
    await expect(page.locator('#m-code-error')).toContainText('Incorrect');
  });

  test('empty login shows validation messages', async ({ page }) => {
    await page.goto('staff.html');
    await expect(page.locator('#login-btn')).toBeEnabled({ timeout: 20000 });
    await page.click('#login-btn');
    await expect(page.locator('#l-email-error')).toContainText('Enter your email');
    await expect(page.locator('#l-pw-error')).toContainText('Enter your password');
  });

  test('passwords are not stored in plain text', async ({ page }) => {
    await page.goto('staff.html');
    await expect(page.locator('#login-btn')).toBeEnabled({ timeout: 20000 });
    const raw = await page.evaluate(() => localStorage.getItem('northlight.v1.state'));
    expect(raw).not.toContain('NorthlightDemo-Only-2026');
    expect(raw).toContain('PBKDF2-SHA256');
  });

  test('Sales user does not see IT administration (UI demo only)', async ({ page }) => {
    await login(page, 'alex.rivera@northlight.example');
    await expect(page.locator('#sales-panel')).toBeVisible();
    await expect(page.locator('#admin-panel')).toHaveCount(0);
    await expect(page.getByText('IT administration')).toHaveCount(0);
  });

  test('joiner persists after reload; leaver cannot sign in', async ({ page }) => {
    await login(page, 'jordan.lee@northlight.example');
    await page.click('#joiner-form button[type=submit]');
    await expect(page.locator('#j-name-error')).toBeVisible();
    await page.fill('#j-name', 'Riley Stone'); await page.fill('#j-email', 'riley.stone@northlight.example'); await page.fill('#j-title', 'Account Executive');
    await page.selectOption('#j-dept', 'Sales'); await page.selectOption('#j-role', 'sales');
    await page.click('#joiner-form button[type=submit]');
    await expect(page.locator('#joiner-result')).toContainText('Riley Stone');
    await page.reload();
    await expect(page.locator('#staff-app')).toContainText('Riley Stone');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Mark Alex Rivera as leaver' }).click();
    await expect(page.getByRole('button', { name: 'Mark Alex Rivera as leaver' })).toHaveCount(0);
    await page.click('#logout');
    await page.fill('#l-email', 'alex.rivera@northlight.example');
    await page.fill('#l-pw', PW);
    await page.click('#login-btn');
    await expect(page.locator('#login-form')).toContainText('disabled');
    await expect(page.locator('#m-code')).toHaveCount(0);
    // record preserved
    await page.goto('helpdesk.html');
    await expect(page.locator('#ticket-list')).toContainText('Leaver: collect equipment');
  });
});
