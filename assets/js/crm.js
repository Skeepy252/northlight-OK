/* Mini-CRM on the shared store. All text rendered through textContent. */
(function () {
  'use strict';
  const { h, $, mount, store, badge } = NL;
  const dlg = $('#crm-dialog');
  const STAGES = ['Lead', 'Qualified', 'Quote', 'Won', 'Lost'];
  const LEAD_STATUS = ['New', 'Contacted', 'Qualified', 'Disqualified', 'Converted'];
  const CASE_STATUS = ['Open', 'In Progress', 'Closed'];
  const today = () => new Date().toISOString().slice(0, 10);
  const accName = (id) => (store.find('accounts', id) || {}).name || '—';
  const caseOverdue = (c) => c.status !== 'Closed' && c.dueDate < today();
  let tab = 'leads';

  /* ---------- dashboard + chart ---------- */
  function stats() {
    const opps = store.list('opportunities');
    const stat = (n, l, id) => h('div', { class: 'card stat', id }, h('span', { class: 'num' }, n), h('span', { class: 'label' }, l));
    mount($('#crm-stats'), stat(store.list('leads').length, 'Total leads', 'st-leads'), stat(store.list('accounts').filter((a) => a.status === 'Active').length, 'Active accounts', 'st-accounts'),
      stat(opps.filter((o) => !['Won', 'Lost'].includes(o.stage)).length, 'Open opportunities', 'st-open'), stat(opps.filter((o) => o.stage === 'Won').length, 'Won opportunities', 'st-won'),
      stat(store.list('cases').filter((c) => c.status !== 'Closed').length, 'Open support cases', 'st-cases'));
  }
  function chart() {
    const opps = store.list('opportunities');
    const data = STAGES.map((s) => ({ s, n: opps.filter((o) => o.stage === s).length, v: opps.filter((o) => o.stage === s).reduce((a, o) => a + Number(o.value || 0), 0) }));
    const max = Math.max(1, ...data.map((d) => d.n)), W = 560, base = 190, top = 150, bw = 64, gap = (W - STAGES.length * bw) / (STAGES.length + 1);
    const svg = NL.svg('svg', { viewBox: '0 0 ' + W + ' 250', role: 'img', id: 'pipeline-chart', 'aria-label': 'Opportunities by stage: ' + data.map((d) => d.s + ' ' + d.n).join(', ') },
      NL.svg('line', { x1: 0, x2: W, y1: base, y2: base, class: 'chart-axis' }));
    data.forEach((d, i) => {
      const x = gap + i * (bw + gap), hgt = (d.n / max) * top;
      svg.append(NL.svg('rect', { x, y: base - hgt, width: bw, height: hgt, rx: 6, class: 'chart-bar ' + d.s.toLowerCase(), 'data-stage': d.s, 'data-count': d.n }, NL.svg('title', null, d.s + ': ' + d.n + ' (' + NL.money(d.v) + ')')),
        NL.svg('text', { x: x + bw / 2, y: base - hgt - 8, 'text-anchor': 'middle', class: 'chart-value' }, String(d.n)),
        NL.svg('text', { x: x + bw / 2, y: base + 20, 'text-anchor': 'middle', class: 'chart-text' }, d.s),
        NL.svg('text', { x: x + bw / 2, y: base + 38, 'text-anchor': 'middle', class: 'chart-text' }, NL.money(d.v)));
    });
    mount($('#crm-chart'), svg);
  }

  /* ---------- generic form dialog ---------- */
  function formDialog(title, fields, initial, onSave) {
    const f = h('form', { novalidate: true }, h('h2', { id: 'dlg-title' }, title),
      fields.map((fd) => NL.field('f-' + fd.id, fd.label, fd.options
        ? h('select', { id: 'f-' + fd.id }, fd.options.map((o) => h('option', { value: o.value == null ? o : o.value, selected: String(o.value == null ? o : o.value) === String(initial[fd.id]) }, o.label || o))) :
        fd.area ? h('textarea', { id: 'f-' + fd.id }, initial[fd.id] || '') : h('input', { id: 'f-' + fd.id, type: fd.type || 'text', value: initial[fd.id] == null ? '' : initial[fd.id] }))),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Save'), h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const vals = {}; let ok = true;
      fields.forEach((fd) => {
        const el = $('#f-' + fd.id); const v = el.value.trim(); let msg = '';
        if (fd.required && !v) msg = 'This field is required.';
        else if (fd.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = 'Enter a valid email address.';
        else if (fd.type === 'number' && v && !(Number(v) >= 0)) msg = 'Enter a positive number.';
        NL.setError(el, msg); if (msg) ok = false; vals[fd.id] = v;
      });
      if (!ok) return;
      dlg.close(); onSave(vals); // close first: change events are ignored while the dialog is open
    });
    mount(dlg, f); dlg.showModal();
  }

  const leadFields = [{ id: 'name', label: 'Name', required: true }, { id: 'company', label: 'Company', required: true }, { id: 'email', label: 'Email', type: 'email', required: true },
    { id: 'source', label: 'Source', options: ['Website', 'Referral', 'Event', 'Social', 'Other'] }, { id: 'status', label: 'Status', options: LEAD_STATUS }, { id: 'notes', label: 'Notes', area: true }];
  const editLead = (l) => formDialog(l ? 'Edit lead ' + l.id : 'New lead', leadFields, l || { source: 'Other', status: 'New' }, (v) => {
    if (l) { store.update('leads', l.id, v); NL.toast('Lead updated.'); } else { store.create('leads', v); NL.toast('Lead created.'); }
  });
  const editCase = (c) => formDialog(c ? 'Edit case ' + c.id : 'New support case', [
    { id: 'accountId', label: 'Customer', options: store.list('accounts').map((a) => ({ value: a.id, label: a.name })) }, { id: 'description', label: 'Description', area: true, required: true },
    { id: 'priority', label: 'Priority', options: ['High', 'Medium', 'Low'] }, { id: 'status', label: 'Status', options: CASE_STATUS }, { id: 'dueDate', label: 'Due date', type: 'date', required: true }],
  c || { priority: 'Medium', status: 'Open', dueDate: today() }, (v) => {
    v.customer = accName(v.accountId);
    if (c) store.update('cases', c.id, v); else store.create('cases', v);
    NL.toast('Case saved.');
  });

  /* ---------- lead conversion (idempotent: never duplicates account/contact/opportunity) ---------- */
  function convert(id) {
    const lead = store.find('leads', id); if (!lead || lead.status === 'Converted') return;
    const acc = store.list('accounts').find((a) => a.name.toLowerCase() === lead.company.toLowerCase()) ||
      store.create('accounts', { name: lead.company, industry: 'Not set', contactEmail: lead.email, notes: 'Created from lead ' + lead.id, status: 'Active' });
    const con = store.list('contacts').find((c) => c.email.toLowerCase() === lead.email.toLowerCase()) ||
      store.create('contacts', { name: lead.name, email: lead.email, accountId: acc.id, role: 'Primary contact' });
    const opp = store.list('opportunities').find((o) => o.leadId === lead.id) ||
      store.create('opportunities', { name: lead.company + ': ' + (lead.service || 'new project'), accountId: acc.id, value: 5000, stage: 'Qualified', closeDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), leadId: lead.id });
    store.update('leads', id, { status: 'Converted', accountId: acc.id, contactId: con.id, opportunityId: opp.id });
    NL.toast('Lead converted to account, contact and opportunity.');
  }

  /* ---------- tabs ---------- */
  const TABS = {
    leads: { label: 'Leads', filter: LEAD_STATUS, field: 'status', btn: 'New lead',
      cols: () => [{ label: 'ID', render: (l) => h('strong', null, l.id) }, { label: 'Name', render: (l) => l.name }, { label: 'Company', render: (l) => l.company }, { label: 'Email', render: (l) => l.email },
        { label: 'Source', render: (l) => l.source }, { label: 'Status', render: (l) => badge(l.status, l.status === 'Converted' ? 'ok' : l.status === 'Disqualified' ? 'muted' : 'info') }, { label: 'Created', render: (l) => NL.fmtDay(l.createdAt) }, { label: 'Notes', render: (l) => l.notes || '' },
        { label: 'Actions', render: (l) => h('div', { class: 'actions' }, h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Edit lead ' + l.id, onclick: () => editLead(l) }, 'Edit'),
          h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Convert lead ' + l.id, disabled: l.status === 'Converted', onclick: () => convert(l.id) }, 'Convert')) }] },
    accounts: { label: 'Accounts', cols: () => [{ label: 'Company', render: (a) => a.name }, { label: 'Industry', render: (a) => a.industry }, { label: 'Contact', render: (a) => a.contactEmail }, { label: 'Status', render: (a) => badge(a.status, 'ok') }, { label: 'Notes', render: (a) => a.notes }] },
    contacts: { label: 'Contacts', cols: () => [{ label: 'Name', render: (c) => c.name }, { label: 'Email', render: (c) => c.email }, { label: 'Account', render: (c) => accName(c.accountId) }, { label: 'Role', render: (c) => c.role }] },
    opportunities: { label: 'Opportunities', filter: STAGES, field: 'stage',
      cols: () => [{ label: 'Opportunity', render: (o) => o.name }, { label: 'Account', render: (o) => accName(o.accountId) }, { label: 'Value', render: (o) => NL.money(o.value) }, { label: 'Expected close', render: (o) => NL.fmtDay(o.closeDate) },
        { label: 'Stage', render: (o) => h('select', { 'aria-label': 'Stage for ' + o.name, onchange: (e) => { store.update('opportunities', o.id, { stage: e.target.value }); } }, STAGES.map((s) => h('option', { selected: s === o.stage }, s))) }] },
    cases: { label: 'Support cases', filter: CASE_STATUS, field: 'status', btn: 'New case',
      cols: () => [{ label: 'Case', render: (c) => h('strong', null, c.id) }, { label: 'Customer', render: (c) => c.customer }, { label: 'Description', render: (c) => c.description },
        { label: 'Priority', render: (c) => badge(c.priority, c.priority === 'High' ? 'p1' : c.priority === 'Medium' ? 'p2' : 'p3') }, { label: 'Status', render: (c) => badge(c.status, c.status === 'Closed' ? 'ok' : 'info') },
        { label: 'Due', render: (c) => h('span', null, c.dueDate, ' ', caseOverdue(c) ? badge('OVERDUE', 'danger') : null) },
        { label: 'Actions', render: (c) => h('div', { class: 'actions' }, h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Edit case ' + c.id, onclick: () => editCase(c) }, 'Edit'),
          c.status !== 'Closed' ? h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Close case ' + c.id, onclick: () => store.update('cases', c.id, { status: 'Closed' }) }, 'Close') : null) }] }
  };
  const coll = { leads: 'leads', accounts: 'accounts', contacts: 'contacts', opportunities: 'opportunities', cases: 'cases' };

  function tabs() {
    mount($('#crm-tabs'), Object.entries(TABS).map(([k, t]) => h('button', { class: 'tab', type: 'button', role: 'tab', id: 'tab-' + k, 'aria-selected': String(k === tab), onclick: () => { tab = k; $('#c-search').value = ''; $('#c-filter').value = ''; render(); } }, t.label + ' (' + store.list(coll[k]).length + ')')));
    const t = TABS[tab];
    $('#c-new').hidden = !t.btn; $('#c-new').textContent = t.btn || '';
    $('#c-filter-wrap').hidden = !t.filter;
    if (t.filter) { const cur = $('#c-filter').value; mount($('#c-filter'), h('option', { value: '' }, 'All'), t.filter.map((f) => h('option', null, f))); $('#c-filter').value = t.filter.includes(cur) ? cur : ''; }
  }
  function list() {
    const t = TABS[tab], q = $('#c-search').value.trim().toLowerCase(), f = $('#c-filter').value;
    let rows = store.list(coll[tab]).slice().reverse();
    if (t.filter && f) rows = rows.filter((r) => r[t.field] === f);
    if (q) rows = rows.filter((r) => Object.values(r).filter((v) => typeof v === 'string' || typeof v === 'number').join(' ').toLowerCase().includes(q));
    mount($('#crm-list'), NL.table(t.cols(), rows, { caption: t.label, emptyTitle: 'No ' + t.label.toLowerCase() + ' found', emptyText: 'Nothing matches your search or filter yet.', rowAttrs: (r) => ({ class: tab === 'cases' && caseOverdue(r) ? 'overdue' : null }) }));
  }
  function render() { stats(); chart(); tabs(); list(); }

  $('#c-search').addEventListener('input', list); $('#c-filter').addEventListener('change', list);
  $('#c-new').addEventListener('click', () => (tab === 'leads' ? editLead() : editCase()));
  store.onChange(() => { if (!dlg.open) render(); });
  render();
})();
