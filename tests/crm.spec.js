const { test, expect } = require('@playwright/test');
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('northlight.v1.state')));
const bar = (page, stage) => page.locator(`#pipeline-chart rect[data-stage="${stage}"]`);

test.describe('CRM', () => {
  test.beforeEach(async ({ page }) => { await page.goto('crm.html'); });

  test('dashboard cards, seed data and SVG chart', async ({ page }) => {
    await expect(page.locator('#st-leads .num')).toHaveText('3');
    await expect(page.locator('#st-accounts .num')).toHaveText('2');
    await expect(page.locator('#st-open .num')).toHaveText('3');
    await expect(page.locator('#st-won .num')).toHaveText('1');
    await expect(page.locator('#st-cases .num')).toHaveText('1');
    await expect(page.locator('#pipeline-chart rect')).toHaveCount(5);
    await page.click('#tab-cases');
    await expect(page.locator('#crm-list')).toContainText('OVERDUE');
  });

  test('create, edit and search leads with validation', async ({ page }) => {
    await page.click('#c-new');
    await page.click('#crm-dialog button[type=submit]');
    await expect(page.locator('#f-name-error')).toBeVisible();
    await page.fill('#f-name', 'Lena Fox'); await page.fill('#f-company', 'Fox & Co'); await page.fill('#f-email', 'lena@fox.example');
    await page.click('#crm-dialog button[type=submit]');
    await expect(page.locator('#st-leads .num')).toHaveText('4');
    await page.fill('#c-search', 'fox');
    await expect(page.locator('#crm-list tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: /Edit lead/ }).click();
    await page.selectOption('#f-status', 'Contacted');
    await page.click('#crm-dialog button[type=submit]');
    await page.reload();
    await page.fill('#c-search', 'fox');
    await expect(page.locator('#crm-list')).toContainText('Contacted');
  });

  test('convert lead creates account, contact, opportunity once; chart updates', async ({ page }) => {
    const before = await bar(page, 'Qualified').getAttribute('data-count');
    await page.getByRole('button', { name: /Convert lead LEAD-1001/ }).click();
    const s = await state(page);
    expect(s.accounts.filter((a) => a.name === 'Harbor & Pine Coffee')).toHaveLength(1);
    expect(s.contacts.filter((c) => c.email === 'priya.nair@harborpine.example')).toHaveLength(1);
    expect(s.opportunities.filter((o) => o.leadId === 'LEAD-1001')).toHaveLength(1);
    expect(s.leads.find((l) => l.id === 'LEAD-1001').status).toBe('Converted');
    await expect(bar(page, 'Qualified')).toHaveAttribute('data-count', String(Number(before) + 1));
    await expect(page.getByRole('button', { name: /Convert lead LEAD-1001/ })).toBeDisabled();
    // converting a lead from an existing company reuses the account
    await page.evaluate(() => NL.store.create('leads', { name: 'Second Person', company: 'harbor & pine coffee', email: 'second@harborpine.example', source: 'Website', status: 'New' }));
    await page.getByRole('button', { name: /Convert lead LEAD-1004/ }).click();
    expect((await state(page)).accounts.filter((a) => a.name.toLowerCase() === 'harbor & pine coffee')).toHaveLength(1);
  });

  test('changing opportunity stage updates chart and persists', async ({ page }) => {
    await page.click('#tab-opportunities');
    const lost = Number(await bar(page, 'Lost').getAttribute('data-count'));
    await page.getByLabel('Stage for Orchard seasonal campaign').selectOption('Lost');
    await expect(bar(page, 'Lost')).toHaveAttribute('data-count', String(lost + 1));
    await page.reload();
    await expect(bar(page, 'Lost')).toHaveAttribute('data-count', String(lost + 1));
  });

  test('support cases: create, overdue, close', async ({ page }) => {
    await page.click('#tab-cases');
    await page.click('#c-new');
    await page.click('#crm-dialog button[type=submit]');
    await expect(page.locator('#f-description-error')).toBeVisible();
    await page.fill('#f-description', 'Invoice PDF will not open');
    await page.fill('#f-dueDate', '2020-01-01');
    await page.click('#crm-dialog button[type=submit]');
    await expect(page.locator('#st-cases .num')).toHaveText('2');
    await page.getByRole('button', { name: /Close case CASE-1002/ }).click();
    await expect(page.locator('#st-cases .num')).toHaveText('1');
  });
});
