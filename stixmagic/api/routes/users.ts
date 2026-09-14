import { Router, Request, Response, NextFunction } from "express";
import { createOrGetUser, getUserByTelegramId } from "../../services/userService.js";

const router = Router();

/**
 * Middleware that requires the X-Bot-Secret header to match
 * BOT_API_SHARED_SECRET. Only the bot (bot/bot.ts) knows this secret.
 */
function requireBotSecret(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.BOT_API_SHARED_SECRET;
  if (!secret) {
    console.error("BOT_API_SHARED_SECRET is not configured");
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }

  if (req.headers["x-bot-secret"] !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

/**
 * POST /api/users/create-or-get
 * Creates a new user or returns the existing one.
 */
router.post("/create-or-get", requireBotSecret, async (req: Request, res: Response) => {
  const { telegram_id, telegram_username } = req.body as {
    telegram_id?: number;
    telegram_username?: string;
  };

  if (!telegram_id) {
    res.status(400).json({ error: "telegram_id is required" });
    return;
  }

  try {
    const user = await createOrGetUser({ telegram_id, telegram_username });
    // Serialize BigInt fields so JSON.stringify doesn't throw
    res.json({ ...user, telegram_id: user.telegram_id.toString() });
  } catch (error) {
    console.error("Error in create-or-get user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/users/:telegram_id
 * Returns plan and subscription_status for the given user.
 */
router.get("/:telegram_id", requireBotSecret, async (req: Request, res: Response) => {
  const telegramId = Number(req.params.telegram_id);

  if (isNaN(telegramId)) {
    res.status(400).json({ error: "Invalid telegram_id" });
    return;
  }

  try {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      telegram_id: user.telegram_id.toString(),
      plan: user.plan,
      subscription_status: user.subscription_status,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
