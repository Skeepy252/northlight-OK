# Northlight Studio: Cybersecurity Risk Assessment

> **Scope.** Northlight Studio is a *fictional* company and this repository is an *educational demonstration*.
> The risks below describe how a real company of this type would be exposed, and how this project demonstrates or tests each one.

## Educational demonstration vs. production security

| | This project (browser-side demo) | A real production system |
|---|---|---|
| Authentication | Password check and TOTP run in the visitor's browser | Enforced on a trusted server / identity provider |
| Access control | Role-based *interface* hiding only | Server-side authorisation on every request |
| Data store | `localStorage`, readable and editable by the visitor | Access-controlled, encrypted, backed-up database |
| Email | Simulated outbox, nothing is sent | Real mail service with delivery monitoring |
| Cloud | Descriptive JSON, nothing provisioned | Deployed, monitored infrastructure |

**GitHub Pages and `localStorage` are not secure storage for confidential company information.** Anything shipped to the browser is public, and anything a user can open in developer tools can be changed. Never put real customer data, credentials or secrets in this project.

## Rating method

Likelihood (L) and Impact (I) are each scored 1 (low), 2 (medium) or 3 (high). **Risk score = L × I**.

| Score | Rating |
|---|---|
| 1-2 | Low |
| 3-4 | Medium |
| 6 | High |
| 9 | Critical |

## Risk register

| # | Risk | L | I | Score | Rating |
|---|---|---|---|---|---|
| 1 | Phishing | 3 | 3 | 9 | Critical |
| 2 | Malware | 2 | 3 | 6 | High |
| 3 | Weak authentication / credential exposure | 3 | 3 | 9 | Critical |
| 4 | Cross-site scripting and malicious input | 2 | 3 | 6 | High |
| 5 | Cloud misconfiguration / accidental data exposure | 2 | 3 | 6 | High |

---

### 1. Phishing

- **Description.** Deceptive emails or messages trick staff into opening attachments, following links or disclosing credentials.
- **Example scenario.** Three finance employees receive a fake invoice; one opens the attachment (seeded help desk ticket, P1).
- **Likelihood.** High (3): email is the most common attack route and finance teams are targeted frequently.
- **Impact.** High (3): credential theft, fraud, or a foothold for malware.
- **Rating.** **Critical (9).**
- **Mitigation.** Staff awareness training and reporting channel; MFA (a stolen password alone is not enough); email filtering with attachment sandboxing; block macros from the internet; a rehearsed response procedure.
- **Demonstrated / tested.** The phishing ticket shows response guidance (isolate the device, keep the email, warn colleagues, escalate, preserve evidence), covered in `tests/helpdesk.spec.js`. The TOTP second step is demonstrated in `tests/staff.spec.js`.

### 2. Malware

- **Description.** Malicious software (ransomware, trojans, infostealers) runs on a staff device or server.
- **Example scenario.** The opened invoice attachment installs malware on a finance laptop that then reaches shared files.
- **Likelihood.** Medium (2): reduced by patching and endpoint protection, but a realistic follow-on to phishing.
- **Impact.** High (3): data loss, downtime, ransom, regulatory exposure.
- **Rating.** **High (6).**
- **Mitigation.** Endpoint protection, timely OS and application updates, enabled firewall, least-privilege accounts, offline backups, network segmentation, isolate infected devices immediately.
- **Demonstrated / tested.** `tools/pc-health.js` reports firewall and update status (read-only); `tests/tools.spec.js` verifies PASS/FAIL/UNKNOWN logic against mocked output. The security ticket guidance covers isolation.

### 3. Weak authentication or credential exposure

- **Description.** Guessable, reused or leaked passwords; secrets committed to source control; credentials shown to users.
- **Example scenario.** A staff password reused from another breached service is used to sign in; or an API key is committed to a public repository.
- **Likelihood.** High (3): credential reuse is extremely common.
- **Impact.** High (3): account takeover and lateral movement.
- **Rating.** **Critical (9).**
- **Mitigation.** Unique strong passwords and a password manager; MFA; salted, slow password hashing (PBKDF2/Argon2/bcrypt) on the *server*; rate limiting and lockout; secret scanning in CI; never commit credentials; prompt leaver deactivation.
- **Demonstrated / tested.** Passwords are hashed with PBKDF2-SHA256 (600,000 iterations, unique salt) and never stored in plain text (`tests/staff.spec.js`). TOTP follows RFC 6238 and is verified against the RFC test vector. Leavers cannot sign in. `tools/check-secrets.js` runs in CI and in `tests/security.spec.js`. **Known limitation:** the six demo passwords are intentionally *public* and the TOTP secrets live in browser storage, so this is a teaching illustration, not protection. There is no rate limiting.

### 4. Cross-site scripting (XSS) and malicious user input

- **Description.** Attacker-controlled text is interpreted as HTML or JavaScript in another user's browser.
- **Example scenario.** A visitor submits `<img src=x onerror=...>` in the enquiry form; staff later open the help desk and the script runs.
- **Likelihood.** Medium (2): the site is static and small, but every form is a potential entry point.
- **Impact.** High (3): session theft, defacement, actions performed as the victim.
- **Rating.** **High (6).**
- **Mitigation.** Treat all input as untrusted; render with `textContent` / safe DOM construction; never use `innerHTML` with user data; a strict Content Security Policy; validate input on the server in a real system.
- **Demonstrated / tested.** All UI is built with a safe DOM helper (no `innerHTML`); `tools/check-static.js` fails the build if an unsafe sink appears. `tests/security.spec.js` submits a script-like payload and verifies it is shown as plain text on the help desk, CRM and automation pages and nothing executes. Every page ships a CSP `<meta>` (`script-src 'self'`, no inline scripts). Note that meta CSP cannot set `frame-ancestors`; a real deployment should send CSP as an HTTP header.

### 5. Cloud configuration and accidental data exposure

- **Description.** Misconfigured storage, public access, missing HTTPS, untagged resources or committed files expose data or hide ownership.
- **Example scenario.** A storage account is created with public blob access enabled, or a `.env` file is committed.
- **Likelihood.** Medium (2).
- **Impact.** High (3): leak of customer or company data.
- **Rating.** **High (6).**
- **Mitigation.** Infrastructure as code with review; policy checks for public access and HTTPS-only; naming conventions and mandatory tags (`owner`, `env`, `cost-center`) so every resource has an accountable owner; least-privilege access; no secrets in repositories.
- **Demonstrated / tested.** `northlight.cloud.json` describes an Azure-ready layout (nothing is provisioned). `tools/check-cloud.js` validates naming, required tags, and rejects public blob access and non-HTTPS settings; it runs in CI and is unit-tested with good and broken configurations. The deploy workflow publishes only runtime files and has no deployment secrets.

## Other limitations worth stating

- No server, so no server-side logging, alerting, rate limiting or audit trail.
- Browser storage is per browser and per profile; it is not shared between users and is not backed up.
- Third-party code is limited to a single dev dependency (`@playwright/test`); the shipped site has no external scripts, fonts or CDNs.
