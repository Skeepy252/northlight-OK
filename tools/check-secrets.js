#!/usr/bin/env node
// Scans project files for accidentally committed secrets. Reports file:line and rule name ONLY (never the value).
// A line containing the marker "demo-public" is allowed (documented, public, fictional demo values).
const fs = require('fs');
const path = require('path');

const RULES = [
  { name: 'private key block', re: new RegExp('-----BEGIN [A-Z ]*PRIV' + 'ATE KEY-----') },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'API key / token assignment', re: /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{12,}["']/i },
  { name: 'password-like assignment', re: /(?:password|passwd|pwd)["']?\s*[:=]\s*["'][^"'\s]{6,}["']/i },
  { name: 'bearer token', re: /Bearer\s+[A-Za-z0-9._-]{20,}/ }
];
const SKIP_DIRS = new Set(['node_modules', '.git', 'test-results', 'playwright-report', '_site', 'coverage']);
const MARKER = 'demo-public';
const TEXT_EXT = /\.(html|js|json|css|md|yml|yaml|txt|svg|env|cfg|ini|toml)$/i;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function scan(root) {
  const findings = [];
  for (const f of walk(root, [])) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (/(^|\/)\.env(\..*)?$/.test(rel) && !/\.example$/.test(rel)) findings.push({ file: rel, line: 0, rule: 'environment file present' });
    if (/\.(pem|key|pfx|p12)$/i.test(rel)) findings.push({ file: rel, line: 0, rule: 'key/certificate file present' });
    if (!TEXT_EXT.test(rel) || rel === 'package-lock.json') continue;
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (line.includes(MARKER)) return;
      for (const r of RULES) if (r.re.test(line)) findings.push({ file: rel, line: i + 1, rule: r.name });
    });
  }
  return findings;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const f = scan(root);
  if (f.length) { console.error(`FAIL — ${f.length} potential secret(s) found (values hidden):`); f.forEach((x) => console.error(`  ${x.file}:${x.line}  ${x.rule}`)); process.exit(1); }
  console.log('PASS — no secrets detected.');
}
module.exports = { scan };
