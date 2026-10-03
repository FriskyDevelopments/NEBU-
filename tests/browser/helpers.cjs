const fs = require('node:fs');
const path = require('node:path');

const extension = path.resolve(__dirname, '../../apps/extension-nebulosa-control');

async function loadCore(page) {
  await page.evaluate(() => { window.testModules = {}; });
  for (const file of [
    'packages/event-bus/index.js',
    'integrations/zoom/selectors.js',
    'integrations/zoom/events.js',
    'integrations/zoom/wc-probe.js',
    'integrations/zoom/adapter.js',
  ]) {
    const source = fs.readFileSync(path.join(extension, file), 'utf8');
    // Only checked-in extension modules are injected, never capture or remote content.
    await page.addScriptTag({ content: `(() => {
      const file = ${JSON.stringify(file)};
      const module = { exports: {} };
      const require = name => {
        const parts = (file.slice(0, file.lastIndexOf('/')) + '/' + name).split('/');
        const normalized = [];
        for (const part of parts) {
          if (part === '..') normalized.pop();
          else if (part !== '.') normalized.push(part);
        }
        let target = normalized.join('/');
        target += target.includes('event-bus') ? '/index.js' : '.js';
        return window.testModules[target];
      };
      ${source}
      window.testModules[file] = module.exports;
    })();` });
  }
  await page.evaluate(() => {
    window.testSelectors = window.testModules['integrations/zoom/selectors.js'];
    window.testProbe = window.testModules['integrations/zoom/wc-probe.js'];
    window.testAdapter = window.testModules['integrations/zoom/adapter.js'];
  });
}

module.exports = { loadCore };
