import { PrismaClient } from "@prisma/client";
import { updateUserPlan } from "./userService.js";

const prisma = new PrismaClient();

export interface CreateSubscriptionInput {
  user_id: number;
  plan: string;
  provider?: string;
  provider_subscription_id?: string;
  renewal_date?: Date;
}

/**
 * Creates a new subscription record for a user.
 */
export async function createSubscription(input: CreateSubscriptionInput) {
  const {
    user_id,
    plan,
    provider = "stripe",
    provider_subscription_id,
    renewal_date,
  } = input;

  return prisma.subscription.create({
    data: {
      user_id,
      plan,
      provider,
      provider_subscription_id: provider_subscription_id ?? null,
      status: "active",
      renewal_date: renewal_date ?? null,
    },
  });
}

/**
 * Cancels a subscription by its Stripe subscription ID.
 */
export async function cancelSubscriptionByProviderId(
  provider_subscription_id: string
) {
  return prisma.subscription.updateMany({
    where: { provider_subscription_id },
    data: { status: "cancelled" },
  });
}

/**
 * Marks a subscription as past_due by its Stripe subscription ID.
 */
export async function markSubscriptionPastDue(
  provider_subscription_id: string
) {
  return prisma.subscription.updateMany({
    where: { provider_subscription_id },
    data: { status: "past_due" },
  });
}

/**
 * Activates a user's subscription: updates the subscription record and the
 * user's plan/status in one go.
 *
 * Idempotent: if a subscription with the same provider_subscription_id
 * already exists, the duplicate activation is skipped and the existing
 * record is returned.
 */
export async function activateUserSubscription(
  telegram_id: number,
  user_id: number,
  plan: string,
  provider_subscription_id: string,
  renewal_date?: Date,
  provider?: string
) {
  const existing = await prisma.subscription.findFirst({
    where: { provider_subscription_id },
  });
  if (existing) {
    console.warn(
      `Subscription with provider_subscription_id ${provider_subscription_id} already exists — skipping duplicate activation`
    );
    return existing;
  }

  await createSubscription({
    user_id,
    plan,
    provider,
    provider_subscription_id,
    renewal_date,
  });

  return updateUserPlan(telegram_id, plan, "active");
}
