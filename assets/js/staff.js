/* Staff directory + identity demo. Educational only: client-side checks are NOT real access control. */
(function () {
  'use strict';
  const { h, $, mount, store, badge } = NL;
  const CFG = NL_CONFIG;
  const enc = new TextEncoder();

  /* ---------- crypto (Web Crypto API) ---------- */
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  async function hashPassword(pw, saltB64, iterations) {
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' }, key, 256));
  }
  async function makeCred(pw) {
    const salt = b64(rand(16)), iterations = CFG.pbkdf2Iterations;
    return { algo: 'PBKDF2-SHA256', iterations, salt, hash: await hashPassword(pw, salt, iterations) };
  }
  const safeEqual = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };

  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function base32Encode(bytes) {
    let bits = '', out = '';
    bytes.forEach((b) => { bits += b.toString(2).padStart(8, '0'); });
    for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
    return out;
  }
  function base32Decode(s) {
    let bits = '';
    for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v < 0) throw new Error('bad base32'); bits += v.toString(2).padStart(5, '0'); }
    const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
    return Uint8Array.from(out);
  }
  /** RFC 6238 TOTP (HMAC-SHA1). */
  async function totp(secretB32, timeMs, digits) {
    digits = digits || CFG.totp.digits;
    const counter = Math.floor(timeMs / 1000 / CFG.totp.stepSeconds);
    const msg = new ArrayBuffer(8); new DataView(msg).setUint32(4, counter); new DataView(msg).setUint32(0, Math.floor(counter / 2 ** 32));
    const key = await crypto.subtle.importKey('raw', base32Decode(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
    const o = mac[19] & 15;
    const n = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
    return String(n % 10 ** digits).padStart(digits, '0');
  }
  async function verifyTotp(secret, code, timeMs) {
    timeMs = timeMs || Date.now();
    for (let w = -CFG.totp.window; w <= CFG.totp.window; w++) if (safeEqual(await totp(secret, timeMs + w * CFG.totp.stepSeconds * 1000), String(code).trim())) return true;
    return false;
  }
  NL.crypto = { hashPassword, makeCred, base32Encode, base32Decode, totp, verifyTotp };

  /* ---------- seed credentials for the 6 PUBLIC demo accounts ---------- */
  async function ensureDemoCreds() {
    for (const u of store.list('staff').filter((x) => x.demo && !x.cred)) {
      const cred = await makeCred(CFG.demoPassword), secret = base32Encode(rand(20));
      store.update('staff', u.id, (x) => { if (!x.cred) { x.cred = cred; x.mfaSecret = secret; } });
    }
  }

  /* ---------- session + view state ---------- */
  const getSession = () => { try { return JSON.parse(sessionStorage.getItem(CFG.sessionKey)); } catch (e) { return null; } };
  const setSession = (id) => { try { if (id) sessionStorage.setItem(CFG.sessionKey, JSON.stringify({ id, at: Date.now() })); else sessionStorage.removeItem(CFG.sessionKey); } catch (e) { /* ignore */ } window.dispatchEvent(new CustomEvent('nl:change')); }; // lets the top bar profile refresh
  let ready = false, pending = null, loginError = '', timer = null, joinerResult = null;
  const root = $('#staff-root');
  const roleLabel = (r) => CFG.accessRoles[r] || r;
  const demoNote = 'Public demo credentials: never reuse them anywhere.';

  async function attempt(email, pw) {
    const u = store.list('staff').find((s) => s.email.toLowerCase() === email.trim().toLowerCase());
    if (!u || !u.cred) { await hashPassword(pw, b64(rand(16)), CFG.pbkdf2Iterations); return { ok: false }; } // equalise timing
    const ok = safeEqual(await hashPassword(pw, u.cred.salt, u.cred.iterations), u.cred.hash);
    if (!ok) return { ok: false };
    if (u.status !== 'active') return { ok: false, disabled: true };
    return { ok: true, user: u };
  }

  /* ---------- views ---------- */
  function loginView() {
    const form = h('form', { novalidate: true, id: 'login-form' },
      h('h2', null, 'Sign in'),
      loginError ? NL.alert('error', loginError) : null,
      NL.field('l-email', 'Email', h('input', { id: 'l-email', type: 'email', autocomplete: 'username' })),
      NL.field('l-pw', 'Password', h('input', { id: 'l-pw', type: 'password', autocomplete: 'current-password' })),
      h('button', { class: 'btn', type: 'submit', id: 'login-btn', disabled: !ready }, ready ? 'Continue' : 'Preparing demo accounts…'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const em = $('#l-email'), pw = $('#l-pw');
      NL.setError(em, em.value.trim() ? (/^\S+@\S+\.\S+$/.test(em.value.trim()) ? '' : 'Enter a valid email address.') : 'Enter your email.');
      NL.setError(pw, pw.value ? '' : 'Enter your password.');
      if (!em.value.trim() || !pw.value || em.getAttribute('aria-invalid') === 'true') return;
      $('#login-btn').disabled = true;
      const r = await attempt(em.value, pw.value);
      if (!r.ok) { loginError = r.disabled ? 'This account is disabled (leaver). Contact IT.' : 'Sign-in failed. Check your email and password.'; return render(); }
      loginError = '';
      if (r.user.mfaEnabled && r.user.mfaSecret) { pending = r.user.id; } else { setSession(r.user.id); }
      render();
    });
    const demoRows = store.list('staff').filter((s) => s.demo);
    return h('div', { class: 'stack' },
      h('div', { class: 'card login-card' }, form),
      h('div', { class: 'card' }, h('h2', null, 'Fictional demo accounts'),
        NL.alert('warn', 'PUBLIC DEMO-ONLY credentials. ' + demoNote),
        h('p', null, 'Shared password for all six accounts: ', h('code', { id: 'demo-password' }, CFG.demoPassword)),
        NL.table([{ label: 'Name', render: (s) => s.name }, { label: 'Email', render: (s) => h('code', null, s.email) }, { label: 'Role', render: (s) => s.title + ' (' + roleLabel(s.accessRole) + ')' }, { label: 'Status', render: (s) => badge(s.status, s.status === 'active' ? 'ok' : 'danger') }], demoRows, { caption: 'Demo accounts' })));
  }

  function mfaView() {
    const u = store.find('staff', pending);
    if (!u) { pending = null; return loginView(); }
    const uri = 'otpauth://totp/' + encodeURIComponent('Northlight Studio:' + u.email) + '?secret=' + u.mfaSecret + '&issuer=' + encodeURIComponent('Northlight Studio') + '&digits=6&period=30';
    const form = h('form', { novalidate: true, id: 'mfa-form' }, h('h2', null, 'Second step: authenticator code'),
      h('p', null, 'Signed in as ' + u.email + '. Enter the 6-digit code from your authenticator app.'),
      NL.field('m-code', '6-digit code', h('input', { id: 'm-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6 })),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit', id: 'mfa-btn' }, 'Verify'), h('button', { class: 'btn ghost', type: 'button', onclick: () => { pending = null; render(); } }, 'Cancel')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = $('#m-code');
      if (!/^\d{6}$/.test(c.value.trim())) return NL.setError(c, 'Enter the 6-digit code.');
      if (await verifyTotp(u.mfaSecret, c.value)) { setSession(u.id); pending = null; render(); } else NL.setError(c, 'Incorrect or expired code.');
    });
    const code = h('span', { class: 'otp', id: 'demo-code' }, '······'), left = h('span', { id: 'demo-left' });
    const tick = async () => { code.textContent = await totp(u.mfaSecret, Date.now()); left.textContent = CFG.totp.stepSeconds - (Math.floor(Date.now() / 1000) % CFG.totp.stepSeconds) + 's left'; };
    tick(); timer = setInterval(tick, 1000);
    return h('div', { class: 'stack' }, h('div', { class: 'card login-card' }, form,
      h('div', { class: 'demo-panel', id: 'demo-panel' }, h('strong', null, 'DEMO ONLY: classroom code panel'), h('p', { class: 'small' }, 'A real authenticator app would show this code; real systems never display it next to the login form.'), code, ' ', left),
      h('details', null, h('summary', null, 'Set up an authenticator app'),
        h('ol', null, h('li', null, 'Open an authenticator app (any TOTP app).'), h('li', null, 'Add an account manually: choose "enter a setup key".'), h('li', null, 'Secret key (base32): ', h('code', { id: 'mfa-secret' }, u.mfaSecret)), h('li', null, 'Type: time-based, 6 digits, 30 seconds.')),
        h('p', { class: 'small' }, 'Setup URI: ', h('code', null, uri)))));
  }

  function staffDetails(s) {
    let d = document.getElementById('staff-dialog');
    if (!d) { d = h('dialog', { id: 'staff-dialog', 'aria-labelledby': 'sd-title' }); document.body.append(d); }
    mount(d, h('div', { class: 'name-cell' }, NL.avatar(s.name, 'lg'), h('div', null, h('h2', { id: 'sd-title' }, s.name), badge(s.status === 'active' ? 'Active' : 'Leaver', s.status === 'active' ? 'ok' : 'danger'))),
      h('dl', { class: 'kv' }, [['Email', s.email], ['Job title', s.title], ['Department', s.department], ['Access role', roleLabel(s.accessRole)], ['MFA', s.mfaEnabled ? 'Enabled (TOTP)' : 'Off'], ['Employee ID', s.id],
        ['Departed', s.departedAt ? NL.fmtDate(s.departedAt) : '—']].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      h('h3', null, 'Account history'), h('ul', { class: 'timeline' }, (s.events || []).slice().reverse().map((e) => h('li', null, NL.fmtDate(e.at) + ' — ' + e.text))),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Close'));
    d.showModal();
  }

  function directory() {
    const f = h('select', { id: 'dir-dept' }, h('option', { value: '' }, 'All departments'), CFG.departments.map((d) => h('option', null, d)));
    const q = h('input', { id: 'dir-q', type: 'search', placeholder: 'Search people', value: new URLSearchParams(location.search).get('q') || '' });
    const host = h('div', { id: 'dir-table' });
    const fill = () => {
      const t = q.value.trim().toLowerCase();
      const rows = store.list('staff').filter((s) => (!f.value || s.department === f.value) && (!t || [s.name, s.email, s.title].join(' ').toLowerCase().includes(t)));
      mount(host, NL.table([{ label: 'Name', render: (s) => h('span', { class: 'name-cell' }, NL.avatar(s.name), h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'View details for ' + s.name, onclick: () => staffDetails(s) }, s.name)) },
        { label: 'Email', render: (s) => s.email }, { label: 'Title', render: (s) => s.title }, { label: 'Department', render: (s) => s.department },
        { label: 'Account', render: (s) => badge(s.status === 'active' ? 'Active' : 'Leaver', s.status === 'active' ? 'ok' : 'danger') }, { label: 'MFA', render: (s) => (s.mfaEnabled ? 'Enabled' : 'Off') }], rows,
      { caption: 'Staff directory', emptyTitle: 'No employees match', emptyText: 'Try another name or department.' }));
    };
    f.addEventListener('change', fill); q.addEventListener('input', fill); fill();
    return h('div', { class: 'card' }, h('h2', null, 'Directory'),
      h('div', { class: 'toolbar' }, h('div', { class: 'field' }, h('label', { for: 'dir-q' }, 'Search'), q), h('div', { class: 'field' }, h('label', { for: 'dir-dept' }, 'Department'), f)), host);
  }

  function overview() {
    const all = store.list('staff'), stat = (n, l) => h('div', { class: 'card stat' }, h('span', { class: 'num' }, n), h('span', { class: 'label' }, l));
    return h('div', { class: 'grid', id: 'staff-overview' }, stat(all.length, 'Total employees'), stat(all.filter((s) => s.status === 'active').length, 'Active accounts'),
      CFG.departments.map((d) => stat(all.filter((s) => s.department === d && s.status === 'active').length, d + ' team')));
  }

  function adminPanel(me) {
    const all = store.list('staff');
    const stat = (n, l) => h('div', { class: 'card stat' }, h('span', { class: 'num' }, n), h('span', { class: 'label' }, l));
    const form = h('form', { novalidate: true, id: 'joiner-form' }, h('h3', null, 'Joiner: create staff account'),
      h('div', { class: 'form-grid' }, NL.field('j-name', 'Full name', h('input', { id: 'j-name' })), NL.field('j-email', 'Email', h('input', { id: 'j-email', type: 'email' })),
        NL.field('j-dept', 'Department', h('select', { id: 'j-dept' }, CFG.departments.map((d) => h('option', null, d)))), NL.field('j-title', 'Job title', h('input', { id: 'j-title' })),
        NL.field('j-role', 'Access role', h('select', { id: 'j-role' }, Object.entries(CFG.accessRoles).map(([v, l]) => h('option', { value: v }, l))))),
      h('button', { class: 'btn', type: 'submit' }, 'Create and activate account'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = $('#j-name'), em = $('#j-email'), t = $('#j-title');
      const dup = store.list('staff').some((s) => s.email.toLowerCase() === em.value.trim().toLowerCase());
      NL.setError(n, n.value.trim() ? '' : 'Enter the full name.');
      NL.setError(em, !/^\S+@\S+\.\S+$/.test(em.value.trim()) ? 'Enter a valid email address.' : dup ? 'An account with this email already exists.' : '');
      NL.setError(t, t.value.trim() ? '' : 'Enter a job title.');
      if (!n.value.trim() || !t.value.trim() || !/^\S+@\S+\.\S+$/.test(em.value.trim()) || dup) return;
      const temp = b64(rand(12)).replace(/[+/=]/g, 'x'), secret = base32Encode(rand(20)), cred = await makeCred(temp);
      const u = store.create('staff', { name: n.value.trim(), email: em.value.trim().toLowerCase(), title: t.value.trim(), department: $('#j-dept').value, accessRole: $('#j-role').value,
        status: 'active', demo: false, mfaEnabled: true, mfaSecret: secret, cred, events: [{ at: new Date().toISOString(), text: 'Joiner: account created by ' + me.name }] });
      NL.tickets.create({ requester: me.name, department: 'IT', description: 'Joiner: provision laptop and accounts for ' + u.name + ' (' + u.department + ').', impact: 'minor', urgency: 'normal', source: 'staff' });
      joinerResult = { name: u.name, email: u.email, temp, secret };
      render();
    });
    return h('section', { id: 'admin-panel', class: 'stack' }, h('h2', null, 'IT administration'),
      h('div', { class: 'grid' }, stat(all.filter((s) => s.status === 'active').length, 'Active accounts'), stat(all.filter((s) => s.status === 'leaver').length, 'Leavers (history kept)'), stat(all.filter((s) => s.mfaEnabled).length, 'MFA enabled')),
      joinerResult ? h('div', { class: 'alert alert-success', id: 'joiner-result', role: 'status' }, h('strong', null, 'Account created for ' + joinerResult.name + '. '), 'Shown once (fictional): temporary password ', h('code', null, joinerResult.temp), ', MFA secret ', h('code', null, joinerResult.secret), '. A provisioning ticket was added to the help desk.') : null,
      h('div', { class: 'card' }, form),
      h('div', { class: 'card' }, h('h3', null, 'Leaver workflow'), h('p', { class: 'hint' }, 'Blocks further demo sign-ins and records the departure. The staff record is preserved.'),
        NL.table([{ label: 'Name', render: (s) => s.name }, { label: 'Status', render: (s) => (s.status === 'active' ? 'Active' : 'Left ' + NL.fmtDay(s.departedAt)) },
          { label: 'Action', render: (s) => (s.status === 'active' ? h('button', { class: 'btn danger sm', type: 'button', 'aria-label': 'Mark ' + s.name + ' as leaver', disabled: s.id === me.id, onclick: () => {
            if (!confirm('Mark ' + s.name + ' as a leaver and block sign-in?')) return;
            store.update('staff', s.id, (x) => { x.status = 'leaver'; x.departedAt = new Date().toISOString(); x.events.push({ at: x.departedAt, text: 'Leaver: account blocked by ' + me.name }); });
            NL.tickets.create({ requester: me.name, department: 'IT', description: 'Leaver: collect equipment and remove access for ' + s.name + '.', impact: 'blocked', urgency: 'high', source: 'staff' });
            NL.toast(s.name + ' marked as leaver.');
          } }, 'Mark as leaver') : badge('Blocked', 'danger')) }], all, { caption: 'Joiner and leaver management' })));
  }

  function simplePanel(id, title, lines, href, linkText) {
    return h('section', { id, class: 'card' }, h('h2', null, title), h('ul', null, lines.map((l) => h('li', null, l))), h('a', { class: 'btn ghost sm', href }, linkText));
  }
  function rolePanel(me) {
    if (me.accessRole === 'it-admin') return adminPanel(me);
    if (me.accessRole === 'it-support') { const open = store.list('tickets').filter((t) => t.status !== 'Resolved'); return simplePanel('support-panel', 'IT support workspace', [open.length + ' open tickets, ' + open.filter((t) => t.priority === 'P1').length + ' critical (P1).', 'Staff administration (joiners and leavers) is restricted to IT Administrators.'], 'helpdesk.html', 'Open help desk'); }
    if (me.accessRole === 'sales') return simplePanel('sales-panel', 'Sales workspace', [store.list('leads').length + ' leads and ' + store.list('opportunities').filter((o) => !['Won', 'Lost'].includes(o.stage)).length + ' open opportunities in the CRM.'], 'crm.html', 'Open CRM');
    return simplePanel('design-panel', 'Design workspace', ['Design team: ' + store.list('staff').filter((s) => s.department === 'Design' && s.status === 'active').map((s) => s.name).join(', ') + '.', 'New starters appear in the directory with the title "New Starter".'], 'index.html#work', 'View portfolio');
  }

  function appView(me) {
    return h('div', { class: 'stack', id: 'staff-app' },
      h('div', { class: 'card row between' }, h('div', null, h('strong', { id: 'whoami' }, me.name), ' · ' + me.title + ' (' + me.department + ') · access role: ', badge(roleLabel(me.accessRole), 'info')),
        h('button', { class: 'btn ghost sm', type: 'button', id: 'logout', onclick: () => { setSession(null); render(); } }, 'Sign out')),
      overview(), rolePanel(me), directory());
  }

  function render() {
    clearInterval(timer);
    const keepFocus = document.activeElement && document.activeElement.id;
    const s = getSession(), me = s && store.find('staff', s.id);
    if (s && (!me || me.status !== 'active')) setSession(null); // leaver signed out immediately
    if (me && me.status === 'active') mount(root, appView(me));
    else if (pending) mount(root, mfaView());
    else mount(root, loginView());
    if (keepFocus && document.getElementById(keepFocus)) document.getElementById(keepFocus).focus();
  }

  store.onChange(() => { if (!$('#login-form input:focus, #mfa-form input:focus, #joiner-form input:focus, #joiner-form select:focus')) render(); });
  render();
  ensureDemoCreds().then(() => { ready = true; render(); });
})();
