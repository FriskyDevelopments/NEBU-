const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { validateCapture, missingSelectors } = require('../../scripts/check-zoom-selectors.cjs');
const html = fs.readFileSync(path.join(__dirname, 'fixtures/selector-states.html'), 'utf8');

test.use({ javaScriptEnabled: false });
test.beforeEach(async ({ context }) => { await context.route('**/*', route => route.abort()); });

test('every shipped selector group and menu label matches the contract', async ({ page }) => {
  expect(await missingSelectors(page, [html])).toEqual([]);
});

test('detects upstream meeting and menu drift', async ({ page }) => {
  const drift = html.replaceAll('meeting-client', 'changed-root').replaceAll('wc-container-left', 'changed-id')
    .replaceAll('Multi-pin', 'changed-label');
  expect(await missingSelectors(page, [drift])).toEqual(expect.arrayContaining(['MEETING_ROOT', 'WC_MEETING_ROOT', 'MULTIPIN_OPTION_TEXT']));
});

test('Multi-pin and Unpin cannot satisfy a missing Pin label', async ({ page }) => {
  const drift = html.replace('<button role="menuitem">Pin</button>', '');
  expect(await missingSelectors(page, [drift])).toEqual(['PIN_OPTION_TEXT']);
});

test('rejects stale, future and incomplete captures', () => {
  const capture = { capturedAt: new Date().toISOString(), zoomVersion: 'test-version', snapshots: [html] };
  expect(validateCapture(capture)).toEqual([html]);
  expect(() => validateCapture({ ...capture, capturedAt: '2024-01-01' })).toThrow();
  expect(() => validateCapture({ ...capture, capturedAt: new Date(Date.now() + 86400000).toISOString() })).toThrow();
  expect(() => validateCapture({ ...capture, snapshots: [] })).toThrow();
  expect(() => validateCapture({ ...capture, zoomVersion: '' })).toThrow();
});
