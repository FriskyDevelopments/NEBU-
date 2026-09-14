import axios from "axios";

/**
 * Represents the shape of a user as returned by the database.
 */
export interface UserLike {
  plan: string;
  subscription_status: string;
}

type Feature =
  | "basic_stickers"
  | "advanced_stickers"
  | "custom_stickers"
  | "ai_generation"
  | "unlimited_packs";

const PLAN_FEATURES: Record<string, Feature[]> = {
  free: ["basic_stickers"],
  premium: ["basic_stickers", "advanced_stickers", "custom_stickers"],
  pro: [
    "basic_stickers",
    "advanced_stickers",
    "custom_stickers",
    "ai_generation",
    "unlimited_packs",
  ],
};

/**
 * Returns true if the user's current plan grants access to the given feature.
 *
 * free     → limited features (basic_stickers only)
 * premium  → advanced features
 * pro      → all features unlocked
 */
export function canUseFeature(user: UserLike, feature: Feature): boolean {
  const allowedFeatures = PLAN_FEATURES[user.plan.toLowerCase()] ?? [];
  return allowedFeatures.includes(feature);
}

/**
 * Returns the display name for a plan.
 */
export function getPlanDisplayName(plan: string): string {
  const names: Record<string, string> = {
    free: "Free",
    premium: "Premium",
    pro: "Pro",
  };
  return names[plan.toLowerCase()] ?? plan;
}

interface StarTransactionSource {
  user?: { id: number };
}

interface StarTransaction {
  id: string;
  source?: StarTransactionSource;
}

const TELEGRAM_API_BASE = "https://api.telegram.org";
const STAR_TRANSACTIONS_PAGE_SIZE = 100;
const STAR_TRANSACTIONS_MAX_PAGES = 5;

/**
 * Verifies a Telegram Stars charge server-side by scanning recent
 * transactions via the Bot API (getStarTransactions).
 *
 * Returns whether the charge was found among the recent transactions and,
 * if found, whether it was paid by the expected Telegram user. Requires
 * TELEGRAM_BOT_TOKEN; without it the charge cannot be confirmed and
 * `found` is false.
 */
export async function verifyStarsCharge(
  chargeId: string,
  telegramId: number
): Promise<{ found: boolean; matchesUser: boolean }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { found: false, matchesUser: false };
  }

  let offset = 0;
  for (let page = 0; page < STAR_TRANSACTIONS_MAX_PAGES; page++) {
    const response = await axios.get<{
      ok: boolean;
      result?: { transactions?: StarTransaction[] };
    }>(`${TELEGRAM_API_BASE}/bot${token}/getStarTransactions`, {
      params: { offset, limit: STAR_TRANSACTIONS_PAGE_SIZE },
    });

    const transactions = response.data.result?.transactions ?? [];
    const match = transactions.find((tx) => tx.id === chargeId);
    if (match) {
      return { found: true, matchesUser: match.source?.user?.id === telegramId };
    }

    if (transactions.length < STAR_TRANSACTIONS_PAGE_SIZE) {
      break;
    }
    offset += transactions.length;
  }

  return { found: false, matchesUser: false };
}
