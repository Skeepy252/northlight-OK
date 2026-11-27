const { test, expect } = require('@playwright/test');

test.describe('help desk', () => {
  test.beforeEach(async ({ page }) => { await page.goto('helpdesk.html'); });

  test('seeds five tickets sorted by priority then age, with overdue labels', async ({ page }) => {
    const rows = page.locator('#ticket-list tbody tr');
    await expect(rows).toHaveCount(5);
    const prios = await rows.locator('td:nth-child(2)').allTextContents();
    expect(prios).toEqual(['P1', 'P1', 'P2', 'P3', 'P3']);
    await expect(page.locator('#ticket-list')).toContainText('OVERDUE');
    await expect(rows.first()).toContainText('suspicious invoice'); // older P1 first
  });

  test('filters and search work', async ({ page }) => {
    await page.selectOption('#f-priority', 'P3');
    await expect(page.locator('#ticket-list tbody tr')).toHaveCount(2);
    await page.selectOption('#f-priority', '');
    await page.fill('#f-search', 'printer');
    await expect(page.locator('#ticket-list tbody tr')).toHaveCount(1);
    await page.fill('#f-search', 'zzzz');
    await expect(page.locator('#ticket-list')).toContainText('No tickets match');
  });

  test('create, resolve, reply and persist across reload', async ({ page }) => {
    await page.click('#new-ticket');
    await page.click('#ticket-dialog button[type=submit]');
    await expect(page.locator('#n-requester-error')).toBeVisible();
    await page.fill('#n-requester', 'Test User');
    await page.selectOption('#n-impact', 'blocked');
    await page.fill('#n-desc', 'Cannot log in to the design server.');
    await expect(page.locator('#n-prio-hint')).toContainText('P2');
    await page.click('#ticket-dialog button[type=submit]');
    await expect(page.locator('#ticket-list tbody tr')).toHaveCount(6);
    await page.locator('tr', { hasText: 'design server' }).getByRole('button', { name: /Open ticket/ }).click();
    await page.fill('#e-reply', 'Looking into it.');
    await page.click('#add-reply');
    await expect(page.locator('#reply-list')).toContainText('Looking into it.');
    await page.selectOption('#e-status', 'Resolved');
    await page.fill('#e-resolution', 'Password reset.');
    await page.click('#ticket-dialog button[type=submit]');
    await page.reload();
    await page.selectOption('#f-status', 'Resolved');
    await expect(page.locator('#ticket-list tbody tr')).toHaveCount(1);
  });

  test('phishing ticket shows response guidance', async ({ page }) => {
    await page.locator('tr', { hasText: 'suspicious invoice' }).getByRole('button', { name: /Open ticket/ }).click();
    await expect(page.locator('#security-guidance')).toContainText('Isolate the affected device');
    await expect(page.locator('#security-guidance')).toContainText('Do not delete the suspicious email');
  });
});
