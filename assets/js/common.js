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
    if (header) {
      const toggle = NL.h('button', { class: 'nav-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'main-nav', onclick: () => {
        const open = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); } }, 'Menu');
      const nav = NL.h('nav', { id: 'main-nav', class: 'nav', 'aria-label': 'Main' }, NAV.map(([href, label, key]) =>
        NL.h('a', { href, 'aria-current': key === page ? 'page' : null }, label)));
      NL.mount(header, NL.h('div', { class: 'container header-inner' },
        NL.h('a', { class: 'brand', href: 'index.html' }, logo(), NL.h('span', null, CFG.appName)), toggle, nav));
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
  document.addEventListener('DOMContentLoaded', renderShell);
})();
