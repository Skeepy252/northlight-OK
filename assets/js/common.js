/* Shared UI helpers: safe DOM builder, page shell (header/footer), badges, tables, ticket helpers.
   Untrusted text is ONLY ever inserted via textContent / text nodes - there is no innerHTML anywhere. */
(function () {
  'use strict';
  const CFG = window.NL_CONFIG;
  const NL = (window.NL = window.NL || {});
  NL.store.init();

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function build(el, attrs, kids) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (/^on/i.test(k)) continue; // never allow string event handlers
      else el.setAttribute(k, v === true ? '' : v);
    }
    (function add(list) {
      for (const c of list) {
        if (c == null || c === false) continue;
        if (Array.isArray(c)) add(c); else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
      }
    })(kids);
    return el;
  }
  NL.h = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);
  NL.svg = (tag, attrs, ...kids) => build(document.createElementNS(SVG_NS, tag), attrs, kids);
  NL.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  NL.$ = (sel, root) => (root || document).querySelector(sel);
  NL.mount = (el, ...kids) => { NL.clear(el).append(...kids.flat().filter((k) => k != null)); };

  /* ---------- formatting ---------- */
  NL.fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  NL.fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—');
  NL.money = (n) => Number(n || 0).toLocaleString('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  NL.relTime = (iso) => {
    const diff = new Date(iso).getTime() - Date.now(); const abs = Math.abs(diff);
    const mins = Math.round(abs / 60e3); const txt = mins < 60 ? mins + ' min' : mins < 2880 ? Math.round(mins / 60) + ' h' : Math.round(mins / 1440) + ' d';
    return diff < 0 ? 'overdue by ' + txt : 'due in ' + txt;
  };

  /* ---------- small components ---------- */
  NL.badge = (text, kind) => NL.h('span', { class: 'badge badge-' + (kind || 'muted') }, text);
  NL.empty = (title, text, action) => NL.h('div', { class: 'empty' }, NL.h('strong', null, title), NL.h('p', null, text), action || null);
  NL.alert = (kind, text, role) => NL.h('div', { class: 'alert alert-' + kind, role: role || (kind === 'error' ? 'alert' : 'status') }, text);
  /** cols: [{label, render(row) -> Node|string}] */
  NL.table = (cols, rows, opts) => {
    opts = opts || {};
    if (!rows.length) return NL.empty(opts.emptyTitle || 'Nothing here yet', opts.emptyText || 'No records match.');
    return NL.h('div', { class: 'table-wrap' }, NL.h('table', { class: 'table' },
      NL.h('caption', { class: 'sr-only' }, opts.caption || 'Data table'),
      NL.h('thead', null, NL.h('tr', null, cols.map((c) => NL.h('th', { scope: 'col' }, c.label)))),
      NL.h('tbody', null, rows.map((r) => NL.h('tr', opts.rowAttrs ? opts.rowAttrs(r) : null, cols.map((c) => NL.h('td', { 'data-label': c.label }, c.render(r))))))));
  };
  NL.field = (id, label, control, error) => NL.h('div', { class: 'field' }, NL.h('label', { for: id }, label), control, NL.h('p', { class: 'field-error', id: id + '-error', hidden: true }));
  NL.setError = (input, msg) => {
    const err = document.getElementById(input.id + '-error');
    if (!err) return;
    err.textContent = msg || ''; err.hidden = !msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    input.setAttribute('aria-describedby', err.id);
  };
  NL.toast = (msg, kind) => {
    let box = document.getElementById('toasts');
    if (!box) { box = NL.h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
    const t = NL.h('div', { class: 'toast toast-' + (kind || 'ok') }, msg); box.append(t);
    setTimeout(() => t.remove(), 4000);
  };
  NL.download = (filename, obj) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    const a = NL.h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  NL.exportAll = () => {
    NL.download('northlight-studio-export-' + new Date().toISOString().slice(0, 10) + '.json', NL.store.exportAll());
    NL.toast('Export downloaded (nothing was uploaded).');
  };

  /* ---------- tickets (shared by help desk, website, automation, staff) ---------- */
  const RANK = { P1: 1, P2: 2, P3: 3 };
  NL.tickets = {
    PRIORITIES: { P1: 'P1 — Critical', P2: 'P2 — High', P3: 'P3 — Normal' },
    /** Impact: multiple | blocked | minor. Urgency: critical | high | normal. */
    computePriority(impact, urgency) {
      if (impact === 'multiple' || urgency === 'critical') return 'P1';
      if (impact === 'blocked' || urgency === 'high') return 'P2';
      return 'P3';
    },
    isSecurity: (text) => /phish|malware|ransom|suspicious|virus|breach/i.test(text || ''),
    create(d) {
      const createdAt = new Date().toISOString();
      const priority = d.priority || NL.tickets.computePriority(d.impact, d.urgency);
      return NL.store.create('tickets', {
        requester: d.requester, department: d.department || 'External', description: d.description, impact: d.impact || 'minor', urgency: d.urgency || 'normal',
        priority, status: 'New', createdAt, dueAt: NL.sla.dueAt(priority, createdAt), resolution: '', replies: [],
        category: d.category || (NL.tickets.isSecurity(d.description) ? 'security' : 'general'), source: d.source || 'helpdesk',
        leadId: d.leadId || null, submissionId: d.submissionId || null,
        history: [{ at: createdAt, text: 'Ticket created via ' + (d.source || 'helpdesk') + ' with priority ' + priority }]
      });
    },
    isOverdue: (t) => t.status !== 'Resolved' && new Date(t.dueAt).getTime() < Date.now(),
    sort: (list) => list.slice().sort((a, b) => (RANK[a.priority] - RANK[b.priority]) || (new Date(a.createdAt) - new Date(b.createdAt)))
  };
  NL.priorityBadge = (p) => NL.badge(p, p.toLowerCase());

  /* ---------- page shell ---------- */
  const NAV = [['index.html', 'Home', 'home'], ['helpdesk.html', 'Help Desk', 'helpdesk'], ['staff.html', 'Staff', 'staff'],
    ['crm.html', 'CRM', 'crm'], ['automation.html', 'Automation', 'automation'], ['troubleshoot.html', 'Troubleshooting', 'troubleshoot']];

  function logo() {
    return NL.svg('svg', { viewBox: '0 0 32 32', width: 32, height: 32, 'aria-hidden': 'true', focusable: 'false' },
      NL.svg('rect', { width: 32, height: 32, rx: 8, fill: '#0e7466' }),
      NL.svg('path', { d: 'M6 22 L16 8 L26 22 Z', fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linejoin': 'round' }),
      NL.svg('circle', { cx: 16, cy: 17, r: 2.6, fill: '#f2a93b' }));
  }
  function renderShell() {
    const page = document.body.dataset.page;
    const header = document.getElementById('app-header');
    if (header && page !== 'home') NL.renderApp(header, page);
    else if (header) {
      const toggle = NL.h('button', { class: 'nav-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'main-nav', onclick: () => {
        const open = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); } }, 'Menu');
      const nav = NL.h('nav', { id: 'main-nav', class: 'nav', 'aria-label': 'Main' }, NAV.map(([href, label, key]) =>
        NL.h('a', { href, 'aria-current': key === page ? 'page' : null }, label)));
      NL.mount(header, NL.h('div', { class: 'container header-inner' },
        NL.h('a', { class: 'brand', href: 'index.html' }, logo(), NL.h('span', null, CFG.appName)), toggle, nav, NL.h('a', { class: 'btn sm header-cta', href: 'dashboard.html' }, 'Open dashboard')));
    }
    const footer = document.getElementById('app-footer');
    if (footer) {
      const health = NL.h('span', { id: 'health-line' }, 'Version info loading…');
      NL.mount(footer, NL.h('div', { class: 'container footer-inner' },
        NL.h('div', null, NL.h('strong', null, CFG.appName), NL.h('p', { class: 'muted' },
          'A fictional company used for an IT learning project. All people, companies and data are invented. Data lives only in this browser (localStorage).')),
        NL.h('div', { class: 'footer-actions' },
          NL.h('button', { class: 'btn ghost sm', type: 'button', id: 'export-all', onclick: NL.exportAll }, 'Export all data'),
          NL.h('button', { class: 'btn ghost sm', type: 'button', id: 'reset-demo', onclick: () => {
            if (confirm('Reset the demo environment? All local changes in this browser will be replaced by the sample data.')) { NL.store.reset(); NL.toast('Demo data reset.'); }
          } }, 'Reset demo data'),
          NL.h('p', { class: 'muted small' }, health))));
      fetch(CFG.healthUrl, { cache: 'no-store' }).then((r) => r.json()).then((h) => {
        health.textContent = 'v' + h.version + ' · ' + h.environment + ' · build ' + h.buildDate; NL.health = h;
        window.dispatchEvent(new CustomEvent('nl:health'));
      }).catch(() => { health.textContent = 'Health info unavailable'; });
    }
    if (NL.store.recovered) NL.toast('Stored data was unreadable and has been reset to sample data.', 'warn');
    if (!NL.store.persistent) NL.toast('Browser storage is blocked: data will be lost when you close this tab.', 'warn');
  }
  /* ---------- reusable widgets ---------- */
  NL.avatar = (name, cls) => {
    const parts = String(name || '?').trim().split(/\s+/);
    const initials = ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    let n = 0; for (const c of String(name)) n = (n * 31 + c.charCodeAt(0)) % 6;
    return NL.h('span', { class: 'avatar av-' + n + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, initials);
  };
  NL.STAGES = ['Lead', 'Qualified', 'Quote', 'Won', 'Lost'];
  NL.pipelineStrip = () => {
    const opps = NL.store.list('opportunities');
    return NL.h('ol', { class: 'pipeline', 'aria-label': 'Sales pipeline stages' }, NL.STAGES.map((s) => {
      const o = opps.filter((x) => x.stage === s);
      return NL.h('li', { class: 'pipe-step pipe-' + s.toLowerCase(), 'data-stage': s }, NL.h('span', { class: 'pipe-name' }, s), NL.h('strong', null, String(o.length)),
        NL.h('span', { class: 'pipe-val' }, NL.money(o.reduce((a, x) => a + Number(x.value || 0), 0))));
    }));
  };
  NL.currentUser = () => {
    try { const s = JSON.parse(sessionStorage.getItem(CFG.sessionKey)); const u = s && NL.store.find('staff', s.id); return u && u.status === 'active' ? u : null; } catch (e) { return null; }
  };

  /* ---------- application shell: sidebar + top bar (all app pages) ---------- */
  const ICONS = {
    dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z', helpdesk: 'M4 5h16v11H9l-5 4z', staff: 'M15.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM4.5 21c0-3.8 3.4-6 7.5-6s7.5 2.2 7.5 6',
    crm: 'M4 20V11M10 20V4M16 20v-7M22 20H2', automation: 'M13 2 4 14h7l-1 8 9-12h-7z', troubleshoot: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.1-.6-.6-2.1z',
    health: 'M3 12h4l3-8 4 16 3-8h4', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5', bell: 'M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0', menu: 'M4 6h16M4 12h16M4 18h16', theme: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'
  };
  const icon = (k) => NL.svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, NL.svg('path', { d: ICONS[k] }));
  const APP_NAV = [['dashboard.html', 'Dashboard', 'dashboard'], ['helpdesk.html', 'Help Desk', 'helpdesk'], ['staff.html', 'Staff Directory', 'staff'], ['crm.html', 'CRM', 'crm'],
    ['automation.html', 'Automation', 'automation'], ['troubleshoot.html', 'Troubleshooting', 'troubleshoot'], ['health.html', 'System Health', 'health']];

  function searchIndex(q) {
    q = q.toLowerCase(); const S = NL.store, has = (...f) => f.join(' ').toLowerCase().includes(q), out = [];
    const add = (group, label, href) => out.push({ group, label, href });
    S.list('tickets').filter((t) => has(t.id, t.description, t.requester)).slice(0, 3).forEach((t) => add('Tickets', t.id + ' · ' + t.description.slice(0, 60), 'helpdesk.html?q=' + encodeURIComponent(t.id)));
    S.list('leads').filter((l) => has(l.id, l.name, l.company, l.email)).slice(0, 3).forEach((l) => add('Leads', l.name + ' · ' + l.company, 'crm.html?tab=leads&q=' + encodeURIComponent(l.name)));
    S.list('accounts').filter((a) => has(a.name, a.industry)).slice(0, 3).forEach((a) => add('Accounts', a.name, 'crm.html?tab=accounts&q=' + encodeURIComponent(a.name)));
    S.list('staff').filter((s) => has(s.name, s.email, s.title)).slice(0, 3).forEach((s) => add('Staff', s.name + ' · ' + s.title, 'staff.html?q=' + encodeURIComponent(s.name)));
    return out;
  }
  function notifications() {
    const S = NL.store, T = S.list('tickets'), open = T.filter((t) => t.status !== 'Resolved'), today = new Date().toISOString().slice(0, 10);
    return [[open.filter((t) => t.priority === 'P1').length, 'open P1 critical tickets', 'helpdesk.html?priority=P1'], [T.filter(NL.tickets.isOverdue).length, 'overdue tickets', 'helpdesk.html'],
      [S.list('cases').filter((c) => c.status !== 'Closed' && c.dueDate < today).length, 'overdue CRM support cases', 'crm.html?tab=cases'], [S.list('outbox').length, 'alerts in the simulated outbox', 'automation.html']].filter((n) => n[0] > 0);
  }

  NL.renderApp = (header, page) => {
    const main = document.getElementById('main'), footer = document.getElementById('app-footer');
    const title = document.title.split(' | ')[0];
    const scrim = NL.h('div', { class: 'scrim', onclick: () => setNav(false) });
    const sidebar = NL.h('aside', { class: 'sidebar', id: 'app-sidebar', 'aria-label': 'Sidebar' },
      NL.h('a', { class: 'brand', href: 'dashboard.html' }, logo(), NL.h('span', null, CFG.appName)),
      NL.h('nav', { id: 'side-nav', class: 'side-nav', 'aria-label': 'Main' }, APP_NAV.map(([href, label, key]) =>
        NL.h('a', { class: 'side-link', href, 'aria-current': key === page ? 'page' : null }, icon(key), NL.h('span', null, label)))),
      NL.h('div', { class: 'side-foot' }, NL.h('a', { class: 'side-link', href: 'index.html' }, icon('globe'), NL.h('span', null, 'Public website')),
        NL.h('p', { class: 'small muted' }, 'Fictional demo. Data stays in this browser.')));
    const menuBtn = NL.h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Open navigation', 'aria-controls': 'app-sidebar', 'aria-expanded': 'false', onclick: () => setNav(!sidebar.classList.contains('open')) }, icon('menu'));
    function setNav(open) { sidebar.classList.toggle('open', open); scrim.classList.toggle('show', open); menuBtn.setAttribute('aria-expanded', String(open)); }

    const crumbs = NL.h('div', { class: 'crumbs' }, NL.h('nav', { 'aria-label': 'Breadcrumb' }, NL.h('ol', null, NL.h('li', null, NL.h('a', { href: 'dashboard.html' }, 'Northlight')), NL.h('li', { 'aria-current': 'page' }, title))),
      NL.h('span', { class: 'page-title' }, title));

    const input = NL.h('input', { id: 'global-search', type: 'search', placeholder: 'Search tickets, leads, staff…', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'search-results' });
    const results = NL.h('div', { class: 'popover results', id: 'search-results', role: 'listbox', hidden: true });
    const search = NL.h('div', { class: 'gsearch' }, NL.h('label', { class: 'sr-only', for: 'global-search' }, 'Search the system'), icon('search'), input, results);
    function runSearch() {
      const q = input.value.trim();
      if (q.length < 2) { results.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
      const r = searchIndex(q); results.hidden = false; input.setAttribute('aria-expanded', 'true');
      if (!r.length) return NL.mount(results, NL.h('p', { class: 'muted small pad' }, 'No results for “' + q + '”.'));
      const groups = [...new Set(r.map((x) => x.group))];
      NL.mount(results, groups.map((g) => NL.h('div', null, NL.h('p', { class: 'group' }, g), r.filter((x) => x.group === g).map((x) => NL.h('a', { class: 'result-item', role: 'option', href: x.href }, x.label)))));
    }
    input.addEventListener('input', runSearch);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { results.hidden = true; } if (e.key === 'Enter') { const a = results.querySelector('a'); if (a) location.href = a.getAttribute('href'); } });

    const themeBtn = NL.h('button', { class: 'icon-btn', type: 'button', id: 'theme-toggle', 'aria-pressed': String(window.NL_THEME.get() === 'glow'), onclick: () => {
      const next = window.NL_THEME.get() === 'glow' ? 'light' : 'glow'; window.NL_THEME.set(next); themeBtn.setAttribute('aria-pressed', String(next === 'glow'));
      themeBtn.setAttribute('aria-label', next === 'glow' ? 'Switch to light theme' : 'Switch to glow theme'); } }, icon('theme'));
    themeBtn.setAttribute('aria-label', window.NL_THEME.get() === 'glow' ? 'Switch to light theme' : 'Switch to glow theme');

    const badge = NL.h('span', { class: 'bell-badge', id: 'bell-count' });
    const bellMenu = NL.h('div', { class: 'popover notifs', id: 'notif-menu', hidden: true });
    const bell = NL.h('button', { class: 'icon-btn bell', type: 'button', id: 'bell', 'aria-label': 'Notifications', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => {
      bellMenu.hidden = !bellMenu.hidden; bell.setAttribute('aria-expanded', String(!bellMenu.hidden)); } }, icon('bell'), badge);
    function renderNotifs() {
      const n = notifications(), total = n.reduce((a, x) => a + x[0], 0);
      badge.textContent = total ? String(total) : ''; badge.hidden = !total;
      NL.mount(bellMenu, NL.h('p', { class: 'group' }, 'Notifications'), n.length ? n.map(([c, t, href]) => NL.h('a', { class: 'result-item', href }, NL.h('strong', null, String(c)), ' ' + t)) : NL.h('p', { class: 'muted small pad' }, 'You are all caught up.'));
    }

    const profile = NL.h('a', { class: 'profile', id: 'profile', href: 'staff.html' });
    function renderProfile() {
      const u = NL.currentUser();
      NL.mount(profile, NL.avatar(u ? u.name : '?'), NL.h('span', { class: 'who' }, NL.h('strong', null, u ? u.name : 'Guest'), NL.h('small', null, u ? u.title + ' · ' + u.department : 'Not signed in: open Staff')));
    }

    NL.mount(header, menuBtn, crumbs, search, NL.h('div', { class: 'top-actions' }, themeBtn, NL.h('div', { class: 'menu-wrap' }, bell, bellMenu), profile));
    header.className = 'topbar';
    const shell = NL.h('div', { class: 'app-shell' }, sidebar, NL.h('div', { class: 'app-main' }));
    document.body.classList.add('app');
    document.body.insertBefore(shell, header);
    document.body.append(scrim);
    shell.lastChild.append(header, main, footer);
    renderNotifs(); renderProfile();
    NL.store.onChange(() => { renderNotifs(); renderProfile(); });
    document.addEventListener('click', (e) => { if (!search.contains(e.target)) results.hidden = true; if (!bell.contains(e.target) && !bellMenu.contains(e.target)) { bellMenu.hidden = true; bell.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setNav(false); bellMenu.hidden = true; } });
  };

  document.addEventListener('DOMContentLoaded', renderShell);
})();
