const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { loadCore } = require('./helpers.cjs');

test.beforeEach(async ({ page }) => {
  await page.setContent(fs.readFileSync(path.join(__dirname, 'fixtures/meeting.html'), 'utf8'));
  await loadCore(page);
  await page.evaluate(() => {
    window.actions = [];
    document.querySelector('[data-testid="video-tile"]').addEventListener('contextmenu', event => {
      event.preventDefault();
      document.querySelector('[role="menu"]').hidden = false;
    });
    document.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
      window.actions.push(button.textContent);
    }));
  });
});

test('reports the actual browser version', async ({ browser }) => {
  console.log(`Browser version: ${browser.version()}`);
});

test('detects meeting, participants, video and controls', async ({ page }) => {
  expect(await page.evaluate(() => window.testProbe.probeWebClientDom())).toMatchObject({
    meetingRootFound: true, participantPanelFound: true, participantRowsFound: 1,
    controlBarFound: true, videoTilesFound: 1, prejoinFound: false, endedFound: false,
  });
});

test('pins, unpins and admits using native DOM events', async ({ page }) => {
  expect(await page.evaluate(() => window.testAdapter.pinParticipant('Test Participant'))).toBe('MULTIPIN_GRANTED');
  expect(await page.evaluate(() => window.testAdapter.unpinParticipant('Test Participant'))).toBe('MULTIPIN_REMOVED');
  expect(await page.evaluate(() => window.testAdapter.admitParticipant('Waiting Participant'))).toBe(true);
  expect(await page.evaluate(() => window.actions)).toEqual(['Multi-pin', 'Unpin', 'Admit']);
});

test('does not act on absent participants', async ({ page }) => {
  expect(await page.evaluate(() => window.testAdapter.pinParticipant('Absent'))).toBe('USER_NOT_FOUND');
  expect(await page.evaluate(() => window.testAdapter.admitParticipant('Absent'))).toBe(false);
  expect(await page.evaluate(() => window.actions)).toEqual([]);
});
