/* Dashboard: every number comes from the shared store - nothing is hardcoded. */
(function () {
  'use strict';
  const { h, $, mount, store, badge } = NL;
  let auto = { loading: true };

  const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const pct10 = (n, max) => 'w' + (max ? Math.round((n / max) * 10) * 10 : 0);

  function render() {
    const u = NL.currentUser(), T = store.list('tickets'), open = T.filter((t) => t.status !== 'Resolved');
    const leads = store.list('leads'), opps = store.list('opportunities'), staff = store.list('staff');
    $('#welcome').textContent = (u ? 'Welcome back, ' + u.name.split(' ')[0] + '. ' : 'Welcome to Northlight Studio. ') +
      'Here is the state of the company: ' + open.length + ' open tickets, ' + staff.filter((s) => s.status === 'active').length + ' active employees and ' + opps.filter((o) => !['Won', 'Lost'].includes(o.stage)).length + ' open opportunities.';

    const stat = (id, n, l, href) => h('a', { class: 'card stat', id, href, 'aria-label': l + ': ' + n }, h('span', { class: 'num' }, n), h('span', { class: 'label' }, l));
    mount($('#dash-stats'),
      stat('d-open', open.length, 'Open tickets', 'helpdesk.html'), stat('d-critical', open.filter((t) => t.priority === 'P1').length, 'Critical (P1) tickets', 'helpdesk.html?priority=P1'),
      stat('d-staff', staff.filter((s) => s.status === 'active').length, 'Active employees', 'staff.html'), stat('d-leads', leads.filter((l) => !['Converted', 'Disqualified'].includes(l.status)).length, 'Active CRM leads', 'crm.html'),
      stat('d-opps', opps.filter((o) => !['Won', 'Lost'].includes(o.stage)).length, 'Open opportunities', 'crm.html?tab=opportunities'),
      stat('d-auto', auto.loading ? '…' : auto.error ? 'Error' : 'Active', 'Automation status', 'automation.html'));

    mount($('#dash-pipeline'), NL.pipelineStrip());

    const feed = [].concat(
      T.map((t) => ({ at: t.createdAt, ico: 'TCK', text: t.id + ' · ' + t.description.slice(0, 80), href: 'helpdesk.html?q=' + t.id })),
      leads.map((l) => ({ at: l.createdAt, ico: 'LD', text: 'Lead ' + l.name + ' (' + l.company + ') via ' + l.source, href: 'crm.html' })),
      store.list('logs').map((l) => ({ at: l.at, ico: l.level === 'error' ? 'ERR' : 'AUT', text: l.message, href: 'automation.html' })),
      store.list('outbox').map((m) => ({ at: m.createdAt, ico: 'MSG', text: 'Outbox (simulated): ' + m.subject, href: 'automation.html' }))
    ).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
    mount($('#dash-feed'), feed.length ? h('ul', { class: 'feed' }, feed.map((f) => h('li', null, h('span', { class: 'ico' }, f.ico), h('a', { class: 'what', href: f.href }, f.text), h('span', { class: 'when' }, ago(f.at)))))
      : NL.empty('No activity yet', 'Submit an enquiry on the public website to see events here.'));

    mount($('#dash-quick'),
      h('a', { class: 'btn sm', href: 'helpdesk.html?new=1' }, 'New ticket'), h('a', { class: 'btn sm', href: 'crm.html?new=lead' }, 'New lead'),
      h('button', { class: 'btn ghost sm', type: 'button', id: 'qa-sample', onclick: async () => {
        const r = await NL.automation.processEnquiry({ submissionId: 'sub-' + crypto.randomUUID(), name: 'Dashboard Sample', email: 'sample@dashboard.example', company: 'Sample Co', service: 'Creative Campaigns', urgency: 'normal', description: 'Sample enquiry sent from the dashboard quick action.' });
        NL.toast(r.ok ? 'Sample enquiry processed: ' + r.lead.id + ' / ' + r.ticket.id : r.error, r.ok ? 'ok' : 'warn');
      } }, 'Send sample enquiry'),
      h('a', { class: 'btn ghost sm', href: 'troubleshoot.html' }, 'Troubleshoot network'), h('button', { class: 'btn ghost sm', type: 'button', onclick: NL.exportAll }, 'Export all data'));

    const byP = ['P1', 'P2', 'P3'].map((p) => [p, open.filter((t) => t.priority === p).length]), max = Math.max(1, ...byP.map((x) => x[1]));
    mount($('#dash-prio'), open.length ? h('div', { class: 'mini-bars' }, byP.map(([p, n]) => h('div', { class: 'mini-bar' }, NL.priorityBadge(p), h('span', { class: 'track' }, h('span', { class: 'fill ' + pct10(n, max) })), h('strong', null, String(n)))))
      : NL.empty('No open tickets', 'Everything is resolved.'));

    mount($('#dash-auto'), auto.loading ? h('p', null, 'Checking rules…') : auto.error ? NL.alert('error', 'Automation is NOT active: ' + auto.error)
      : h('p', null, h('span', { class: 'status-dot' }), h('strong', null, 'Active'), ' · ' + auto.rules.length + ' rules loaded · ' + store.list('outbox').length + ' simulated outbox messages. ', h('a', { href: 'automation.html' }, 'Open automation')));
  }

  store.onChange(render);
  render();
  NL.automation.loadRules().then((d) => { auto = { rules: d.rules }; }, (e) => { auto = { error: e.message }; }).then(render);
})();
