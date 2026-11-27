#!/usr/bin/env node
// Read-only PC health report. Changes nothing, installs nothing, needs no admin rights.
// Run only on machines you are authorised to inspect:  node tools/pc-health.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Fixed commands only - no user-supplied input ever reaches a shell.
function realRun(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
}

const MAX_UPDATE_AGE_DAYS = 60; // heuristic: newest installed update older than this => FAIL
const MIN_FREE_PERCENT = 10;

function checkDisk(deps) {
  try {
    const root = path.parse(deps.cwd).root;
    const s = deps.statfs(root);
    const free = s.bavail * s.bsize, total = s.blocks * s.bsize;
    const pct = (free / total) * 100;
    const gb = (n) => (n / 1024 ** 3).toFixed(1) + ' GB';
    return { name: 'Disk space', status: pct >= MIN_FREE_PERCENT ? 'PASS' : 'FAIL', detail: `${gb(free)} free of ${gb(total)} (${pct.toFixed(0)}%) on ${root}` };
  } catch (e) { return { name: 'Disk space', status: 'UNKNOWN', detail: 'Could not read disk information.' }; }
}

function checkFirewall(deps) {
  const unknown = (d) => ({ name: 'Firewall', status: 'UNKNOWN', detail: d });
  try {
    if (deps.platform === 'win32') {
      const out = deps.run('netsh', ['advfirewall', 'show', 'allprofiles', 'state']);
      const states = [...out.matchAll(/^\s*State\s+(\S+)/gim)].map((m) => m[1].toUpperCase());
      if (!states.length) return unknown('Firewall state output not recognised (non-English Windows?).');
      return states.every((s) => s === 'ON') ? { name: 'Firewall', status: 'PASS', detail: 'All firewall profiles are ON.' } : { name: 'Firewall', status: 'FAIL', detail: 'At least one firewall profile is OFF.' };
    }
    if (deps.platform === 'darwin') {
      const out = deps.run('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate']);
      return /enabled/i.test(out) ? { name: 'Firewall', status: 'PASS', detail: 'Application firewall is enabled.' } : { name: 'Firewall', status: 'FAIL', detail: 'Application firewall is disabled.' };
    }
    const out = deps.run('firewall-cmd', ['--state']);
    return /running/i.test(out) ? { name: 'Firewall', status: 'PASS', detail: 'firewalld is running.' } : { name: 'Firewall', status: 'FAIL', detail: 'firewalld is not running.' };
  } catch (e) { return unknown('Could not query firewall (tool missing or administrator rights needed).'); }
}

function checkUpdates(deps) {
  const unknown = (d) => ({ name: 'Updates', status: 'UNKNOWN', detail: d });
  try {
    if (deps.platform === 'win32') {
      const out = deps.run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn.ToString("yyyy-MM-dd")']).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(out)) return unknown('Could not determine the date of the latest installed update.');
      const age = Math.floor((deps.now() - new Date(out).getTime()) / 864e5);
      return age <= MAX_UPDATE_AGE_DAYS ? { name: 'Updates', status: 'PASS', detail: `Latest installed update dated ${out} (${age} days ago).` } : { name: 'Updates', status: 'FAIL', detail: `Latest installed update dated ${out} (${age} days ago, limit ${MAX_UPDATE_AGE_DAYS}).` };
    }
    return unknown('Update status check is only implemented for Windows; check your OS update settings manually.');
  } catch (e) { return unknown('Could not read update history.'); }
}

function collect(deps) {
  deps = Object.assign({ platform: process.platform, run: realRun, statfs: (p) => fs.statfsSync(p), cwd: process.cwd(), now: Date.now }, deps);
  return [
    { name: 'Operating system', status: 'PASS', detail: `${os.type()} ${os.release()} (${os.version ? os.version() : 'n/a'}), arch ${os.arch()}` },
    checkDisk(deps), checkFirewall(deps), checkUpdates(deps)
  ];
}
const format = (results) => results.map((r) => `${r.status.padEnd(7)} — ${r.name}: ${r.detail}`).join('\n');

if (require.main === module) {
  const results = collect();
  console.log('Northlight PC Health Report (read-only)\n' + format(results));
  console.log('\nUNKNOWN means the information could not be collected - it is not a pass.');
  process.exitCode = results.some((r) => r.status === 'FAIL') ? 1 : 0;
}
module.exports = { collect, format };
