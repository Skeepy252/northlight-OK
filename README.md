# Northlight Studio: IT Capstone Environment

A fictional 25-person design agency (Design, Sales, IT) and the integrated IT environment around it, built as a static website with vanilla HTML, CSS and JavaScript, tested with Playwright and deployed to GitHub Pages.

> **Everything is fictional.** All people, companies, emails and data are invented. This is an educational demonstration, not a production system.

- Repository: <https://github.com/Skeepy252/northlight-OK>
- Live site (after Pages is enabled, see [GitHub Pages](#github-pages)): <https://skeepy252.github.io/northlight-OK/>

## Project overview

Northlight Studio recently moved into a new office. This project shows how eight systems work together as **one** environment instead of eight separate demos: a website enquiry becomes a CRM lead *and* a help desk ticket through a rule-driven automation engine, an urgent enquiry produces a P1 ticket and a simulated alert, staff joiners and leavers raise help desk tickets, and all of it lives in one shared data layer.

## Architecture

```
            index.html (website form)
                     │ submit
                     ▼
   rules.json ──► automation engine (assets/js/automation.js)
                     │ creates                         │ logs / alerts
        ┌────────────┴─────────────┐                   ▼
        ▼                          ▼          automation.html (rules, outbox, activity)
   CRM lead (crm.html)     Help desk ticket (helpdesk.html)
        └────────────┬─────────────┘
                     ▼
     shared store: assets/js/storage.js  →  localStorage key "northlight.v1.state"
                     ▲
      staff.html (joiners/leavers raise tickets) · config.js · health.json · Export all data
```

| # | Module | Files |
|---|---|---|
| 1 | IT help desk | `helpdesk.html`, `assets/js/helpdesk.js` |
| 2 | PC and network tools | `tools/pc-health.js`, `tools/network-doctor.js`, `troubleshoot.html` |
| 3 | Staff directory and MFA | `staff.html`, `assets/js/staff.js` |
| 4 | Company website | `index.html`, `assets/js/website.js` |
| 5 | CRM | `crm.html`, `assets/js/crm.js` |
| 6 | Automation engine | `rules.json`, `automation.html`, `assets/js/automation.js` |
| 7 | Cloud config and CI/CD | `health.json`, `config.js`, `northlight.cloud.json`, `tools/check-cloud.js`, `.github/workflows/deploy.yml` |
| 8 | Security testing | `tests/`, `tools/check-secrets.js`, `tools/check-static.js`, `RISKS.md` |

Shared pieces: `assets/css/styles.css` (one design system), `assets/js/common.js` (safe DOM builder, header/footer, ticket helpers), `config.js` (single source of settings).

## Technologies

HTML5, CSS3, vanilla JavaScript (no frameworks, no CDNs, no build step), Web Crypto API (PBKDF2, HMAC), `localStorage`, JSON, SVG, Node.js (CLI tools and static dev server), Playwright, GitHub Actions, GitHub Pages. The only npm dependency is `@playwright/test` (dev only).

## Installation

Requires Node.js 20 or newer.

```bash
npm install
npx playwright install chromium
```

## Local development

```bash
npm start
```

Then open <http://localhost:8080/>. (`node tools/serve.js --port 4173 --base /northlight-OK/` serves under a sub-path, as the tests do.) Opening the HTML files directly with `file://` is not supported because `rules.json` and `health.json` are loaded with `fetch`.

## GitHub Pages

1. The repository must be **public** (GitHub Pages on free personal accounts needs a public repository) and you need admin rights on it.
2. In the repository go to **Settings → Pages** and set **Source = GitHub Actions**. This one-time step cannot be done by the workflow itself.
3. Push to `main` (or run the workflow manually in the **Actions** tab). The workflow `.github/workflows/deploy.yml` has two separate jobs:
   - **test**: `npm ci`, static validation, cloud check, secret check, Playwright tests. Also runs on pull requests.
   - **deploy**: runs only if `test` succeeded and only for pushes to `main`; it publishes just the runtime files (HTML, JSON, `config.js`, `assets/`).
4. Verify: the green check on the latest run, the `github-pages` environment in the repository sidebar, and the live URL printed in the deploy job (`https://<user>.github.io/northlight-OK/`).

All asset paths are relative, so the site works under the `/northlight-OK/` sub-path. The tests run under that sub-path deliberately.

## Features

- **Help desk.** Tickets with requester, department, impact, urgency, priority (P1 within 1 hour, P2 within 1 working day, P3 within 3 working days), status (New / In Progress / Resolved), replies, history, search, filters, export, overdue labels, sorted by priority then age. Security tickets show educational incident-response guidance.
- **PC and network tools.** `npm run pc-health` and `npm run network-doctor` are **read-only**: they change no settings, install nothing and never scan networks. UNKNOWN is reported when something cannot be measured. The troubleshooting page is an interactive "No internet connection" decision tree (connection → IP → router → external IP → DNS). Run the scripts only on machines you are authorised to troubleshoot, not on managed or school computers without permission.
- **Staff and identity.** Login with PBKDF2-SHA256 hashed passwords (unique salt, 600,000 iterations), RFC 6238 TOTP second step (base32 secret, 30 s windows, 6 digits, ±1 window), role-based views, joiner and leaver workflows (leavers are blocked but their records are kept).
- **Website.** Services, portfolio, FAQ, validated enquiry form, SEO metadata, JSON-LD (Organization, WebSite, FAQPage). No ranking or AI-search visibility is promised.
- **CRM.** Leads, accounts, contacts, opportunities with pipeline stages, support cases with overdue flags, idempotent lead conversion, dashboard cards and a dynamic SVG chart.
- **Automation.** `rules.json` drives: create lead → create P3 ticket → urgent condition → P1 and simulated outbox alert → log with timestamp and rule ID. Handles missing/invalid rules, missing fields and duplicate submissions. Non-core rules can be switched off on the dashboard.
- **Data.** Global **Export all data** button (footer) downloads one JSON file locally; nothing is uploaded. Password hashes and MFA secrets are excluded from the export. **Reset demo data** restores the seed.

## Demo accounts

> **PUBLIC demo-only credentials. Never use them or this password pattern in any real system.**

Shared password for all accounts: `NorthlightDemo-Only-2026`

| Name | Email | Role |
|---|---|---|
| Jordan Lee | jordan.lee@northlight.example | IT Administrator |
| Casey Morgan | casey.morgan@northlight.example | IT Support |
| Alex Rivera | alex.rivera@northlight.example | Sales |
| Taylor Brooks | taylor.brooks@northlight.example | Sales Manager |
| Sam Patel | sam.patel@northlight.example | Designer |
| Maya Chen | maya.chen@northlight.example | New Starter (Design) |

After the password, the second step needs a 6-digit code. Each account has its own TOTP secret; the login page shows a clearly labelled **demo-only code panel** so you can test without an authenticator app (or add the displayed secret to any authenticator app).

## Data

All state lives in one `localStorage` key (`northlight.v1.state`) with a schema version and migration hook; malformed data is backed up to `northlight.v1.state.corrupt` and replaced with seed data. Pages update when storage changes (also across tabs). **localStorage is specific to one browser profile on one device: it is not synchronised between visitors, devices or browsers and is never sent to a server.** Clearing site data deletes it. Use *Export all data* to keep a copy.

## Security limitations

This is a teaching project. Specifically:

- **No real backend** and **no server-side database**.
- **No production authentication**: login, roles and MFA run in the browser and can be inspected or bypassed by anyone with developer tools. Hiding the IT admin interface from Sales users is a *UI demonstration*, not access control. Real enforcement belongs on a trusted server or identity platform.
- **No real MFA enforcement**, no rate limiting or lockout.
- **No actual email delivery**: the outbox is a simulated queue.
- **No real Azure resources**: `northlight.cloud.json` is descriptive only.
- GitHub Pages and `localStorage` are **not** secure storage for confidential information.

See [RISKS.md](RISKS.md) for the full risk assessment.

## Testing

```bash
npm test            # Playwright (starts the local server automatically)
npm run check       # static validation + cloud config + secret scan
```

The suite covers page loads without JS errors, sub-path asset resolution, navigation, form validation, enquiry → lead + ticket + automation, urgent P1 escalation and outbox, duplicate and failed-config handling, help desk workflow, CRM conversion and chart, staff login/TOTP (RFC test vector), leaver blocking, role UI, XSS, CSP, secret scanning, cloud validation, export, persistence, cross-tab sync, and the CLI tools with **mocked** command output (no network or settings are touched). Tests only ever target the local server.

Run the diagnostics yourself (on a machine you are authorised to troubleshoot):

```bash
npm run pc-health
npm run network-doctor
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Pages show "rules.json could not be loaded" | Serve over HTTP (`npm start`); do not open files via `file://`. |
| Login button says "Preparing demo accounts…" | First load hashes six passwords (a second or two). |
| Data vanished | Browser storage was cleared or you used a private window. There is no server copy; use *Reset demo data* to restore the sample data, and *Export all data* beforehand to keep a copy. |
| `npx playwright install` fails | Check network/proxy access, then retry; on Linux add `--with-deps`. |
| Pages URL is 404 after a green run | Settings → Pages → Source must be **GitHub Actions**. |
| Port 8080 busy | `node tools/serve.js --port 3000`. |

## Portfolio presentation

A five-minute walkthrough for a reviewer:

1. **Home**: submit the enquiry form with *Urgent* selected.
2. **Help Desk**: the new ticket is **P1**, sorted to the top; open the phishing ticket to show the response guidance.
3. **CRM**: the lead is there; click **Convert** and watch the SVG pipeline chart change.
4. **Automation**: show the rule that fired, the simulated outbox alert and the timestamped log; disable a rule and resend a sample.
5. **Staff**: sign in as Jordan (password + demo TOTP code), create a joiner, mark a leaver, then show the leaver is blocked; sign in as Alex to show a different role view (and explain why this is not real access control).
6. **Troubleshooting** and the Node tools, then the green GitHub Actions run and `RISKS.md`.
