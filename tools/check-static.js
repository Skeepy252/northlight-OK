#!/usr/bin/env node
// Static validation of the site: CSP, titles, headings, relative paths, no inline code, no external script/style/image origins.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const PAGES = ['index', 'dashboard', 'helpdesk', 'staff', 'crm', 'automation', 'troubleshoot', 'health'].map((p) => p + '.html');
const errors = [];
const err = (f, m) => errors.push(`${f}: ${m}`);

for (const page of PAGES) {
  if (!fs.existsSync(path.join(root, page))) { err(page, 'file is missing'); continue; }
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  if (!/<html lang="/.test(html)) err(page, 'missing <html lang>');
  if (!/<meta name="viewport"/.test(html)) err(page, 'missing viewport meta');
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  if (!csp) err(page, 'missing Content-Security-Policy meta');
  else for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'self'"]) if (!csp.includes(d)) err(page, 'CSP lacks ' + d);
  const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1];
  if (!title || title.length >= 60) err(page, 'title missing or >= 60 chars');
  const desc = (html.match(/<meta name="description" content="([^"]+)"/) || [])[1];
  if (!desc || desc.length >= 155) err(page, 'meta description missing or >= 155 chars');
  if ((html.match(/<h1[ >]/g) || []).length !== 1) err(page, 'must have exactly one <h1>');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/g)) err(page, 'inline script: ' + m[0]);
  if (/\sstyle="/.test(html) || /<style[\s>]/.test(html)) err(page, 'inline style is blocked by CSP');
  if (/\son[a-z]+="/i.test(html)) err(page, 'inline event handler');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(#|mailto:)/.test(u)) continue;
    if (/^https?:/.test(u)) { // only the canonical link may point off-site
      const tag = html.slice(html.lastIndexOf('<', m.index), html.indexOf('>', m.index));
      if (!tag.includes('rel="canonical"')) err(page, 'external reference ' + u);
      continue;
    }
    if (u.startsWith('/')) { err(page, 'absolute path breaks GitHub Pages sub-path: ' + u); continue; }
    if (!fs.existsSync(path.join(root, u.split('#')[0].split('?')[0]))) err(page, 'broken relative reference ' + u);
  }
}
for (const j of ['rules.json', 'health.json', 'northlight.cloud.json']) { try { JSON.parse(fs.readFileSync(path.join(root, j), 'utf8')); } catch (e) { err(j, 'invalid JSON'); } }
const unsafe = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/;
for (const f of fs.readdirSync(path.join(root, 'assets/js'))) {
  fs.readFileSync(path.join(root, 'assets/js', f), 'utf8').split('\n').forEach((l, i) => { if (unsafe.test(l)) err(`assets/js/${f}:${i + 1}`, 'unsafe HTML/JS sink'); });
}
if (errors.length) { console.error(`FAIL — ${errors.length} static validation problem(s):`); errors.forEach((e) => console.error('  - ' + e)); process.exit(1); }
console.log(`PASS — ${PAGES.length} pages and assets passed static validation.`);
