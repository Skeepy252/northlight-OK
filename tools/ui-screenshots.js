#!/usr/bin/env node
// Visual QA helper: starts the local server, opens every page in Chromium and saves screenshots to screenshots/ui/.
// Usage: node tools/ui-screenshots.js [glow|light]   (needs: npx playwright install chromium)
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const theme = process.argv[2] === 'light' ? 'light' : 'glow';
const PORT = 4190, BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(__dirname, '..', 'screenshots', 'ui');
const VIEWS = { desktop: [1440, 900], mobile: [390, 844] };
const PAGES = ['index', 'dashboard', 'helpdesk', 'staff', 'crm', 'automation', 'troubleshoot', 'health'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), '--port', String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  try {
    for (const [view, [w, h]] of Object.entries(VIEWS)) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.addInitScript((t) => { try { localStorage.setItem('northlight.v1.theme', t); } catch (e) { /* ignore */ } }, theme);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // populate realistic data: one urgent website enquiry
      await page.goto(BASE);
      await page.fill('#c-name', 'Jamie Foster'); await page.fill('#c-email', 'jamie@fosterandco.example'); await page.fill('#c-company', 'Foster & Co');
      await page.selectOption('#c-service', 'Brand Identity and Strategy'); await page.selectOption('#c-urgency', 'urgent'); await page.fill('#c-desc', 'We need a rebrand before our launch next week.');
      await page.click('#enquiry-submit'); await page.waitForSelector('#enquiry-success');
      for (const p of PAGES) {
        await page.goto(BASE + p + '.html');
        await page.waitForLoadState('networkidle');
        if (p === 'staff') {
          await page.waitForSelector('#login-btn:not([disabled])', { timeout: 20000 });
          await page.screenshot({ path: path.join(OUT, `${view}-staff-login.png`), fullPage: true });
          await page.fill('#l-email', 'jordan.lee@northlight.example'); await page.fill('#l-pw', 'NorthlightDemo-Only-2026'); await page.click('#login-btn');
          await page.fill('#m-code', (await page.textContent('#demo-code')).trim()); await page.click('#mfa-btn'); await page.waitForSelector('#admin-panel');
        }
        if (p === 'troubleshoot') { await page.click('#yes'); await page.click('#yes'); await page.click('#no'); }
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(OUT, `${view}-${p === 'index' ? 'home' : p}.png`), fullPage: true });
      }
      if (view === 'mobile') { await page.goto(BASE + 'dashboard.html'); await page.click('.menu-btn'); await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, 'mobile-menu-open.png') }); }
      console.log(`${view}: ${errors.length ? 'JS ERRORS ' + errors.join(' | ') : 'no JS errors'}`);
      await ctx.close();
    }
  } finally { await browser.close(); server.kill(); }
  console.log('Saved screenshots to', OUT, '(theme: ' + theme + ')');
})().catch((e) => { console.error(e); process.exit(1); });
