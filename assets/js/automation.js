/* Configuration-driven automation engine (rules come from rules.json). Simulation only: no email is ever sent. */
(function () {
  'use strict';
  const CFG = NL_CONFIG;
  const { store } = NL;
  const REQUIRED = ['name', 'email', 'company', 'service', 'description'];
  const inflight = new Set();

  const fill = (tpl, c) => String(tpl || '').replace(/\{\{(\w+)\}\}/g, (m, k) => {
    const v = { name: c.enq.name, company: c.enq.company, email: c.enq.email, service: c.enq.service, description: c.enq.description,
      leadId: c.lead && c.lead.id, ticketId: c.ticket && c.ticket.id, priority: c.ticket && c.ticket.priority }[k];
    return v == null ? '' : v;
  });

  const ACTIONS = {
    createLead(rule, c) {
      c.lead = store.create('leads', { name: c.enq.name, company: c.enq.company, email: c.enq.email, source: 'Website', status: 'New', service: c.enq.service,
        urgency: c.enq.urgency, notes: c.enq.service + ': ' + c.enq.description, submissionId: c.enq.submissionId });
      return 'Lead ' + c.lead.id + ' created';
    },
    createTicket(rule, c) {
      if (!c.lead) throw new Error('createTicket needs a lead (rule order)');
      c.ticket = NL.tickets.create({ requester: c.enq.name + ' (' + c.enq.company + ')', department: 'External', priority: rule.action.priority || 'P3',
        description: 'Website enquiry about ' + c.enq.service + ': ' + c.enq.description, category: 'enquiry', source: 'website', leadId: c.lead.id, submissionId: c.enq.submissionId });
      return 'Ticket ' + c.ticket.id + ' created with priority ' + c.ticket.priority;
    },
    setTicketPriority(rule, c) {
      if (!c.ticket) throw new Error('no ticket to prioritise');
      const p = rule.action.priority, old = c.ticket.priority;
      c.ticket = store.update('tickets', c.ticket.id, (t) => { t.priority = p; t.dueAt = NL.sla.dueAt(p, t.createdAt); t.history.push({ at: new Date().toISOString(), text: 'Automation ' + rule.id + ': priority ' + old + ' → ' + p }); });
      return 'Ticket ' + c.ticket.id + ' priority set to ' + p;
    },
    addOutboxAlert(rule, c) {
      const m = store.create('outbox', { to: rule.action.to || CFG.urgentAlertTo, subject: fill(rule.action.subject, c), body: fill(rule.action.body, c), ruleId: rule.id,
        status: 'Simulated (not sent)', leadId: c.lead && c.lead.id, ticketId: c.ticket && c.ticket.id });
      c.alerts.push(m); return 'Alert ' + m.id + ' queued in outbox (simulated)';
    },
    logActivity(rule, c) { return fill(rule.action.message, c) || 'Activity logged'; }
  };

  /* ---------- rules loading / validation ---------- */
  function validate(d) {
    if (!d || !Array.isArray(d.rules) || !d.rules.length) throw new Error('rules.json has no "rules" array.');
    const ids = new Set();
    d.rules.forEach((r, i) => {
      if (!r || typeof r.id !== 'string' || !r.id) throw new Error('Rule #' + (i + 1) + ' is missing an id.');
      if (ids.has(r.id)) throw new Error('Duplicate rule id ' + r.id + '.');
      ids.add(r.id);
      if (typeof r.event !== 'string') throw new Error('Rule ' + r.id + ' is missing "event".');
      if (!r.action || !ACTIONS[r.action.type]) throw new Error('Rule ' + r.id + ' has an unknown action type.');
    });
    return d;
  }
  async function loadRules() {
    let res;
    try { res = await fetch(CFG.rulesUrl, { cache: 'no-store' }); } catch (e) { throw new Error('rules.json could not be loaded (network error).'); }
    if (!res.ok) throw new Error('rules.json could not be loaded (HTTP ' + res.status + ').');
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('rules.json contains invalid JSON.'); }
    return validate(data);
  }

  function matches(c, e) {
    if (c.all) return c.all.every((x) => matches(x, e));
    if (c.any) return c.any.some((x) => matches(x, e));
    if (c.not) return !matches(c.not, e);
    const v = String(e[c.field] == null ? '' : e[c.field]).toLowerCase();
    if (c.op === 'equals') return v === String(c.value).toLowerCase();
    if (c.op === 'containsAny') return (c.value || []).some((w) => v.includes(String(w).toLowerCase()));
    throw new Error('unknown operator ' + c.op);
  }
  const isEnabled = (r) => r.enabled !== false && (r.locked || !store.setting('disabledRules', []).includes(r.id));

  /** Process one website enquiry. Never throws; returns {ok, error?, duplicate?, lead, ticket, alerts, executed}. */
  async function processEnquiry(enq) {
    const cid = enq.submissionId || null;
    const fail = (error, extra) => { store.log({ level: 'error', ruleId: 'engine', message: error, correlationId: cid }); return Object.assign({ ok: false, error }, extra); };
    const missing = REQUIRED.filter((k) => !String(enq[k] || '').trim());
    if (missing.length) return fail('Enquiry rejected: missing ' + missing.join(', ') + '.');
    if (cid && inflight.has(cid)) return { ok: true, duplicate: true };
    const prior = cid && store.list('leads').find((l) => l.submissionId === cid);
    if (prior) {
      store.log({ level: 'info', ruleId: 'engine', message: 'Duplicate submission ignored (' + cid + ').', correlationId: cid });
      return { ok: true, duplicate: true, lead: prior, ticket: store.list('tickets').find((t) => t.submissionId === cid) };
    }
    if (cid) inflight.add(cid);
    try {
      let rules;
      try { rules = await loadRules(); } catch (e) { return fail('Automation not run: ' + e.message + ' Your enquiry was NOT processed; please try again later.'); }
      const c = { enq, lead: null, ticket: null, alerts: [], executed: [] };
      for (const rule of rules.rules) {
        if (rule.event !== 'enquiry.submitted' || !isEnabled(rule)) continue;
        try {
          if (rule.condition && !matches(rule.condition, enq)) continue;
          const detail = ACTIONS[rule.action.type](rule, c);
          store.log({ level: 'success', ruleId: rule.id, message: rule.name + ': ' + detail, correlationId: cid });
          c.executed.push(rule.id);
        } catch (e) { return fail('Rule ' + rule.id + ' failed: ' + e.message, c); }
      }
      return Object.assign({ ok: true }, c);
    } finally { if (cid) inflight.delete(cid); }
  }

  NL.automation = { processEnquiry, loadRules, validate };

  /* ---------- dashboard (automation.html only) ---------- */
  if (document.body.dataset.page !== 'automation') return;
  const { h, $, mount, badge } = NL;
  let rulesState = { loading: true };
  const SAMPLES = { standard: { name: 'Sample Visitor', email: 'visitor@sample.example', company: 'Sample Co', service: 'Digital Design and Websites', urgency: 'normal', description: 'Please send a quote for a small marketing website.' },
    urgent: { name: 'Urgent Visitor', email: 'rush@sample.example', company: 'Rush Co', service: 'Creative Campaigns', urgency: 'urgent', description: 'Our campaign launches tomorrow and we need help immediately.' } };

  function renderStatus() {
    const s = rulesState;
    const logs = store.list('logs');
    mount($('#auto-status'), h('div', { class: 'card' }, h('h2', null, 'Automation status'),
      s.loading ? h('p', null, 'Loading rules…') : s.error
        ? [NL.alert('error', 'Automation is NOT active: ' + s.error), h('p', { class: 'hint' }, 'Enquiries are not processed while the configuration is unavailable. Fix rules.json and reload.')]
        : h('p', null, h('span', { class: 'status-dot', id: 'status-dot' }), h('strong', { id: 'status-text' }, 'Active'), ' · ' + s.rules.length + ' rules loaded from ', h('code', null, 'rules.json'), ' · ' + s.rules.filter(isEnabled).length + ' enabled'),
      h('p', { class: 'hint' }, logs.length + ' log entries · ' + store.list('outbox').length + ' outbox messages. Simulation only: no email is ever sent.')));
    mount($('#auto-health'), h('div', { class: 'card' }, h('h2', null, 'Application health'), NL.health
      ? h('dl', { class: 'kv' }, ['application', 'version', 'buildDate', 'environment'].flatMap((k) => [h('dt', null, k), h('dd', null, NL.health[k])]))
      : h('p', { class: 'muted' }, 'Health information unavailable.')));
  }
  function describe(c) {
    if (!c) return 'Always runs';
    if (c.all || c.any) return (c.all ? 'ALL of: ' : 'ANY of: ') + (c.all || c.any).map(describe).join('; ');
    if (c.not) return 'NOT (' + describe(c.not) + ')';
    return c.field + ' ' + c.op + ' ' + JSON.stringify(c.value);
  }
  function renderRules() {
    if (!rulesState.rules) return mount($('#auto-rules'), NL.empty('No rules available', 'Rules could not be loaded.'));
    mount($('#auto-rules'), NL.table([
      { label: 'Rule ID', render: (r) => h('code', null, r.id) }, { label: 'Name', render: (r) => r.name }, { label: 'Condition', render: (r) => describe(r.condition) }, { label: 'Action', render: (r) => r.action.type },
      { label: 'State', render: (r) => (isEnabled(r) ? badge('Enabled', 'ok') : badge('Disabled', 'muted')) },
      { label: 'Toggle', render: (r) => (r.locked ? h('span', { class: 'hint' }, 'Core rule') : h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': (isEnabled(r) ? 'Disable ' : 'Enable ') + r.id, onclick: () => {
        const off = store.setting('disabledRules', []); store.setSetting('disabledRules', isEnabled(r) ? off.concat(r.id) : off.filter((x) => x !== r.id));
      } }, isEnabled(r) ? 'Disable' : 'Enable')) }], rulesState.rules, { caption: 'Configured automation rules' }));
  }
  function renderOutbox() {
    const o = store.list('outbox').slice().reverse();
    mount($('#auto-outbox'), NL.table([{ label: 'Created', render: (m) => NL.fmtDate(m.createdAt) }, { label: 'To', render: (m) => m.to }, { label: 'Subject', render: (m) => m.subject },
      { label: 'Message', render: (m) => m.body }, { label: 'Rule', render: (m) => m.ruleId }, { label: 'Status', render: (m) => badge(m.status, 'warn') }], o, { caption: 'Simulated outbox', emptyTitle: 'Outbox is empty', emptyText: 'Urgent enquiries queue a simulated alert here. Nothing is ever sent.' }));
  }
  function renderLog() {
    const l = store.list('logs').slice().reverse().slice(0, 50);
    mount($('#auto-log'), NL.table([{ label: 'Time', render: (e) => NL.fmtDate(e.at) }, { label: 'Result', render: (e) => badge(e.level === 'success' ? 'Success' : e.level === 'error' ? 'Error' : 'Info', e.level === 'success' ? 'ok' : e.level === 'error' ? 'danger' : 'info') },
      { label: 'Rule', render: (e) => h('code', null, e.ruleId) }, { label: 'Event details', render: (e) => e.message }, { label: 'Submission', render: (e) => e.correlationId || '—' }], l, { caption: 'Recent automation activity', emptyTitle: 'No activity yet', emptyText: 'Submit an enquiry on the home page.' }));
  }
  const renderAll = () => { renderStatus(); renderRules(); renderOutbox(); renderLog(); };

  async function runSample(kind) {
    const r = await NL.automation.processEnquiry(Object.assign({ submissionId: 'sub-' + crypto.randomUUID() }, SAMPLES[kind]));
    mount($('#auto-result'), r.ok ? NL.alert('success', 'Processed sample enquiry: lead ' + r.lead.id + ', ticket ' + r.ticket.id + ' (' + r.ticket.priority + ')' + (r.alerts.length ? ', alert queued in simulated outbox.' : '.')) : NL.alert('error', r.error));
  }
  $('#run-standard').addEventListener('click', () => runSample('standard'));
  $('#run-urgent').addEventListener('click', () => runSample('urgent'));
  store.onChange(renderAll);
  window.addEventListener('nl:health', renderStatus);
  renderAll();
  loadRules().then((d) => { rulesState = { rules: d.rules }; }, (e) => { rulesState = { error: e.message }; }).then(renderAll);
})();
