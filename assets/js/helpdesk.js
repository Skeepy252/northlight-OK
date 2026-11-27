/* Help desk UI. All user text is rendered with textContent (via NL.h) - never innerHTML. */
(function () {
  'use strict';
  const { h, $, mount, store, tickets, badge } = NL;
  const dlg = $('#ticket-dialog');
  const IMPACT = { multiple: 'Multiple employees / security / critical interruption', blocked: 'One employee blocked', minor: 'Minor inconvenience' };
  const URGENCY = { critical: 'Critical (now)', high: 'High (deadline soon)', normal: 'Normal' };
  const STATUSES = ['New', 'In Progress', 'Resolved'];
  const GUIDANCE = ['Isolate the affected device (disconnect it from the network).', 'Do not delete the suspicious email.',
    'Warn potentially affected employees.', 'Escalate to the appropriate security contact.', 'Preserve relevant evidence (email headers, attachment name, timestamps).'];
  const statusKind = { New: 'info', 'In Progress': 'warn', Resolved: 'ok' };

  function opts(map, sel) { return Object.entries(map).map(([v, l]) => h('option', { value: v, selected: v === sel }, l)); }

  function filtered() {
    const q = $('#f-search').value.trim().toLowerCase(), st = $('#f-status').value, pr = $('#f-priority').value;
    return tickets.sort(store.list('tickets')).filter((t) => (!st || t.status === st) && (!pr || t.priority === pr) &&
      (!q || [t.id, t.requester, t.description, t.department].join(' ').toLowerCase().includes(q)));
  }

  function render() {
    const all = store.list('tickets');
    const open = all.filter((t) => t.status !== 'Resolved');
    const stat = (n, l) => h('div', { class: 'card stat' }, h('span', { class: 'num' }, n), h('span', { class: 'label' }, l));
    mount($('#ticket-stats'), stat(open.length, 'Open tickets'), stat(open.filter((t) => t.priority === 'P1').length, 'Open P1 critical'),
      stat(all.filter(tickets.isOverdue).length, 'Overdue'), stat(all.filter((t) => t.status === 'Resolved').length, 'Resolved'));
    mount($('#ticket-list'), NL.table([
      { label: 'ID', render: (t) => h('strong', null, t.id) },
      { label: 'Priority', render: (t) => NL.priorityBadge(t.priority) },
      { label: 'Issue', render: (t) => (t.description.length > 90 ? t.description.slice(0, 90) + '…' : t.description) },
      { label: 'Requester', render: (t) => t.requester + ' (' + t.department + ')' },
      { label: 'Status', render: (t) => badge(t.status, statusKind[t.status]) },
      { label: 'Response target', render: (t) => (t.status === 'Resolved' ? '—' : h('span', null, NL.fmtDate(t.dueAt), ' ',
        tickets.isOverdue(t) ? badge('OVERDUE ' + NL.relTime(t.dueAt).replace('overdue by ', ''), 'danger') : h('span', { class: 'hint' }, '(' + NL.relTime(t.dueAt) + ')'))) },
      { label: 'Action', render: (t) => h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Open ticket ' + t.id, onclick: () => openTicket(t.id) }, 'Open') }
    ], filtered(), { caption: 'Support tickets sorted by priority then age', emptyTitle: 'No tickets match', emptyText: 'Adjust the filters or create a new ticket.',
      rowAttrs: (t) => ({ class: tickets.isOverdue(t) ? 'overdue' : null, 'data-ticket': t.id }) }));
  }

  function newTicket() {
    const f = h('form', { novalidate: true },
      h('h2', { id: 'dlg-title' }, 'New ticket'),
      h('div', { class: 'form-grid' },
        NL.field('n-requester', 'Requester', h('input', { id: 'n-requester', autocomplete: 'off' })),
        NL.field('n-dept', 'Department', h('select', { id: 'n-dept' }, NL_CONFIG.ticketDepartments.map((d) => h('option', null, d)))),
        NL.field('n-impact', 'Impact', h('select', { id: 'n-impact' }, opts(IMPACT, 'minor'))),
        NL.field('n-urgency', 'Urgency', h('select', { id: 'n-urgency' }, opts(URGENCY, 'normal')))),
      NL.field('n-desc', 'Issue description', h('textarea', { id: 'n-desc' })),
      h('p', { class: 'hint', id: 'n-prio-hint' }),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Create ticket'), h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    const hint = () => { $('#n-prio-hint').textContent = 'Calculated priority: ' + tickets.PRIORITIES[tickets.computePriority($('#n-impact').value, $('#n-urgency').value)]; };
    f.addEventListener('change', hint);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = $('#n-requester'), d = $('#n-desc');
      NL.setError(r, r.value.trim() ? '' : 'Please enter the requester name.');
      NL.setError(d, d.value.trim().length >= 10 ? '' : 'Please describe the issue (at least 10 characters).');
      if (!r.value.trim() || d.value.trim().length < 10) return;
      const t = tickets.create({ requester: r.value.trim(), department: $('#n-dept').value, description: d.value.trim(), impact: $('#n-impact').value, urgency: $('#n-urgency').value, source: 'helpdesk' });
      dlg.close(); NL.toast('Ticket ' + t.id + ' created (' + t.priority + ').');
    });
    mount(dlg, f); hint(); dlg.showModal();
  }

  function openTicket(id) {
    const t = store.find('tickets', id); if (!t) return;
    const f = h('form', { novalidate: true },
      h('h2', { id: 'dlg-title' }, t.id + ' · ', NL.priorityBadge(t.priority)),
      t.category === 'security' ? h('div', { class: 'guidance', id: 'security-guidance' }, h('strong', null, 'Educational incident-response guidance (fictional scenario)'),
        h('ul', null, GUIDANCE.map((g) => h('li', null, g)))) : null,
      h('div', { class: 'form-grid' },
        NL.field('e-requester', 'Requester', h('input', { id: 'e-requester', value: t.requester })),
        NL.field('e-dept', 'Department', h('select', { id: 'e-dept' }, NL_CONFIG.ticketDepartments.map((d) => h('option', { selected: d === t.department }, d)))),
        NL.field('e-priority', 'Priority', h('select', { id: 'e-priority' }, opts(tickets.PRIORITIES, t.priority))),
        NL.field('e-status', 'Status', h('select', { id: 'e-status' }, STATUSES.map((s) => h('option', { selected: s === t.status }, s))))),
      NL.field('e-desc', 'Issue description', h('textarea', { id: 'e-desc' }, t.description)),
      NL.field('e-resolution', 'Resolution details', h('textarea', { id: 'e-resolution' }, t.resolution || '')),
      h('p', { class: 'hint' }, 'Created ' + NL.fmtDate(t.createdAt) + ' · response target ' + NL.fmtDate(t.dueAt) + ' · source: ' + t.source),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Save changes'), h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'Close')),
      h('h3', null, 'Replies'),
      h('ul', { class: 'timeline', id: 'reply-list' }, t.replies.length ? t.replies.map((r) => h('li', null, h('strong', null, r.author), ' · ' + NL.fmtDate(r.at), h('br'), r.text)) : h('li', null, 'No replies yet.')),
      NL.field('e-reply', 'Add reply', h('textarea', { id: 'e-reply' })),
      h('button', { class: 'btn ghost sm', type: 'button', id: 'add-reply', onclick: () => {
        const box = $('#e-reply'); const text = box.value.trim();
        NL.setError(box, text ? '' : 'Write a reply first.'); if (!text) return;
        store.update('tickets', id, (x) => { x.replies.push({ at: new Date().toISOString(), author: 'IT Support', text }); x.history.push({ at: new Date().toISOString(), text: 'Reply added' }); });
        openTicket(id);
      } }, 'Add reply'),
      h('h3', null, 'History'),
      h('ul', { class: 'timeline', id: 'history-list' }, t.history.slice().reverse().map((x) => h('li', null, NL.fmtDate(x.at) + ' — ' + x.text))));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const desc = $('#e-desc').value.trim(), req = $('#e-requester').value.trim();
      NL.setError($('#e-desc'), desc ? '' : 'Description cannot be empty.'); NL.setError($('#e-requester'), req ? '' : 'Requester cannot be empty.');
      if (!desc || !req) return;
      const status = $('#e-status').value, priority = $('#e-priority').value, dept = $('#e-dept').value, resolution = $('#e-resolution').value.trim();
      store.update('tickets', id, (x) => {
        const log = (m) => x.history.push({ at: new Date().toISOString(), text: m });
        if (x.status !== status) log('Status changed: ' + x.status + ' → ' + status);
        if (x.priority !== priority) { log('Priority changed: ' + x.priority + ' → ' + priority); x.dueAt = NL.sla.dueAt(priority, x.createdAt); }
        if (x.description !== desc || x.requester !== req || x.department !== dept || (x.resolution || '') !== resolution) log('Details edited');
        Object.assign(x, { status, priority, description: desc, requester: req, department: dept, resolution });
        if (status === 'Resolved' && !x.resolvedAt) x.resolvedAt = new Date().toISOString();
      });
      dlg.close(); NL.toast('Ticket ' + id + ' updated.');
    });
    mount(dlg, f); if (!dlg.open) dlg.showModal();
  }

  ['#f-search', '#f-status', '#f-priority'].forEach((s) => $(s).addEventListener('input', render));
  $('#new-ticket').addEventListener('click', newTicket);
  $('#export-tickets').addEventListener('click', () => NL.download('northlight-tickets-' + new Date().toISOString().slice(0, 10) + '.json', { exportedAt: new Date().toISOString(), tickets: store.list('tickets') }));
  store.onChange(render);
  render();
  setInterval(render, 60000); // keep overdue labels current
})();
