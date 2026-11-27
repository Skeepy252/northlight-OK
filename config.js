// Single source of application settings. No real secrets belong here (static site: everything is public).
window.NL_CONFIG = Object.freeze({
  appName: 'Northlight Studio',
  storageKey: 'northlight.v1.state',
  sessionKey: 'northlight.v1.session',
  schemaVersion: 1,
  rulesUrl: 'rules.json',
  healthUrl: 'health.json',
  departments: ['Design', 'Sales', 'IT'],
  ticketDepartments: ['Design', 'Sales', 'IT', 'Finance', 'Management', 'External'],
  accessRoles: { 'it-admin': 'IT Administrator', 'it-support': 'IT Support', sales: 'Sales', design: 'Design' },
  // Response targets: hours for P1, working days for P2/P3.
  sla: { P1: { hours: 1 }, P2: { workdays: 1 }, P3: { workdays: 3 } },
  urgentAlertTo: 'it-oncall@northlight.example',
  // PBKDF2-SHA256; OWASP guidance for SHA-256 is >= 600,000 iterations.
  pbkdf2Iterations: 600000,
  totp: { stepSeconds: 30, digits: 6, window: 1 },
  // PUBLIC demo-only password shared by the six fictional accounts. Never reuse it anywhere.
  demoPassword: 'NorthlightDemo-Only-2026' // demo-public
});
