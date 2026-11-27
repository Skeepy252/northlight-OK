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
})();
