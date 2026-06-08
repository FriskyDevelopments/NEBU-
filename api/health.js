// Vercel Serverless Function – Health & Readiness Probe
// ESM-native; no require() calls.
import axios from 'axios';

const RAILWAY_BACKEND =
  process.env.RAILWAY_BACKEND || 'https://nebulosa-production.railway.app';

// Module-level start time – survives warm re-invocations on the same instance
const MODULE_START_MS = Date.now();
const VERSION = '1.0.0';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const probeStart = Date.now();

  // ------------------------------------------------------------------
  // Probe the Railway backend
  // ------------------------------------------------------------------
  let railway = { status: 'unknown', latencyMs: null, error: null };
  try {
    const t0 = Date.now();
    const { data } = await axios.get(`${RAILWAY_BACKEND}/health`, { timeout: 5000 });
    railway = {
      status: data?.status ?? 'ok',
      latencyMs: Date.now() - t0,
      uptime: data?.uptime ?? null,
      error: null,
    };
  } catch (err) {
    railway = {
      status: 'unreachable',
      latencyMs: null,
      error: err.message,
    };
  }

  const overall =
    railway.status === 'healthy' || railway.status === 'ok' ? 'healthy' : 'degraded';

  const body = {
    overall,
    version: VERSION,
    platform: 'vercel',
    node: process.version,
    region: process.env.VERCEL_REGION ?? 'unknown',
    deployment: process.env.VERCEL_URL ?? 'local',
    instanceUptimeMs: Date.now() - MODULE_START_MS,
    probeResponseTimeMs: Date.now() - probeStart,
    timestamp: new Date().toISOString(),
    railway: {
      url: RAILWAY_BACKEND,
      ...railway,
    },
    deployment_strategy: {
      production: 'railway (long-running polling + oauth server)',
      webhooks: 'vercel (serverless edge functions)',
      oauth_callback: 'vercel → railway',
    },
  };

  return res.status(overall === 'healthy' ? 200 : 503).json(body);
}
