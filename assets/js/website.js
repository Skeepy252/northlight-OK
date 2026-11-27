/* Public website: enquiry form -> automation engine -> CRM lead + help desk ticket (+ outbox alert when urgent). */
(function () {
  'use strict';
  const { h, $, mount } = NL;
  const form = $('#enquiry-form');
  const sid = () => 'sub-' + crypto.randomUUID();
  $('#c-sid').value = sid();

  function validate() {
    const rules = [['c-name', (v) => (v ? '' : 'Please enter your full name.')],
      ['c-email', (v) => (!v ? 'Please enter your business email.' : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Please enter a valid email address, for example name@company.example.')],
      ['c-company', (v) => (v ? '' : 'Please enter your company.')], ['c-service', (v) => (v ? '' : 'Please choose a service.')],
      ['c-desc', (v) => (v.length >= 10 ? '' : 'Please describe your project (at least 10 characters).')]];
    let ok = true;
    for (const [id, fn] of rules) { const el = $('#' + id); const msg = fn(el.value.trim()); NL.setError(el, msg); if (msg) ok = false; }
    if (!ok) { const first = form.querySelector('[aria-invalid="true"]'); if (first) first.focus(); }
    return ok;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const btn = $('#enquiry-submit'); btn.disabled = true; btn.textContent = 'Sending…';
    const enq = { submissionId: $('#c-sid').value, name: $('#c-name').value.trim(), email: $('#c-email').value.trim(), company: $('#c-company').value.trim(),
      service: $('#c-service').value, urgency: $('#c-urgency').value, description: $('#c-desc').value.trim() };
    const r = await NL.automation.processEnquiry(enq);
    btn.disabled = false; btn.textContent = 'Send enquiry';
    const box = $('#enquiry-feedback');
    if (!r.ok) { mount(box, NL.alert('error', r.error)); return; } // form content is kept so nothing is lost
    mount(box, h('div', { class: 'alert alert-success', id: 'enquiry-success', role: 'status' },
      h('strong', null, r.duplicate ? 'Already received. ' : 'Thank you, ' + enq.name + '. '),
      'Your enquiry was recorded as CRM lead ', h('code', null, r.lead && r.lead.id), ' and help desk ticket ', h('code', null, r.ticket && r.ticket.id),
      ' (priority ', h('strong', null, r.ticket ? r.ticket.priority : '?'), ').',
      r.alerts && r.alerts.length ? ' An urgent alert was placed in the simulated outbox. ' : ' ', 'No real email was sent. ', h('a', { href: 'automation.html' }, 'View the automation log')));
    form.reset(); $('#c-sid').value = sid();
    NL.setError($('#c-name'), ''); box.scrollIntoView({ block: 'nearest' });
  });
})();
