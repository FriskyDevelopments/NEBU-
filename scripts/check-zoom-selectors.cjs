const fs = require('node:fs');
const { chromium } = require('playwright');
const selectors = require('../apps/extension-nebulosa-control/integrations/zoom/selectors');

function validateCapture(capture, now = Date.now()) {
  const age = now - Date.parse(capture.capturedAt);
  if (!Number.isFinite(age) || age < 0 || age > 7 * 86400000) {
    throw new Error('Zoom capture must be dated within the last seven days');
  }
  if (typeof capture.zoomVersion !== 'string' || !capture.zoomVersion.trim() ||
      !Array.isArray(capture.snapshots) || !capture.snapshots.length ||
      capture.snapshots.some(html => typeof html !== 'string' || !html.trim())) {
    throw new Error('Zoom capture requires zoomVersion and nonempty HTML snapshots');
  }
  return capture.snapshots;
}

async function missingSelectors(page, snapshots) {
  const missing = new Set(Object.keys(selectors));
  for (const html of snapshots) {
    await page.setContent(html);
    for (const key of missing) {
      const value = selectors[key];
      const found = Array.isArray(value)
        ? await page.locator(value.join(', ')).count()
        : await page.getByRole('menuitem', { name: value, exact: true }).count();
      if (found) missing.delete(key);
    }
  }
  return [...missing];
}

async function main() {
  let text;
  if (process.env.ZOOM_DOM_SNAPSHOT_PATH) {
    text = fs.readFileSync(process.env.ZOOM_DOM_SNAPSHOT_PATH, 'utf8');
  } else {
    const url = new URL(process.env.ZOOM_DOM_SNAPSHOT_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Capture URL must be HTTPS without credentials, query or fragment');
    }
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Could not retrieve sanitized Zoom capture');
    text = await response.text();
  }
  const snapshots = validateCapture(JSON.parse(text));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', route => route.abort());
    const missing = await missingSelectors(await context.newPage(), snapshots);
    if (missing.length) throw new Error(`Zoom selector drift: ${missing.join(', ')}`);
    console.log('Zoom selector release gate passed');
  } finally {
    await browser.close();
  }
}

if (require.main === module) main().catch(() => {
  // Capture contents and remote URLs may be private.
  console.error('Zoom selector release gate failed; check capture freshness and selector coverage locally');
  process.exitCode = 1;
});

module.exports = { validateCapture, missingSelectors };
