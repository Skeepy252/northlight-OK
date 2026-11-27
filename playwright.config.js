const { defineConfig } = require('@playwright/test');
// Tests run under a sub-path on purpose: any absolute "/asset" URL would 404, like on GitHub Pages.
const BASE = '/northlight-OK/';
module.exports = defineConfig({
  testDir: 'tests',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:4173${BASE}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node tools/serve.js --port 4173 --base ${BASE}`,
    url: `http://127.0.0.1:4173${BASE}health.json`,
    reuseExistingServer: !process.env.CI
  }
});
