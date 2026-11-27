#!/usr/bin/env node
// Read-only network ladder: interface -> IP -> gateway -> gateway ping -> 1.1.1.1 ping -> DNS lookup.
// Sends at most one ping per stage. Never scans, never changes configuration.
const os = require('os');
const dns = require('dns').promises;
const { execFileSync } = require('child_process');

const EXTERNAL_IP = '1.1.1.1';
const DNS_NAME = 'example.com';
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function realRun(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
}

function findGateway(deps) {
  const p = deps.platform;
  if (p === 'win32') { const m = deps.run('route', ['print', '-4', '0.0.0.0']).match(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/m); return m && m[1]; }
  if (p === 'darwin') { const m = deps.run('route', ['-n', 'get', 'default']).match(/gateway:\s*(\S+)/); return m && m[1]; }
  const m = deps.run('ip', ['route', 'show', 'default']).match(/default via (\S+)/); return m && m[1];
}

function ping(deps, host) {
  if (!IPV4.test(host)) throw new Error('refusing to ping a non-IPv4 target'); // only values we derived/fixed ever get here
  const args = deps.platform === 'win32' ? ['-n', '1', '-w', '2000', host] : deps.platform === 'darwin' ? ['-c', '1', '-W', '2000', host] : ['-c', '1', '-W', '2', host];
  try { const out = deps.run('ping', args); return deps.platform === 'win32' ? /TTL=/i.test(out) : true; } catch (e) { return false; }
}

async function diagnose(deps) {
  deps = Object.assign({ platform: process.platform, run: realRun, interfaces: os.networkInterfaces, lookup: (n) => dns.lookup(n) }, deps);
  const stages = [];
  const add = (name, ok, ifFail, detail) => stages.push({ name, ok, ifFail, detail });

  const ifs = Object.entries(deps.interfaces()).flatMap(([n, list]) => (list || []).filter((a) => !a.internal).map((a) => ({ n, ...a })));
  add('Network interface available', ifs.length > 0, 'No active network connection. Check Wi-Fi/cable, airplane mode and the adapter.', ifs[0] && ifs[0].n);
  const v4 = ifs.find((a) => a.family === 'IPv4' && !a.address.startsWith('169.254.'));
  add('IP address assigned', !!v4, 'No valid IPv4 address (none or 169.254.x.x self-assigned). Possible DHCP problem: renew the lease or restart the router.', v4 && v4.address);

  let gw = null;
  try { gw = findGateway(deps); } catch (e) { /* unknown */ }
  add('Default gateway identified', !!gw, 'No default gateway found. The device is not configured to reach other networks.', gw);
  add('Router reachable', !!gw && ping(deps, gw), 'Router did not answer. Check cabling/Wi-Fi signal, restart the router (some routers block ping).', gw);
  add('External IP reachable (' + EXTERNAL_IP + ')', ping(deps, EXTERNAL_IP), 'Router is up but the internet is not reachable: possible ISP/WAN outage.');
  let dnsOk = false;
  try { dnsOk = !!(await deps.lookup(DNS_NAME)); } catch (e) { /* failed */ }
  add('DNS resolution (' + DNS_NAME + ')', dnsOk, 'Possible DNS problem: IP connectivity works but names do not resolve. Try another DNS server or restart the router.');

  const first = stages.find((s) => !s.ok);
  return { stages, diagnosis: first ? first.ifFail : 'All checks passed. The network ladder is healthy; the problem is likely specific to a site or application.', ok: !first };
}
const format = (r) => r.stages.map((s) => `${s.ok ? 'PASS' : 'FAIL'} — ${s.name}${s.detail ? ' [' + s.detail + ']' : ''}`).join('\n') + '\n\nDiagnosis: ' + r.diagnosis;

if (require.main === module) {
  console.log('Northlight Network Doctor (read-only)\n');
  diagnose().then((r) => { console.log(format(r)); process.exitCode = r.ok ? 0 : 1; });
}
module.exports = { diagnose, format };
