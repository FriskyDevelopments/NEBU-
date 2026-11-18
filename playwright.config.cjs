const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  workers: 1,
  reporter: 'list',
  use: { headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'chrome-stable', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'chromium-pinned', use: { browserName: 'chromium' } },
  ],
});
