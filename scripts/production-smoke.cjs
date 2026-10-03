const checks = [
  { path: '', type: 'text/html', marker: /<title>\s*LA NUBE BOT\s*-\s*Documentation\s*<\/title>/i },
  { path: 'docs-index.html', type: 'text/html', marker: /<title>[^<]*LA NUBE BOT[^<]*Documentation/i },
  { path: 'favicon.svg', type: 'image/svg+xml', marker: /<svg[\s>]/i },
  { path: '404.html', type: 'text/html', marker: /<title>[^<]*Page Not Found[^<]*LA NUBE BOT/i },
];

function siteUrl(value) {
  const url = new URL(value);
  const allowed = (url.hostname === 'nebu.quest' && url.pathname === '/') ||
    (url.hostname === 'friskydevelopments.github.io' && url.pathname === '/NEBU-/');
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('Smoke target must be an approved NEBU Pages URL');
  }
  return url;
}

async function runSmoke(value, { fetchFn = fetch, attempts = 3, delay = () => new Promise(resolve => setTimeout(resolve, 1000)) } = {}) {
  const base = siteUrl(value);
  for (const check of checks) {
    let passed = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetchFn(new URL(check.path, base), {
          method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { 'Cache-Control': 'no-cache' },
        });
        passed = response.status === 200 &&
          (response.headers.get('content-type') || '').includes(check.type) &&
          check.marker.test(await response.text());
      } catch (_) { passed = false; }
      if (passed) break;
      if (attempt + 1 < attempts) await delay();
    }
    if (!passed) throw new Error(`Production smoke failed: ${check.path || 'root'}`);
  }
  return checks.length;
}

if (require.main === module) {
  runSmoke(process.env.PRODUCTION_SITE_URL || 'https://nebu.quest/').then(count => {
    console.log(`Production smoke passed: ${count} read-only checks`);
  }).catch(() => {
    console.error('Production smoke failed; inspect NEBU Pages availability and content');
    process.exitCode = 1;
  });
}

module.exports = { checks, siteUrl, runSmoke };
