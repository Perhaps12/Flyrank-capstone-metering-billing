import type { Stripe } from "../services/stripe";
import {
  hasProcessedEvent,
  markEventProcessed,
} from "../database/queries/webhookEvents";
import {
  findTenantIdByStripeCustomerId,
  updateTenantPlan,
  getPlanByName,
} from "../database/queries/subscriptions";

export type WebhookResult =
  | { status: "ignored_duplicate" }
  | { status: "ignored_unhandled" }
  | { status: "processed"; tenantId: number; newPlan: string };

// Maps a Stripe subscription status to the plan tier we apply locally.
// past_due keeps Pro access (Stripe is still retrying the card) —
// adjust here if you'd rather downgrade immediately on payment failure.
const PLAN_FOR_SUBSCRIPTION_STATUS: Record<string, string> = {
  active: "pro",
  trialing: "pro",
  past_due: "pro",
  canceled: "free",
  unpaid: "free",
  incomplete_expired: "free",
};

type ResolvedTarget = {
  tenantId: number;
  planName: string;
  status: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
};

export async function handleWebhookEvent(
  event: Stripe.Event
): Promise<WebhookResult> {
  // Fast path: the common case is a retry of an event we already fully
  // applied. No further DB writes happen on this path.
  if (await hasProcessedEvent(event.id)) {
    return { status: "ignored_duplicate" };
  }

  const target = await resolveTarget(event);

  if (!target) {
    // Unhandled event type (e.g. invoice.payment_succeeded), or one we
    // couldn't resolve a tenant for. Mark it processed anyway so a
    // retry of THIS event doesn't redo the resolution work forever.
    await markEventProcessed(event.id);
    return { status: "ignored_unhandled" };
  }

  const plan = await getPlanByName(target.planName);

  if (!plan) {
    // Config problem (plan not seeded) — don't mark processed, so
    // Stripe retries once it's fixed rather than a real plan change
    // getting silently dropped forever.
    throw new Error(`No plan found with name "${target.planName}"`);
  }

  await updateTenantPlan({
    tenantId: target.tenantId,
    planId: plan.id,
    status: target.status,
    stripeCustomerId: target.stripeCustomerId,
    stripeSubscriptionId: target.stripeSubscriptionId,
  });

  // Recorded only after the update succeeds. UNIQUE(stripe_event_id) on
  // processed_webhook_events is the backstop for a true concurrent race
  // here — and since updateTenantPlan is a plain SET (not additive like
  // usage_events), two racing writes from the same event land on the
  // same end state anyway, so no special transaction is needed.
  await markEventProcessed(event.id);

  return {
    status: "processed",
    tenantId: target.tenantId,
    newPlan: target.planName,
  };
}

async function resolveTarget(
  event: Stripe.Event
): Promise<ResolvedTarget | null> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = Number(session.client_reference_id);

      if (!session.client_reference_id || Number.isNaN(tenantId)) {
        return null;
      }

      return {
        tenantId,
        planName: "pro",
        status: "active",
        stripeCustomerId: asId(session.customer),
        stripeSubscriptionId: asId(session.subscription),
      };
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = asId(subscription.customer);

      if (!customerId) {
        return null;
      }

      const tenantId = await findTenantIdByStripeCustomerId(customerId);

      if (!tenantId) {
        return null;
      }

      const status =
        event.type === "customer.subscription.deleted"
          ? "canceled"
          : subscription.status;

      return {
        tenantId,
        planName: PLAN_FOR_SUBSCRIPTION_STATUS[status] ?? "free",
        status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
      };
    }

    default:
      return null;
  }
}

// Stripe's typed fields (customer, subscription) can be either an id
// string or an expanded object, depending on the API version / whether
// you requested expansion. Normalize to just the id.
function asId(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}