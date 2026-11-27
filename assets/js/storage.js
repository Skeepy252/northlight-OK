/* Central shared data layer. Every page reads/writes ONE localStorage key (NL_CONFIG.storageKey).
   localStorage is per browser/profile: nothing here is sent to a server or shared between visitors. */
(function () {
  'use strict';
  const CFG = window.NL_CONFIG;
  const NL = (window.NL = window.NL || {});
  const KEY = CFG.storageKey;
  const COLLECTIONS = ['staff', 'tickets', 'leads', 'accounts', 'contacts', 'opportunities', 'cases', 'logs', 'outbox'];
  const PREFIX = { staff: 'USR', tickets: 'TCK', leads: 'LEAD', accounts: 'ACC', contacts: 'CON', opportunities: 'OPP', cases: 'CASE', logs: 'LOG', outbox: 'MSG' };
  const now = () => new Date().toISOString();

  /* ---------- SLA helpers (used by seed, help desk, automation) ---------- */
  function addWorkdays(date, n) {
    const d = new Date(date);
    while (n > 0) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) n--; }
    return d;
  }
  NL.sla = {
    dueAt(priority, fromIso) {
      const rule = CFG.sla[priority] || CFG.sla.P3;
      const from = new Date(fromIso || Date.now());
      return (rule.hours ? new Date(from.getTime() + rule.hours * 3600e3) : addWorkdays(from, rule.workdays)).toISOString();
    }
  };

  /* ---------- state lifecycle ---------- */
  let mem = null; // fallback if localStorage is blocked
  const MIGRATIONS = {
    0: (s) => { s.settings = s.settings || {}; } // v0 -> v1: settings block introduced. Add further steps as schema grows.
  };
  function migrate(s) {
    if (typeof s.schemaVersion !== 'number') s.schemaVersion = 0;
    while (s.schemaVersion < CFG.schemaVersion) { if (MIGRATIONS[s.schemaVersion]) MIGRATIONS[s.schemaVersion](s); s.schemaVersion++; }
    COLLECTIONS.forEach((c) => { if (!Array.isArray(s[c])) s[c] = []; });
    s.settings = s.settings && typeof s.settings === 'object' ? s.settings : {};
    s.settings.counters = s.settings.counters || {};
    s.settings.disabledRules = Array.isArray(s.settings.disabledRules) ? s.settings.disabledRules : [];
    return s;
  }
  function rawGet() { try { return localStorage.getItem(KEY); } catch (e) { return mem; } }
  function write(s) {
    const json = JSON.stringify(s);
    mem = json;
    try { localStorage.setItem(KEY, json); NL.store.persistent = true; } catch (e) { NL.store.persistent = false; if (e && e.name === 'QuotaExceededError') throw e; }
    window.dispatchEvent(new CustomEvent('nl:change'));
  }
  function load() {
    const raw = rawGet();
    if (raw) {
      try { const p = JSON.parse(raw); if (p && typeof p === 'object' && !Array.isArray(p)) return migrate(p); } catch (e) { /* fall through */ }
      try { localStorage.setItem(KEY + '.corrupt', raw); } catch (e) { /* ignore */ }
      NL.store.recovered = true; // malformed data: keep a copy, start from a clean seed
    }
    const s = seed();
    write(s);
    return s;
  }
  function nextId(s, coll) {
    const c = s.settings.counters;
    c[coll] = (c[coll] || 1000) + 1;
    return PREFIX[coll] + '-' + c[coll];
  }

  NL.store = {
    persistent: true,
    recovered: false,
    collections: COLLECTIONS,
    /** Ensure state exists/valid. Safe to call on every page. */
    init() { load(); return this; },
    state() { return load(); },
    list(coll) { return load()[coll] || []; },
    find(coll, id) { return this.list(coll).find((r) => r.id === id) || null; },
    /** Atomic read-modify-write. fn receives the full state and may mutate it. */
    mutate(fn) { const s = load(); const r = fn(s); write(s); return r; },
    create(coll, rec) {
      return this.mutate((s) => { const r = Object.assign({ createdAt: now() }, rec); r.id = r.id || nextId(s, coll); s[coll].push(r); return r; });
    },
    /** patch: object or function(record) -> mutates record. Returns updated record or null. */
    update(coll, id, patch) {
      return this.mutate((s) => {
        const r = s[coll].find((x) => x.id === id);
        if (!r) return null;
        if (typeof patch === 'function') patch(r); else Object.assign(r, patch);
        r.updatedAt = now();
        return r;
      });
    },
    remove(coll, id) { return this.mutate((s) => { const n = s[coll].length; s[coll] = s[coll].filter((x) => x.id !== id); return s[coll].length < n; }); },
    setting(key, dflt) { const v = load().settings[key]; return v === undefined ? dflt : v; },
    setSetting(key, val) { this.mutate((s) => { s.settings[key] = val; }); },
    /** Append to the automation log. */
    log(entry) { return this.create('logs', Object.assign({ at: now() }, entry)); },
    onChange(cb) {
      window.addEventListener('nl:change', cb);
      window.addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) cb(); });
    },
    /** All data as one object. Credentials/secret material of the demo accounts is redacted. */
    exportAll() {
      const s = JSON.parse(JSON.stringify(load()));
      s.staff.forEach((u) => { delete u.cred; delete u.mfaSecret; });
      return { exportedAt: now(), application: CFG.appName, note: 'Fictional demo data. Password hashes and MFA secrets are not exported.', data: s };
    },
    reset() { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '.corrupt'); sessionStorage.removeItem(CFG.sessionKey); } catch (e) { /* ignore */ } mem = null; load(); }
  };

  /* ---------- fictional seed data ---------- */
  function seed() {
    const s = migrate({ schemaVersion: CFG.schemaVersion, createdAt: now(), settings: {} });
    const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
    const add = (coll, rec) => { rec.id = rec.id || nextId(s, coll); s[coll].push(rec); return rec; };

    [['Jordan Lee', 'IT Administrator', 'IT', 'it-admin'], ['Casey Morgan', 'IT Support', 'IT', 'it-support'],
      ['Alex Rivera', 'Sales', 'Sales', 'sales'], ['Taylor Brooks', 'Sales Manager', 'Sales', 'sales'],
      ['Sam Patel', 'Designer', 'Design', 'design'], ['Maya Chen', 'New Starter', 'Design', 'design']].forEach(([name, title, dept, role]) => {
      const email = name.toLowerCase().replace(' ', '.') + '@northlight.example';
      add('staff', { name, email, title, department: dept, accessRole: role, status: 'active', demo: true, mfaEnabled: true, createdAt: now(),
        events: [{ at: now(), text: 'Demo account created' }] });
    });

    const t = (min, o) => {
      const createdAt = ago(min);
      const p = o.priority;
      return add('tickets', Object.assign({ status: 'New', createdAt, dueAt: NL.sla.dueAt(p, createdAt), resolution: '', replies: [], source: 'seed',
        history: [{ at: createdAt, text: 'Ticket created' }] }, o));
    };
    t(10, { requester: 'Studio Director', department: 'Management', priority: 'P1', impact: 'blocked', urgency: 'critical',
      description: 'Studio director cannot access email before a client meeting in 30 minutes.' });
    t(7 * 24 * 60, { requester: 'Alex Rivera', department: 'Sales', priority: 'P3', impact: 'minor', urgency: 'normal', status: 'In Progress',
      description: 'Second-floor printer prints blank pages.' });
    t(120, { requester: 'Sam Patel', department: 'Design', priority: 'P2', impact: 'blocked', urgency: 'high',
      description: 'New starter Maya begins Monday and needs a laptop and accounts.' });
    t(90, { requester: 'Finance team', department: 'Finance', priority: 'P1', impact: 'multiple', urgency: 'critical', category: 'security',
      description: 'Three finance employees received a suspicious invoice attachment and one opened it.' });
    t(26 * 60, { requester: 'Taylor Brooks', department: 'Sales', priority: 'P3', impact: 'minor', urgency: 'normal',
      description: 'Wi-Fi is slow in the meeting room.' });

    [['Priya Nair', 'Harbor & Pine Coffee', 'priya.nair@harborpine.example', 'Website', 'New', 'Interested in a full rebrand ahead of a second location.'],
      ['Marcus Webb', 'Linden Biotech', 'marcus.webb@lindenbio.example', 'Referral', 'Contacted', 'Needs investor-deck design; call booked.'],
      ['Elena Rossi', 'Atlas Outdoor', 'elena.rossi@atlasoutdoor.example', 'Event', 'Qualified', 'Seasonal campaign, budget confirmed.']].forEach(([name, company, email, source, status, notes], i) => {
      add('leads', { name, company, email, source, status, notes, createdAt: ago((i + 1) * 1440) });
    });

    const a1 = add('accounts', { name: 'Brightwater Hotels', industry: 'Hospitality', contactEmail: 'hello@brightwater.example', notes: 'Long-term brand client.', status: 'Active', createdAt: ago(60 * 24 * 90) });
    const a2 = add('accounts', { name: 'Orchard Lane Foods', industry: 'Food & Beverage', contactEmail: 'hello@orchardlane.example', notes: 'Packaging and seasonal campaigns.', status: 'Active', createdAt: ago(60 * 24 * 40) });
    add('contacts', { name: 'Dana Whitfield', email: 'dana.whitfield@brightwater.example', accountId: a1.id, role: 'Marketing Director' });
    add('contacts', { name: 'Tom Okafor', email: 'tom.okafor@orchardlane.example', accountId: a2.id, role: 'Brand Manager' });
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    [['Brightwater brand refresh', a1, 24000, 'Quote', 21], ['Orchard packaging redesign', a2, 12000, 'Qualified', 35],
      ['Brightwater website rebuild', a1, 18000, 'Won', -14], ['Orchard seasonal campaign', a2, 6000, 'Lead', 60], ['Orchard loyalty app UI', a2, 4000, 'Lost', -30]]
      .forEach(([name, acc, value, stage, d]) => add('opportunities', { name, accountId: acc.id, value, stage, closeDate: day(d) }));
    add('cases', { customer: 'Brightwater Hotels', accountId: a1.id, description: 'Logo files missing from the delivery package.', priority: 'High', status: 'Open', dueDate: day(-1), createdAt: ago(3 * 1440) });

    s.logs.push({ id: nextId(s, 'logs'), at: now(), level: 'info', ruleId: 'system', message: 'Demo environment initialised with fictional seed data.' });
    return s;
  }
})();
