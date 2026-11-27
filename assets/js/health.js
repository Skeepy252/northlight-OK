/* System health page: real checks, PASS / FAIL, nothing decorative. */
(function () {
  'use strict';
  const { h, $, mount, store, badge } = NL;
  const CFG = NL_CONFIG;

  async function runChecks() {
    const checks = [];
    const add = (name, ok, detail) => checks.push({ name, ok, detail });
    add('Application configuration', !!(CFG && CFG.storageKey && CFG.schemaVersion), 'config.js loaded; storage key ' + CFG.storageKey);
    add('Browser storage writable', store.persistent, store.persistent ? 'localStorage accepts writes' : 'Storage is blocked: data is kept in memory only');
    const s = store.state();
    add('Data schema version', s.schemaVersion === CFG.schemaVersion, 'Stored v' + s.schemaVersion + ', expected v' + CFG.schemaVersion);
    add('Data collections intact', store.collections.every((c) => Array.isArray(s[c])), store.collections.length + ' collections present');
    let health = null;
    try { const r = await fetch(CFG.healthUrl, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); health = await r.json(); add('health.json reachable', true, 'Version ' + health.version); } catch (e) { add('health.json reachable', false, e.message); }
    try { const d = await NL.automation.loadRules(); add('Automation rules valid', true, d.rules.length + ' rules loaded from rules.json'); } catch (e) { add('Automation rules valid', false, e.message); }
    return { checks, health };
  }

  async function render() {
    mount($('#health-checks'), h('p', { class: 'muted' }, 'Running checks…'));
    const { checks, health } = await runChecks();
    const bad = checks.filter((c) => !c.ok);
    mount($('#health-banner'), bad.length ? NL.alert('error', bad.length + ' of ' + checks.length + ' checks failed.') : NL.alert('success', 'All ' + checks.length + ' checks passed. The demo environment is healthy.'));
    mount($('#health-checks'), h('ul', { class: 'check-list' }, checks.map((c) => h('li', null, badge(c.ok ? 'PASS' : 'FAIL', c.ok ? 'ok' : 'danger'), h('span', { class: 'grow' }, h('strong', null, c.name), h('small', null, c.detail))))));
    mount($('#health-build'), health ? h('dl', { class: 'kv' }, ['application', 'version', 'buildDate', 'environment'].flatMap((k) => [h('dt', null, k), h('dd', null, health[k])])) : NL.empty('Unavailable', 'health.json could not be read.'));
    const size = (new Blob([JSON.stringify(store.state())]).size / 1024).toFixed(1);
    mount($('#health-data'), NL.table([{ label: 'Collection', render: (c) => c }, { label: 'Records', render: (c) => String(store.list(c).length) }], store.collections, { caption: 'Records per collection' }),
      h('p', { class: 'hint' }, 'Total size about ' + size + ' KB in this browser only.'),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: NL.exportAll }, 'Export all data')));
  }
  $('#recheck').addEventListener('click', render);
  store.onChange(() => { if (!document.hidden) render(); });
  render();
})();
