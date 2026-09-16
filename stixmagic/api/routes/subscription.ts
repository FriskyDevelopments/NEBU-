import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { getUserByTelegramId, updateUserPlan } from "../../services/userService.js";
import {
  activateUserSubscription,
  cancelSubscriptionByProviderId,
} from "../../services/subscriptionService.js";
import {
  createCheckoutSession,
  constructWebhookEvent,
} from "../../utils/stripe.js";
import { verifyStarsCharge } from "../../utils/telegram.js";
import Stripe from "stripe";

const prisma = new PrismaClient();

const router = Router();

/**
 * Middleware that requires the X-Bot-Secret header to match
 * BOT_API_SHARED_SECRET. Only the bot (bot/bot.ts) knows this secret —
 * Stripe webhooks are authenticated separately via stripe-signature.
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
 * POST /api/subscription/create-checkout
 * Creates a Stripe Checkout Session and returns the URL.
 */
router.post("/create-checkout", requireBotSecret, async (req: Request, res: Response) => {
  const { telegram_id, plan } = req.body as {
    telegram_id?: number;
    plan?: string;
  };

  if (!telegram_id || !plan) {
    res.status(400).json({ error: "telegram_id and plan are required" });
    return;
  }

  const allowedPlans = ["premium", "pro"];
  if (!allowedPlans.includes(plan.toLowerCase())) {
    res.status(400).json({ error: `Plan must be one of: ${allowedPlans.join(", ")}` });
    return;
  }

  try {
    const url = await createCheckoutSession(telegram_id, plan);
    res.json({ url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

/**
 * POST /api/subscription/stars-payment
 * Records a successful Telegram Stars payment sent from the bot.
 *
 * Body: { telegram_id, plan, telegram_payment_charge_id }
 */
router.post("/stars-payment", requireBotSecret, async (req: Request, res: Response) => {
  const { telegram_id, plan, telegram_payment_charge_id } = req.body as {
    telegram_id?: number;
    plan?: string;
    telegram_payment_charge_id?: string;
  };

  if (!telegram_id || !plan || !telegram_payment_charge_id) {
    res.status(400).json({
      error: "telegram_id, plan, and telegram_payment_charge_id are required",
    });
    return;
  }

  const allowedPlans = ["premium", "pro"];
  if (!allowedPlans.includes(plan.toLowerCase())) {
    res.status(400).json({ error: `Plan must be one of: ${allowedPlans.join(", ")}` });
    return;
  }

  try {
    // Verify the charge server-side against Telegram when possible
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const verification = await verifyStarsCharge(
          telegram_payment_charge_id,
          telegram_id
        );
        if (verification.found && !verification.matchesUser) {
          console.error(
            `Suspicious Stars payment: charge ${telegram_payment_charge_id} belongs to a different Telegram user than ${telegram_id}`
          );
          res.status(400).json({ error: "Payment verification failed" });
          return;
        }
        if (!verification.found) {
          console.warn(
            `Stars charge ${telegram_payment_charge_id} not found in recent Telegram transactions for user ${telegram_id}`
          );
        }
      } catch (verificationError) {
        console.error("Error verifying Stars charge:", verificationError);
      }
    }

    const user = await getUserByTelegramId(telegram_id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Grant 30 days of access from now
    const renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await activateUserSubscription(
      telegram_id,
      user.id,
      plan,
      telegram_payment_charge_id,
      renewalDate,
      "telegram_stars"
    );

    res.json({
      success: true,
      plan,
      renewal_date: renewalDate.toISOString(),
    });
  } catch (error) {
    console.error("Error recording Stars payment:", error);
    res.status(500).json({ error: "Failed to record Stars payment" });
  }
});

/**
 * POST /api/subscription/webhook
 * Handles Stripe webhook events.
 * Requires raw body — set up in server.ts before JSON middleware.
 */
router.post(
  "/webhook",
  async (req: Request & { rawBody?: Buffer }, res: Response) => {
    const signature = req.headers["stripe-signature"] as string;

    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      event = constructWebhookEvent(req.rawBody as Buffer, signature);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      res.status(400).json({ error: "Webhook signature verification failed" });
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const telegramId = Number(session.metadata?.telegram_id);
          const plan = session.metadata?.plan ?? "premium";
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : (session.subscription?.id ?? "");

          if (telegramId) {
            const user = await getUserByTelegramId(telegramId);
            if (user) {
              const renewalDate = session.expires_at
                ? new Date(session.expires_at * 1000)
                : undefined;
              await activateUserSubscription(
                telegramId,
                user.id,
                plan,
                subscriptionId,
                renewalDate
              );
            }
          }
          break;
        }

        case "invoice.paid": {
          const invoice = event.data.object as Stripe.Invoice;
          const subscriptionId =
            typeof invoice.subscription === "string"
              ? invoice.subscription
              : (invoice.subscription?.id ?? "");

          if (subscriptionId) {
            // Ensure subscription stays active on renewal
            await prisma.subscription.updateMany({
              where: { provider_subscription_id: subscriptionId },
              data: { status: "active" },
            });
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          await cancelSubscriptionByProviderId(subscription.id);

          // Find user via subscription record and reset their plan
          const sub = await prisma.subscription.findFirst({
            where: { provider_subscription_id: subscription.id },
            include: { user: true },
          });
          if (sub) {
            await updateUserPlan(
              Number(sub.user.telegram_id),
              "free",
              "inactive"
            );
          }
          break;
        }

        default:
          // Unhandled event type — acknowledge receipt
          break;
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Error processing webhook event:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

export default router;
