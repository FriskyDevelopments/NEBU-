import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import axios from "axios";
import { getPlanDisplayName } from "../utils/telegram.js";
import { getStarPrice } from "../utils/stars.js";

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

const API_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

// Shared secret the API requires on /api/users/* and /api/subscription/* routes
const BOT_SECRET = process.env.BOT_API_SHARED_SECRET;
if (!BOT_SECRET) {
  console.warn(
    "BOT_API_SHARED_SECRET is not set — API calls to /api/users/* and /api/subscription/* will be rejected"
  );
}
const botSecretHeaders = { "X-Bot-Secret": BOT_SECRET ?? "" };

// ─── /start ──────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id;
  const telegramUsername = ctx.from?.username;

  if (!telegramId) {
    await ctx.reply("Could not identify your Telegram account. Please try again.");
    return;
  }

  try {
    const response = await axios.post(
      `${API_BASE_URL}/api/users/create-or-get`,
      {
        telegram_id: telegramId,
        telegram_username: telegramUsername,
      },
      { headers: botSecretHeaders }
    );

    const user = response.data as { plan: string; subscription_status: string };
    const planName = getPlanDisplayName(user.plan);

    await ctx.reply(
      `🪄 *Welcome to STIX MAGIC*\n\nYour account has been created.\n\nCurrent plan: *${planName}*\n\nUse /plans to upgrade.`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error in /start command:", error);
    await ctx.reply("There was an error setting up your account. Please try again.");
  }
});

// ─── /plans ───────────────────────────────────────────────────────────────────

bot.command("plans", async (ctx) => {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    await ctx.reply("Could not identify your Telegram account.");
    return;
  }

  const premiumStars = getStarPrice("premium");
  const proStars = getStarPrice("pro");

  const keyboard = new InlineKeyboard()
    // Stripe subscription buttons (recurring)
    .url("💳 Premium (Card)", await getCheckoutUrl(telegramId, "premium"))
    .row()
    .url("💳 Pro (Card)", await getCheckoutUrl(telegramId, "pro"))
    .row()
    // Telegram Stars buttons (one-time, 30-day access)
    .text(`⭐ Premium — ${premiumStars} Stars`, "stars:premium")
    .row()
    .text(`⭐ Pro — ${proStars} Stars`, "stars:pro");

  await ctx.reply(
    `*STIX MAGIC PLANS*\n\n` +
      `🆓 *Free*\nBasic access\n\n` +
      `⭐ *Premium*\nAdvanced sticker magic\n\n` +
      `🚀 *Pro*\nAll features unlocked\n\n` +
      `_Pay by card (recurring) or with Telegram Stars (30-day access)._`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    }
  );
});

// ─── Telegram Stars: send invoice ────────────────────────────────────────────

bot.callbackQuery(/^stars:(premium|pro)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const plan = ctx.match[1] as "premium" | "pro";
  const telegramId = ctx.from.id;
  const planName = getPlanDisplayName(plan);
  const starPrice = getStarPrice(plan);

  await ctx.replyWithInvoice(
    `STIX MAGIC ${planName}`,
    `30 days of ${planName} plan — unlock ${plan === "pro" ? "all features" : "advanced sticker magic"}.`,
    // payload carries plan + user identity for fulfillment
    JSON.stringify({ plan, telegram_id: telegramId }),
    "XTR", // Telegram Stars currency
    [{ label: `${planName} (30 days)`, amount: starPrice }]
  );
});

// ─── Telegram Stars: approve pre-checkout ────────────────────────────────────

bot.on("pre_checkout_query", async (ctx) => {
  // Validate the payload before approving
  try {
    const payload = JSON.parse(ctx.preCheckoutQuery.invoice_payload) as {
      plan?: string;
      telegram_id?: number;
    };
    const allowedPlans = ["premium", "pro"];
    if (!payload.plan || !allowedPlans.includes(payload.plan)) {
      await ctx.answerPreCheckoutQuery(false, "Invalid plan selected.");
      return;
    }
  } catch {
    await ctx.answerPreCheckoutQuery(false, "Invalid payment payload.");
    return;
  }

  await ctx.answerPreCheckoutQuery(true);
});

// ─── Telegram Stars: fulfill payment ─────────────────────────────────────────

const SUPPORT_MESSAGE =
  "Payment received, but we could not activate your plan. Please contact support.";

bot.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const chargeId = payment.telegram_payment_charge_id;

  let payload: { plan?: string; telegram_id?: number };
  try {
    payload = JSON.parse(payment.invoice_payload) as {
      plan?: string;
      telegram_id?: number;
    };
  } catch (error) {
    console.error("Could not parse Stars payment payload:", payment.invoice_payload, error);
    await ctx.reply(SUPPORT_MESSAGE);
    return;
  }

  const { plan, telegram_id: telegramId } = payload;

  if (!plan || !telegramId) {
    await ctx.reply(SUPPORT_MESSAGE);
    return;
  }

  try {
    await axios.post(
      `${API_BASE_URL}/api/subscription/stars-payment`,
      {
        telegram_id: telegramId,
        plan,
        telegram_payment_charge_id: chargeId,
      },
      { headers: botSecretHeaders }
    );

    const planName = getPlanDisplayName(plan);
    await ctx.reply(
      `✅ *Payment successful!*\n\nYour plan has been upgraded to *${planName}* for 30 days.\n\nEnjoy STIX MAGIC! 🪄`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error activating Stars subscription:", error);
    await ctx.reply(
      `${SUPPORT_MESSAGE} Payment ID: ${chargeId}`
    );
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getCheckoutUrl(telegramId: number, plan: string): Promise<string> {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/api/subscription/create-checkout`,
      { telegram_id: telegramId, plan },
      { headers: botSecretHeaders }
    );
    return (response.data as { url: string }).url;
  } catch (error) {
    console.error(`Error fetching checkout URL for plan ${plan}:`, error);
    // Fall back to the base URL so the keyboard button is still valid
    return `${API_BASE_URL}/plans`;
  }
}

// ─── Start the bot ────────────────────────────────────────────────────────────

bot.start();
console.log("🪄 Stix Magic bot is running…");
