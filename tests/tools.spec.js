// Node-side tests of the CLI tools with MOCKED command output: no network access, no system changes.
const { test, expect } = require('@playwright/test');
const { collect, format } = require('../tools/pc-health');
const { diagnose } = require('../tools/network-doctor');

const iface = (address, family = 'IPv4') => ({ eth0: [{ address, family, internal: false }] });

test.describe('pc-health (mocked)', () => {
  const statfs = () => ({ bavail: 50, blocks: 100, bsize: 1024 ** 3 });
  test('Windows all PASS', () => {
    const run = (cmd) => (cmd === 'netsh' ? 'Domain Profile Settings:\nState                                 ON\nPrivate Profile Settings:\nState ON\n' : new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10));
    const r = collect({ platform: 'win32', run, statfs });
    expect(r.map((x) => x.status)).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
  });
  test('firewall off and old updates FAIL; low disk FAIL', () => {
    const run = (cmd) => (cmd === 'netsh' ? 'State OFF\nState ON' : '2020-01-01');
    const r = collect({ platform: 'win32', run, statfs: () => ({ bavail: 1, blocks: 100, bsize: 1 }) });
    expect(r.map((x) => x.status)).toEqual(['PASS', 'FAIL', 'FAIL', 'FAIL']);
  });
  test('unavailable data is UNKNOWN, never PASS', () => {
    const r = collect({ platform: 'linux', run: () => { throw new Error('nope'); }, statfs: () => { throw new Error('x'); } });
    expect(r.map((x) => x.status)).toEqual(['PASS', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
    expect(format(r)).toContain('UNKNOWN');
  });
});

test.describe('network-doctor (mocked)', () => {
  const run = (fails = []) => (cmd, args) => {
    if (cmd === 'ip') return 'default via 192.168.1.1 dev eth0';
    if (cmd === 'ping') { if (fails.includes(args[args.length - 1])) throw new Error('timeout'); return 'ok'; }
    throw new Error('unexpected command ' + cmd);
  };
  const base = { platform: 'linux', interfaces: () => iface('192.168.1.20'), lookup: async () => ({ address: '93.184.216.34' }) };

  test('everything passes', async () => {
    const r = await diagnose({ ...base, run: run() });
    expect(r.ok).toBe(true); expect(r.stages).toHaveLength(6);
  });
  test('DNS failure is diagnosed as a DNS problem', async () => {
    const r = await diagnose({ ...base, run: run(), lookup: async () => { throw new Error('ENOTFOUND'); } });
    expect(r.ok).toBe(false); expect(r.diagnosis).toContain('DNS');
  });
  test('no interface fails first stage', async () => {
    const r = await diagnose({ ...base, interfaces: () => ({}), run: run() });
    expect(r.stages[0].ok).toBe(false); expect(r.diagnosis).toContain('No active network');
  });
  test('self-assigned IP is a DHCP problem', async () => {
    const r = await diagnose({ ...base, interfaces: () => iface('169.254.3.4'), run: run() });
    expect(r.diagnosis).toContain('DHCP');
  });
  test('router down vs internet down', async () => {
    expect((await diagnose({ ...base, run: run(['192.168.1.1']) })).diagnosis).toContain('Router did not answer');
    expect((await diagnose({ ...base, run: run(['1.1.1.1']) })).diagnosis).toContain('WAN');
  });
});

test.describe('troubleshooting page', () => {
  test('click-through reaches DNS result and back works', async ({ page }) => {
    await page.goto('troubleshoot.html');
    for (let i = 0; i < 4; i++) await page.click('#yes');
    await page.click('#no');
    await expect(page.locator('#result')).toContainText('DNS problem');
    await page.click('#back');
    await expect(page.locator('#question')).toContainText('Step 5 of 5');
    await page.click('#no'); await page.click('#restart');
    await expect(page.locator('#question')).toContainText('Step 1 of 5');
  });
  test('first step "No" gives link cause', async ({ page }) => {
    await page.goto('troubleshoot.html');
    await page.click('#no');
    await expect(page.locator('#result')).toContainText('No network connection');
  });
});
