// Vercel Serverless Function – Register Telegram Webhook
// Call this endpoint once after deployment (or whenever the webhook URL changes).
// Requires ADMIN_SECRET header for protection.
import axios from 'axios';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed – use POST' });
  }

  // Simple admin guard
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret && req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'BOT_TOKEN not configured' });
  }

  const VERCEL_URL = process.env.VERCEL_URL;
  if (!VERCEL_URL) {
    return res.status(500).json({
      error: 'VERCEL_URL not set – cannot determine webhook URL',
      hint: 'Set VERCEL_URL to your deployment URL, e.g. nebulosa.vercel.app',
    });
  }

  const webhookUrl = `https://${VERCEL_URL}/api/bot`;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  try {
    const params = { url: webhookUrl };
    if (secret) params.secret_token = secret;

    const response = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
      params,
      { timeout: 10_000 }
    );

    const info = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`,
      { timeout: 5_000 }
    );

    return res.status(200).json({
      ok: true,
      registered: webhookUrl,
      telegram_response: response.data,
      webhook_info: info.data.result,
    });
  } catch (err) {
    console.error('[register-webhook] Failed:', err.message);
    return res.status(502).json({
      error: 'Failed to register webhook',
      message: err.message,
    });
  }
}
