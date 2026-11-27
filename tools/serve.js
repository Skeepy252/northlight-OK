#!/usr/bin/env node
// Tiny static file server for local development and tests. Serves only the project root.
// Usage: node tools/serve.js [--port 8080] [--base /sub-path/]
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : d; };
const PORT = Number(opt('port', 8080));
let BASE = opt('base', '/');
if (!BASE.startsWith('/')) BASE = '/' + BASE;
if (!BASE.endsWith('/')) BASE += '/';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
// Only runtime site files are served (never node_modules, tests, .git ...).
const PUBLIC = /^(?:[\w-]+\.(?:html|json|js)|assets\/.+)$/;

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (url + '/' === BASE) { res.writeHead(301, { Location: BASE }); return res.end(); }
  if (!url.startsWith(BASE)) { res.writeHead(404); return res.end('Not found (outside base path ' + BASE + ')'); }
  let rel = url.slice(BASE.length) || 'index.html';
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.test(rel.split(path.sep).join('/'))) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`Northlight Studio running at http://localhost:${PORT}${BASE}  (Ctrl+C to stop)`));
