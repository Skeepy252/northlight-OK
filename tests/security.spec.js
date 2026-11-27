const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../tools/check-secrets');
const { validate } = require('../tools/check-cloud');

const PAGES = ['index.html', 'helpdesk.html', 'staff.html', 'crm.html', 'automation.html', 'troubleshoot.html'];
const root = path.resolve(__dirname, '..');

test('XSS: script-like input is rendered as harmless text everywhere', async ({ page }) => {
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  let dialogs = 0; page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.goto('./');
  await page.fill('#c-name', payload); await page.fill('#c-email', 'x@evil.example'); await page.fill('#c-company', payload);
  await page.selectOption('#c-service', 'Creative Campaigns'); await page.fill('#c-desc', payload + ' more text');
  await page.click('#enquiry-submit');
  await expect(page.locator('#enquiry-success')).toBeVisible();
  for (const url of ['helpdesk.html', 'crm.html', 'automation.html']) {
    await page.goto(url);
    await expect(page.locator('body')).toContainText('<img src=x onerror=');
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(await page.locator('main script').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  }
  expect(dialogs).toBe(0);
});

test('Role UI: Sales user does not see IT administration (client-side demo only)', async ({ page }) => {
  await page.goto('staff.html');
  await expect(page.locator('#login-btn')).toBeEnabled({ timeout: 20000 });
  await page.fill('#l-email', 'taylor.brooks@northlight.example'); await page.fill('#l-pw', 'NorthlightDemo-Only-2026');
  await page.click('#login-btn');
  await page.fill('#m-code', (await page.locator('#demo-code').textContent()).trim());
  await page.click('#mfa-btn');
  await expect(page.locator('#staff-app')).toBeVisible();
  await expect(page.locator('#admin-panel')).toHaveCount(0);
  await expect(page.locator('#joiner-form')).toHaveCount(0);
});

test('empty forms show validation messages', async ({ page }) => {
  await page.goto('helpdesk.html'); await page.click('#new-ticket'); await page.click('#ticket-dialog button[type=submit]');
  await expect(page.locator('#n-requester-error')).toContainText('requester'); await expect(page.locator('#n-desc-error')).toBeVisible();
  await page.goto('crm.html'); await page.click('#c-new'); await page.click('#crm-dialog button[type=submit]');
  await expect(page.locator('#f-name-error')).toContainText('required');
  await page.goto('./'); await page.click('#enquiry-submit');
  await expect(page.locator('#c-name-error')).toContainText('full name');
});

for (const p of PAGES) {
  test(`CSP meta present and strict on ${p}`, () => {
    const html = fs.readFileSync(path.join(root, p), 'utf8');
    const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
    expect(csp, 'CSP meta missing').toBeTruthy();
    for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(d);
    expect(csp).not.toContain('unsafe-inline'); expect(csp).not.toContain('frame-ancestors'); // unsupported in <meta>
  });

  test(`${p} loads without JS errors, CSP violations or failed requests`, async ({ page }) => {
    const problems = [];
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(r.status() + ' ' + r.url()); });
    page.on('requestfailed', (r) => problems.push('failed ' + r.url()));
    const res = await page.goto(p);
    expect(res.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    expect(problems).toEqual([]);
    for (const l of await page.locator('input:not([type=hidden]), select, textarea').all()) {
      const id = await l.getAttribute('id');
      if (id && !id.startsWith('f-') && !id.startsWith('e-') && !id.startsWith('n-')) expect(await page.locator(`label[for="${id}"]`).count(), `label for #${id}`).toBeGreaterThan(0);
    }
    // all same-origin requests must stay under the sub-path
    const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    urls.forEach((u) => expect(u).toContain('/northlight-OK/'));
  });
}

test('data persists across reload and malformed storage is recovered safely', async ({ page }) => {
  await page.goto('helpdesk.html');
  await page.evaluate(() => NL.tickets.create({ requester: 'Persist', description: 'Persistence check ticket', source: 'test' }));
  await page.reload();
  await expect(page.locator('#ticket-list')).toContainText('Persistence check');
  await page.evaluate(() => localStorage.setItem('northlight.v1.state', '{ not json'));
  await page.reload();
  await expect(page.locator('#ticket-list tbody tr')).toHaveCount(5);
  expect(await page.evaluate(() => localStorage.getItem('northlight.v1.state.corrupt'))).toBe('{ not json');
  await page.evaluate(() => localStorage.setItem('northlight.v1.state', JSON.stringify({ tickets: 'oops' })));
  await page.reload();
  await expect(page.locator('#ticket-stats')).toBeVisible(); // migrated, no crash
});

test('pages stay in sync via shared storage (second tab)', async ({ context }) => {
  const a = await context.newPage(), b = await context.newPage();
  await a.goto('helpdesk.html'); await b.goto('crm.html');
  await expect(b.locator('#st-leads .num')).toHaveText('3');
  await a.evaluate(() => NL.store.create('leads', { name: 'Sync', company: 'Sync Co', email: 's@sync.example', source: 'Other', status: 'New' }));
  await expect(b.locator('#st-leads .num')).toHaveText('4');
});

test('no secrets in the repository', () => {
  const found = scan(root);
  expect(found.map((f) => `${f.file}:${f.line} ${f.rule}`)).toEqual([]);
});

test('secret scanner detects planted patterns (synthetic fixtures, values never printed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-scan-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const cfg = { api_key: "' + 'x'.repeat(20) + '" };\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), '-----BEGIN RSA PRIV' + 'ATE KEY-----\n');
  fs.writeFileSync(path.join(dir, '.env'), 'A=1\n');
  const found = scan(dir);
  expect(found.map((f) => f.rule).sort()).toEqual(['API key / token assignment', 'environment file present', 'private key block']);
  expect(JSON.stringify(found)).not.toContain('xxxxxxxx');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cloud validation accepts the config and rejects broken ones', () => {
  const good = JSON.parse(fs.readFileSync(path.join(root, 'northlight.cloud.json'), 'utf8'));
  expect(validate(good)).toEqual([]);
  const bad = JSON.parse(JSON.stringify(good));
  bad.resourceGroup.name = 'MyGroup'; delete bad.resources[0].tags['cost-center']; bad.resources[1].settings.allowBlobPublicAccess = true;
  const errs = validate(bad).join('\n');
  expect(errs).toContain('violates the convention'); expect(errs).toContain('cost-center'); expect(errs).toContain('allowBlobPublicAccess');
  expect(validate({})).not.toEqual([]);
});
