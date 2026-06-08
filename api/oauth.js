// Vercel Serverless Function – Zoom OAuth Callback
// ESM-native; no require() calls.
//
// Security hardening applied:
//  • HTML-escapes all values derived from query params before interpolating into HTML
//  • Validates `state` format (must be 64-char hex) before forwarding to Railway
//  • Removes the fallback token-exchange path that stored credentials nowhere durable
//  • Narrows CORS to GET only (OAuth callbacks are browser navigations, not AJAX)
import axios from 'axios';

const RAILWAY_BACKEND =
  process.env.RAILWAY_BACKEND || 'https://nebulosa-production.railway.app';

// ---------------------------------------------------------------------------
// XSS prevention – escape every value before inserting into HTML strings
// ---------------------------------------------------------------------------
function h(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ---------------------------------------------------------------------------
// State validation – must be a 64-char hex string (crypto.randomBytes(32))
// ---------------------------------------------------------------------------
function isValidState(state) {
  return typeof state === 'string' && /^[0-9a-f]{64}$/.test(state);
}

// ---------------------------------------------------------------------------
// HTML page templates
// ---------------------------------------------------------------------------
function successPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nebulosa – Authorization Successful</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
         background:linear-gradient(135deg,#667eea,#764ba2);font-family:Arial,sans-serif;color:#fff}
    .card{background:rgba(255,255,255,.12);backdrop-filter:blur(12px);border-radius:20px;
          padding:48px 40px;max-width:480px;width:90%;text-align:center}
    h1{margin:0 0 16px;font-size:28px}
    p{margin:8px 0;font-size:16px;opacity:.9}
    ul{text-align:left;display:inline-block;margin:16px 0}
    li{margin:6px 0}
    .badge{display:inline-block;background:rgba(255,255,255,.2);border-radius:24px;
           padding:8px 20px;margin:6px}
    .note{margin-top:32px;font-size:13px;opacity:.7}
  </style>
</head>
<body>
  <div class="card">
    <h1>✅ Authorization Successful!</h1>
    <p>Your Zoom account has been connected to <strong>Nebulosa Bot</strong>.</p>
    <div style="margin:24px 0">
      <span class="badge">🤖 Telegram Bot Connected</span>
      <span class="badge">🎥 Zoom Integration Active</span>
    </div>
    <p>Return to Telegram and try <code>/status</code> to verify.</p>
    <ul>
      <li>Create instant meetings with <code>/createroom</code></li>
      <li>Monitor participants with <code>/scanroom</code></li>
      <li>Full command list with <code>/help</code></li>
    </ul>
    <p class="note">🚂 Powered by Railway + ▲ Vercel<br>This window closes in 10 seconds.</p>
  </div>
  <script>setTimeout(()=>window.close(),10000);</script>
</body>
</html>`;
}

function errorPage(title, detail) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Nebulosa – Authorization Error</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
         background:#1a1a2e;font-family:Arial,sans-serif;color:#fff}
    .card{background:#16213e;border:1px solid #e55;border-radius:16px;padding:40px;
          max-width:440px;width:90%;text-align:center}
    h1{color:#ff6b6b;margin:0 0 16px}
    p{opacity:.85;margin:8px 0}
    code{background:rgba(255,255,255,.1);padding:2px 6px;border-radius:4px}
  </style>
</head>
<body>
  <div class="card">
    <h1>❌ ${h(title)}</h1>
    <p>${h(detail)}</p>
    <p>Please return to Telegram and try <code>/zoomlogin</code> again.</p>
  </div>
  <script>setTimeout(()=>window.close(),8000);</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error: oauthError, error_description: oauthDesc } = req.query;

  // ------------------------------------------------------------------
  // 1. OAuth provider sent an error
  // ------------------------------------------------------------------
  if (oauthError) {
    console.error('[oauth] Provider error:', oauthError, oauthDesc);
    return res
      .status(400)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(errorPage('Authorization Failed', oauthDesc || oauthError));
  }

  // ------------------------------------------------------------------
  // 2. Missing required params
  // ------------------------------------------------------------------
  if (!code) {
    return res
      .status(400)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(errorPage('Invalid Request', 'Authorization code not received from Zoom.'));
  }

  if (!state || !isValidState(state)) {
    console.warn('[oauth] Invalid or missing state param:', state);
    return res
      .status(400)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(errorPage('Invalid Request', 'Missing or malformed state parameter.'));
  }

  // ------------------------------------------------------------------
  // 3. Forward to Railway for token exchange + session storage
  //    (Railway holds the oauth session map and database connection)
  // ------------------------------------------------------------------
  try {
    await axios.get(`${RAILWAY_BACKEND}/auth/zoom/callback`, {
      params: { code, state },
      timeout: 10_000,
    });

    return res
      .status(200)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(successPage());
  } catch (err) {
    console.error('[oauth] Railway callback failed:', err.message);

    // DO NOT attempt fallback token exchange here – there is no durable
    // storage in Vercel serverless functions, so tokens would be silently lost.
    // Surface a clear error instead.
    return res
      .status(502)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        errorPage(
          'Backend Unavailable',
          'The authorization backend is temporarily offline. Please try again in a moment.'
        )
      );
  }
}
