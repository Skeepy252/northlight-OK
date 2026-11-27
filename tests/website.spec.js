const { test, expect } = require('@playwright/test');

const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('northlight.v1.state')));
async function submit(page, over = {}) {
  const d = { name: 'Pat Doe', email: 'pat@acme.example', company: 'Acme Test Co', service: 'Creative Campaigns', desc: 'We want a spring campaign for our new product line.', urgency: 'normal', ...over };
  await page.fill('#c-name', d.name); await page.fill('#c-email', d.email); await page.fill('#c-company', d.company);
  await page.selectOption('#c-service', d.service); await page.selectOption('#c-urgency', d.urgency); await page.fill('#c-desc', d.desc);
  await page.click('#enquiry-submit');
}

test.describe('website', () => {
  test('homepage content, SEO metadata and single H1', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('h1')).toHaveCount(1);
    const title = await page.title(); expect(title.length).toBeLessThan(60);
    expect((await page.locator('meta[name=description]').getAttribute('content')).length).toBeLessThan(155);
    await expect(page.locator('link[rel=canonical]')).toHaveCount(1);
    await expect(page.locator('details.faq')).toHaveCount(4);
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    expect(ld['@graph'].map((x) => x['@type'])).toEqual(['Organization', 'WebSite', 'FAQPage']);
    expect(ld['@graph'][2].mainEntity).toHaveLength(4);
    for (const img of await page.locator('img').all()) expect(await img.getAttribute('alt')).toBeTruthy();
  });

  test('every nav link opens a working page', async ({ page }) => {
    await page.goto('./');
    const links = await page.locator('#main-nav a').evaluateAll((a) => a.map((x) => [x.textContent, x.getAttribute('href')]));
    expect(links.map((l) => l[0])).toEqual(['Home', 'Help Desk', 'Staff', 'CRM', 'Automation', 'Troubleshooting']);
    for (const [label, href] of links) {
      const res = await page.goto(href);
      expect(res.status(), href).toBe(200);
      // public site uses the top nav; application pages use the sidebar (which labels Staff as "Staff Directory")
      const active = label === 'Home' ? page.locator('#main-nav a[aria-current=page]') : page.locator('#side-nav a[aria-current=page]');
      await expect(active).toContainText(label);
    }
  });

  test('empty contact form shows validation messages', async ({ page }) => {
    await page.goto('./');
    await page.click('#enquiry-submit');
    for (const id of ['name', 'email', 'company', 'service', 'desc']) await expect(page.locator(`#c-${id}-error`)).toBeVisible();
    await page.fill('#c-email', 'not-an-email'); await page.click('#enquiry-submit');
    await expect(page.locator('#c-email-error')).toContainText('valid email');
    expect((await state(page)).leads).toHaveLength(3);
  });

  test('normal enquiry creates one lead, one P3 ticket and standard log', async ({ page }) => {
    await page.goto('./');
    await submit(page);
    await expect(page.locator('#enquiry-success')).toContainText('priority P3');
    const s = await state(page);
    expect(s.leads.filter((l) => l.company === 'Acme Test Co')).toHaveLength(1);
    const t = s.tickets.filter((x) => x.source === 'website'); expect(t).toHaveLength(1); expect(t[0].priority).toBe('P3');
    expect(s.outbox).toHaveLength(0);
    expect(s.logs.map((l) => l.ruleId)).toEqual(expect.arrayContaining(['R1-create-lead', 'R2-create-ticket', 'R5-standard-log']));
  });

  test('urgent enquiry creates P1 ticket, outbox alert and automation log', async ({ page }) => {
    await page.goto('./');
    await submit(page, { urgency: 'urgent', company: 'Rush Ltd' });
    await expect(page.locator('#enquiry-success')).toContainText('priority P1');
    const s = await state(page);
    expect(s.tickets.find((x) => x.source === 'website').priority).toBe('P1');
    expect(s.outbox).toHaveLength(1); expect(s.outbox[0].status).toContain('not sent');
    expect(s.logs.map((l) => l.ruleId)).toEqual(expect.arrayContaining(['R3-urgent-priority', 'R4-urgent-alert']));
    expect(s.logs.map((l) => l.ruleId)).not.toContain('R5-standard-log');
  });

  test('urgent keyword in text also escalates', async ({ page }) => {
    await page.goto('./');
    await submit(page, { desc: 'Our site had an outage and we need help ASAP please.' });
    await expect(page.locator('#enquiry-success')).toContainText('priority P1');
  });

  test('duplicate submission id does not create duplicates', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const e = { submissionId: 'sub-dup', name: 'A B', email: 'a@b.example', company: 'Dup Co', service: 'Creative Campaigns', description: 'Please quote a campaign for us.', urgency: 'normal' };
      const [x, y] = await Promise.all([NL.automation.processEnquiry(e), NL.automation.processEnquiry(e)]);
      const z = await NL.automation.processEnquiry(e);
      return [x.duplicate, y.duplicate, z.duplicate];
    });
    expect(r.filter(Boolean).length).toBe(2);
    const s = await state(page);
    expect(s.leads.filter((l) => l.company === 'Dup Co')).toHaveLength(1);
    expect(s.tickets.filter((t) => t.submissionId === 'sub-dup')).toHaveLength(1);
  });

  test('missing rules.json: clear error, nothing claimed as processed', async ({ page }) => {
    await page.route('**/rules.json', (r) => r.fulfill({ status: 404, body: 'nope' }));
    await page.goto('./');
    await submit(page);
    await expect(page.locator('#enquiry-feedback .alert-error')).toContainText('rules.json could not be loaded');
    await expect(page.locator('#enquiry-success')).toHaveCount(0);
    const s = await state(page);
    expect(s.leads).toHaveLength(3);
    expect(s.logs.some((l) => l.level === 'error')).toBe(true);
    await expect(page.locator('#c-name')).toHaveValue('Pat Doe'); // enquiry text is not lost
  });

  test('invalid rules.json is reported', async ({ page }) => {
    await page.route('**/rules.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{ broken' }));
    await page.goto('./');
    await submit(page);
    await expect(page.locator('#enquiry-feedback .alert-error')).toContainText('invalid JSON');
  });

  test('global export downloads a JSON file without secrets', async ({ page }) => {
    await page.goto('./');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-all')]);
    expect(dl.suggestedFilename()).toMatch(/^northlight-studio-export-\d{4}-\d{2}-\d{2}\.json$/);
    const json = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
    expect(json.data.tickets).toHaveLength(5);
  });
});
