const { test, expect } = require('@playwright/test');

const APP_PAGES = ['dashboard.html', 'helpdesk.html', 'staff.html', 'crm.html', 'automation.html', 'troubleshoot.html', 'health.html'];
const ALL_PAGES = ['index.html', ...APP_PAGES];
const SIZES = { desktop: [1440, 900], laptop: [1280, 800], tablet: [768, 1024], mobile: [390, 844] };
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('northlight.v1.state')));

test.describe('layout and navigation', () => {
  test('sidebar links work on every application page and mark the active page', async ({ page }) => {
    await page.goto('dashboard.html');
    const links = await page.locator('#side-nav a').evaluateAll((a) => a.map((x) => [x.textContent.trim(), x.getAttribute('href')]));
    expect(links.map((l) => l[0])).toEqual(['Dashboard', 'Help Desk', 'Staff Directory', 'CRM', 'Automation', 'Troubleshooting', 'System Health']);
    for (const [label, href] of links) {
      expect((await page.goto(href)).status()).toBe(200);
      await expect(page.locator('#side-nav a[aria-current=page]')).toHaveText(label);
      await expect(page.locator('.topbar .page-title')).toBeAttached();
      await expect(page.locator('h1')).toHaveCount(1);
    }
    await page.click('.side-foot a');
    await expect(page).toHaveURL(/index\.html$|\/northlight-OK\/$/);
  });

  for (const [name, [w, h]] of Object.entries(SIZES)) {
    test(`no horizontal overflow and usable at ${name} ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      for (const p of ALL_PAGES) {
        await page.goto(p);
        await page.waitForLoadState('networkidle');
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `${p} overflows by ${over}px at ${w}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('mobile sidebar opens, closes with Escape and navigates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('dashboard.html');
    const side = page.locator('#app-sidebar');
    await expect(page.locator('.menu-btn')).toBeVisible();
    await expect(side).not.toHaveClass(/open/);
    await page.click('.menu-btn');
    await expect(side).toHaveClass(/open/);
    await expect(page.locator('.menu-btn')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(side).not.toHaveClass(/open/);
    await page.click('.menu-btn');
    await page.locator('#side-nav').getByText('CRM', { exact: true }).click();
    await expect(page).toHaveURL(/crm\.html/);
  });

  test('theme toggle switches between glow and light and persists', async ({ page }) => {
    await page.goto('dashboard.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'glow');
    await page.click('#theme-toggle');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => document.getElementById('theme-glow').disabled)).toBe(true);
  });
});

test.describe('dashboard shows real shared data', () => {
  test('stat cards match the store and update after actions', async ({ page }) => {
    await page.goto('dashboard.html');
    const s = await state(page);
    const open = s.tickets.filter((t) => t.status !== 'Resolved');
    await expect(page.locator('#d-open .num')).toHaveText(String(open.length));
    await expect(page.locator('#d-critical .num')).toHaveText(String(open.filter((t) => t.priority === 'P1').length));
    await expect(page.locator('#d-staff .num')).toHaveText(String(s.staff.filter((x) => x.status === 'active').length));
    await expect(page.locator('#d-auto .num')).toHaveText('Active');
    await page.evaluate(() => NL.tickets.create({ requester: 'Dash Test', description: 'Dashboard update check ticket', impact: 'multiple', source: 'test' }));
    await expect(page.locator('#d-open .num')).toHaveText(String(open.length + 1));
    await expect(page.locator('#d-critical .num')).toHaveText(String(open.filter((t) => t.priority === 'P1').length + 1));
    await expect(page.locator('#dash-feed')).toContainText('Dashboard update check');
  });

  test('website enquiry appears on dashboard, quick actions work', async ({ page }) => {
    await page.goto('./');
    await page.fill('#c-name', 'Ui Tester'); await page.fill('#c-email', 'ui@tester.example'); await page.fill('#c-company', 'Ui Co');
    await page.selectOption('#c-service', 'Creative Campaigns'); await page.selectOption('#c-urgency', 'urgent'); await page.fill('#c-desc', 'Check the whole journey please.');
    await page.click('#enquiry-submit');
    await expect(page.locator('#enquiry-success')).toBeVisible();
    await page.click('.header-cta');
    await expect(page.locator('#dash-feed')).toContainText('Ui Tester');
    await expect(page.locator('#dash-feed')).toContainText('Outbox (simulated)');
    await page.click('#qa-sample');
    await expect(page.locator('#dash-feed')).toContainText('Dashboard Sample');
    await page.getByRole('link', { name: 'New ticket' }).click();
    await expect(page.locator('#ticket-dialog')).toBeVisible();
  });
});

test.describe('top bar', () => {
  test('global search finds tickets, leads and staff and links through', async ({ page }) => {
    await page.goto('dashboard.html');
    await page.fill('#global-search', 'printer');
    await expect(page.locator('#search-results')).toContainText('Tickets');
    await page.locator('#search-results a', { hasText: 'printer' }).first().click();
    await expect(page).toHaveURL(/helpdesk\.html\?q=/);
    await expect(page.locator('#ticket-list tbody tr')).toHaveCount(1);
    await page.fill('#global-search', 'Priya');
    await page.locator('#search-results a', { hasText: 'Priya' }).click();
    await expect(page).toHaveURL(/crm\.html\?tab=leads/);
    await expect(page.locator('#crm-list tbody tr')).toHaveCount(1);
    await page.fill('#global-search', 'zzzzqq');
    await expect(page.locator('#search-results')).toContainText('No results');
  });

  test('notification bell shows real counts and links', async ({ page }) => {
    await page.goto('dashboard.html');
    await expect(page.locator('#bell-count')).not.toBeEmpty();
    await page.click('#bell');
    await expect(page.locator('#notif-menu')).toContainText('open P1 critical tickets');
    await page.locator('#notif-menu a', { hasText: 'open P1' }).click();
    await expect(page).toHaveURL(/priority=P1/);
    await expect(page.locator('#f-priority')).toHaveValue('P1');
  });

  test('profile shows guest, then the signed-in user and role', async ({ page }) => {
    await page.goto('dashboard.html');
    await expect(page.locator('#profile')).toContainText('Guest');
    await page.goto('staff.html');
    await expect(page.locator('#login-btn')).toBeEnabled({ timeout: 20000 });
    await page.fill('#l-email', 'casey.morgan@northlight.example'); await page.fill('#l-pw', 'NorthlightDemo-Only-2026');
    await page.click('#login-btn');
    await page.fill('#m-code', (await page.locator('#demo-code').textContent()).trim());
    await page.click('#mfa-btn');
    await expect(page.locator('#staff-app')).toBeVisible();
    await expect(page.locator('#profile')).toContainText('Casey Morgan');
    await expect(page.locator('#profile')).toContainText('IT Support');
    await expect(page.locator('#staff-overview')).toContainText('Total employees');
    await page.getByRole('button', { name: 'View details for Maya Chen' }).click();
    await expect(page.locator('#staff-dialog')).toContainText('maya.chen@northlight.example');
    await page.keyboard.press('Escape');
    await page.fill('#dir-q', 'sam');
    await expect(page.locator('#dir-table tbody tr')).toHaveCount(1);
  });
});

test.describe('module UI', () => {
  test('crm pipeline strip and automation journey reflect data', async ({ page }) => {
    await page.goto('crm.html');
    await expect(page.locator('.pipeline .pipe-step')).toHaveCount(5);
    await expect(page.locator('.pipe-step[data-stage="Won"] strong')).toHaveText('1');
    await page.goto('automation.html');
    await expect(page.locator('#auto-flow li')).toHaveCount(6);
    await page.click('#run-urgent');
    await expect(page.locator('#auto-flow li').nth(4).locator('strong')).toHaveText('1');
  });

  test('troubleshooting shows PASS and FAIL states', async ({ page }) => {
    await page.goto('troubleshoot.html');
    await page.click('#yes'); await page.click('#yes'); await page.click('#no');
    await expect(page.locator('#ladder li[data-state=pass]')).toHaveCount(2);
    await expect(page.locator('#ladder li[data-state=fail]')).toHaveCount(1);
    await expect(page.locator('#ladder')).toContainText('✗ FAIL');
  });

  test('system health runs checks and exports data', async ({ page }) => {
    await page.goto('health.html');
    await expect(page.locator('#health-banner')).toContainText('All 6 checks passed');
    await expect(page.locator('#health-checks .badge-ok')).toHaveCount(6);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export all data' }).first().click()]);
    expect(dl.suggestedFilename()).toMatch(/northlight-studio-export/);
    await page.route('**/rules.json', (r) => r.fulfill({ status: 500, body: 'x' }));
    await page.click('#recheck');
    await expect(page.locator('#health-banner')).toContainText('1 of 6 checks failed');
  });

  test('keyboard focus is visible and skip link works', async ({ page }) => {
    await page.goto('helpdesk.html');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });
});
