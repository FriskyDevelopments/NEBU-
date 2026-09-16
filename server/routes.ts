import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertBotLogSchema, insertBotMetricsSchema, insertMeetingInsightsSchema, insertEmojiPackSchema, insertEmojiAssetSchema, insertEmojiFontSchema, insertEmojiFontGlyphSchema } from "@shared/schema";
import { registerNebulosaRoutes } from "./nebulosa/routes";

export async function registerRoutes(app: Express): Promise<Server> {
  registerNebulosaRoutes(app);

  // Dashboard API routes — web admin panel removed (Telegram-only admin).
  // Bot telemetry ingest (POST /api/bot/logs, POST /api/bot/metrics) is kept for
  // the bot's own bookkeeping; the unauthenticated admin read surfaces are gone.

  app.post("/api/bot/logs", async (req, res) => {
    try {
      const logData = insertBotLogSchema.parse(req.body);
      const log = await storage.createBotLog(logData);
      res.json(log);
    } catch (error) {
      res.status(400).json({ error: "Invalid log data" });
    }
  });

  app.post("/api/bot/metrics", async (req, res) => {
    try {
      const metricsData = insertBotMetricsSchema.parse(req.body);
      const metrics = await storage.updateBotMetrics(metricsData);
      res.json(metrics);
    } catch (error) {
      res.status(400).json({ error: "Invalid metrics data" });
    }
  });

  // Zoom OAuth callback route
  app.get("/zoom/callback", async (req, res) => {
    try {
      const { code, state } = req.query;
      
      if (!code || !state) {
        return res.status(400).send("Missing authorization code or state");
      }

      // Import bot module to handle auth success
      const { handleZoomAuthSuccess, resolveOAuthState } = require('../bot.cjs');

      // Resolve the Telegram user ID via the OAuth state map (CSRF protection).
      // The raw state value must never be trusted as a user identifier.
      const telegramUserId = resolveOAuthState(state as string);
      if (!telegramUserId) {
        return res.status(400).send("Invalid or expired OAuth state. Please run /zoomlogin again.");
      }

      console.log(`Zoom OAuth callback received for user ${telegramUserId}`);
      
      // Exchange code for access token
      const { getAccessToken } = require('../zoomAuth.js');
      const tokenData = await getAccessToken(code as string);
      
      // Store token in database
      await storage.createZoomToken({
        telegramUserId: String(telegramUserId),
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: new Date(Date.now() + (tokenData.expires_in * 1000))
      });

      // Notify user via bot
      await handleZoomAuthSuccess(parseInt(String(telegramUserId)), tokenData.access_token);
      
      // Create bot log
      await storage.createBotLog({
        level: 'info',
        message: `Zoom OAuth completed successfully`,
        telegramUserId: String(telegramUserId),
        command: 'zoom_auth_callback'
      });

      res.send(`
        <html>
          <head>
            <title>LA NUBE BOT - Authorization Successful</title>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
              .container { background: white; padding: 30px; border-radius: 10px; max-width: 400px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .success { color: #28a745; font-size: 48px; }
              h1 { color: #333; }
              p { color: #666; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success">✅</div>
              <h1>Authorization Successful!</h1>
              <p>Your Zoom account has been successfully connected to LA NUBE BOT.</p>
              <p>You can close this window and return to Telegram.</p>
            </div>
          </body>
        </html>
      `);
      
    } catch (error) {
      console.error(`Zoom OAuth error: ${error}`);
      
      await storage.createBotLog({
        level: 'error',
        message: `Zoom OAuth failed: ${error.message}`,
        telegramUserId: req.query.state as string,
        command: 'zoom_auth_callback'
      });

      res.status(500).send(`
        <html>
          <head>
            <title>LA NUBE BOT - Authorization Error</title>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
              .container { background: white; padding: 30px; border-radius: 10px; max-width: 400px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .error { color: #dc3545; font-size: 48px; }
              h1 { color: #333; }
              p { color: #666; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="error">❌</div>
              <h1>Authorization Error</h1>
              <p>There was a problem connecting your Zoom account.</p>
              <p>Please try again from the Telegram bot.</p>
            </div>
          </body>
        </html>
      `);
    }
  });

  // Meeting Insights API routes
  app.get("/api/meetings/insights", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const insights = await storage.getMeetingInsights(limit);
      res.json(insights);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch meeting insights" });
    }
  });

  app.get("/api/meetings/active", async (req, res) => {
    try {
      const activeInsights = await storage.getActiveMeetingInsights();
      res.json(activeInsights);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch active meetings" });
    }
  });

  app.post("/api/meetings/insights", async (req, res) => {
    try {
      const insightData = insertMeetingInsightsSchema.parse(req.body);
      const insight = await storage.createMeetingInsight(insightData);
      res.json(insight);
    } catch (error) {
      res.status(400).json({ error: "Invalid meeting insight data" });
    }
  });

  app.patch("/api/meetings/insights/:meetingId", async (req, res) => {
    try {
      const { meetingId } = req.params;
      const updates = req.body;
      const insight = await storage.updateMeetingInsight(meetingId, updates);
      if (!insight) {
        return res.status(404).json({ error: "Meeting not found" });
      }
      res.json(insight);
    } catch (error) {
      res.status(400).json({ error: "Failed to update meeting insight" });
    }
  });

  app.post("/api/meetings/insights/:meetingId/end", async (req, res) => {
    try {
      const { meetingId } = req.params;
      const insight = await storage.endMeeting(meetingId);
      if (!insight) {
        return res.status(404).json({ error: "Meeting not found" });
      }
      res.json(insight);
    } catch (error) {
      res.status(400).json({ error: "Failed to end meeting" });
    }
  });

  // ─── Emoji Packs API ──────────────────────────────────────────────────

  // GET /api/emoji/packs — list packs with optional category/visibility/status filters
  app.get("/api/emoji/packs", async (req, res) => {
    try {
      const { category, visibility, status } = req.query as Record<string, string | undefined>;
      const packs = await storage.getEmojiPacks({ category, visibility, status });
      res.json(packs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch emoji packs" });
    }
  });

  // GET /api/emoji/packs/:id/assets — list assets for a specific pack
  app.get("/api/emoji/packs/:id/assets", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid pack id" });
      const pack = await storage.getEmojiPack(id);
      if (!pack) return res.status(404).json({ error: "Emoji pack not found" });
      const assets = await storage.getEmojiAssets(id);
      res.json(assets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch emoji assets" });
    }
  });

  // POST /api/emoji/packs — create a new pack
  app.post("/api/emoji/packs", async (req, res) => {
    try {
      const packData = insertEmojiPackSchema.parse(req.body);
      const pack = await storage.createEmojiPack(packData);
      res.status(201).json(pack);
    } catch (error) {
      res.status(400).json({ error: "Invalid emoji pack data" });
    }
  });

  // POST /api/emoji/packs/:id/assets — add an asset to a pack
  app.post("/api/emoji/packs/:id/assets", async (req, res) => {
    try {
      const packId = parseInt(req.params.id, 10);
      if (isNaN(packId)) return res.status(400).json({ error: "Invalid pack id" });
      const pack = await storage.getEmojiPack(packId);
      if (!pack) return res.status(404).json({ error: "Emoji pack not found" });
      const assetData = insertEmojiAssetSchema.parse({ ...req.body, packId });
      const asset = await storage.createEmojiAsset(assetData);
      res.status(201).json(asset);
    } catch (error) {
      res.status(400).json({ error: "Invalid emoji asset data" });
    }
  });

  // ─── Emoji Fonts API ──────────────────────────────────────────────────

  // GET /api/emoji/fonts — list fonts with optional visibility/status filters
  app.get("/api/emoji/fonts", async (req, res) => {
    try {
      const { visibility, status } = req.query as Record<string, string | undefined>;
      const fonts = await storage.getEmojiFonts({ visibility, status });
      res.json(fonts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch emoji fonts" });
    }
  });

  // GET /api/emoji/fonts/:id/glyphs — list glyphs for a specific font
  app.get("/api/emoji/fonts/:id/glyphs", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid font id" });
      const font = await storage.getEmojiFont(id);
      if (!font) return res.status(404).json({ error: "Emoji font not found" });
      const glyphs = await storage.getEmojiFontGlyphs(id);
      res.json(glyphs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch emoji font glyphs" });
    }
  });

  // POST /api/emoji/fonts — create a new font
  app.post("/api/emoji/fonts", async (req, res) => {
    try {
      const fontData = insertEmojiFontSchema.parse(req.body);
      const font = await storage.createEmojiFont(fontData);
      res.status(201).json(font);
    } catch (error) {
      res.status(400).json({ error: "Invalid emoji font data" });
    }
  });

  // POST /api/emoji/fonts/:id/glyphs — add a glyph to a font
  app.post("/api/emoji/fonts/:id/glyphs", async (req, res) => {
    try {
      const fontId = parseInt(req.params.id, 10);
      if (isNaN(fontId)) return res.status(400).json({ error: "Invalid font id" });
      const font = await storage.getEmojiFont(fontId);
      if (!font) return res.status(404).json({ error: "Emoji font not found" });
      const glyphData = insertEmojiFontGlyphSchema.parse({ ...req.body, fontId });
      const glyph = await storage.createEmojiFontGlyph(glyphData);
      res.status(201).json(glyph);
    } catch (error) {
      res.status(400).json({ error: "Invalid emoji font glyph data" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
