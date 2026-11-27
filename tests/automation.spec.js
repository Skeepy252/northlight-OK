const { test, expect } = require('@playwright/test');

test.describe('automation dashboard', () => {
  test('shows status, rules, health and records website enquiries', async ({ page }) => {
    await page.goto('./');
    await page.fill('#c-name', 'Dee Ray'); await page.fill('#c-email', 'dee@ray.example'); await page.fill('#c-company', 'Ray Works');
    await page.selectOption('#c-service', 'Creative Campaigns'); await page.selectOption('#c-urgency', 'urgent'); await page.fill('#c-desc', 'Need a launch visual quickly.');
    await page.click('#enquiry-submit');
    await expect(page.locator('#enquiry-success')).toBeVisible();
    await page.goto('automation.html');
    await expect(page.locator('#status-text')).toHaveText('Active');
    await expect(page.locator('#auto-rules tbody tr')).toHaveCount(5);
    await expect(page.locator('#auto-outbox')).toContainText('URGENT enquiry from Dee Ray');
    await expect(page.locator('#auto-outbox')).toContainText('Simulated (not sent)');
    await expect(page.locator('#auto-log')).toContainText('R4-urgent-alert');
    await expect(page.locator('#auto-health')).toContainText('1.0.0');
  });

  test('rules can be disabled; core rules cannot', async ({ page }) => {
    await page.goto('automation.html');
    await expect(page.getByRole('button', { name: 'Disable R1-create-lead' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Disable R3-urgent-priority' }).click();
    await expect(page.getByRole('button', { name: 'Enable R3-urgent-priority' })).toBeVisible();
    await page.click('#run-urgent');
    await expect(page.locator('#auto-result')).toContainText('(P3)'); // escalation rule disabled
    await page.reload();
    await expect(page.getByRole('button', { name: 'Enable R3-urgent-priority' })).toBeVisible(); // persisted
  });

  test('config failure shows an error, not success', async ({ page }) => {
    await page.route('**/rules.json', (r) => r.fulfill({ status: 500, body: 'x' }));
    await page.goto('automation.html');
    await expect(page.locator('#auto-status .alert-error')).toContainText('NOT active');
    await page.click('#run-standard');
    await expect(page.locator('#auto-result .alert-error')).toBeVisible();
  });
});
