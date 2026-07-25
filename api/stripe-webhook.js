import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Service role key bypasses RLS — required here because the webhook has
// no logged-in user context, but needs to write subscription status for
// whichever user Stripe tells us just paid, renewed, or canceled.
const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Stripe needs the raw request body to verify the webhook signature —
// Vercel's default JSON body parsing would break that verification.
export const config = {
  api: { bodyParser: false },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function upsertSubscription({ userId, customerId, subscriptionId, status, plan, currentPeriodEnd }) {
  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      status,
      plan,
      current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;
        if (userId) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await upsertSubscription({
            userId,
            customerId: session.customer,
            subscriptionId: session.subscription,
            status: subscription.status,
            plan,
            currentPeriodEnd: subscription.current_period_end,
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (userId) {
          await upsertSubscription({
            userId,
            customerId: subscription.customer,
            subscriptionId: subscription.id,
            status: subscription.status,
            plan: subscription.metadata?.plan,
            currentPeriodEnd: subscription.current_period_end,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (userId) {
          await upsertSubscription({
            userId,
            customerId: subscription.customer,
            subscriptionId: subscription.id,
            status: "canceled",
            plan: subscription.metadata?.plan,
            currentPeriodEnd: subscription.current_period_end,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          const userId = subscription.metadata?.userId;
          if (userId) {
            await upsertSubscription({
              userId,
              customerId: subscription.customer,
              subscriptionId: subscription.id,
              status: "past_due",
              plan: subscription.metadata?.plan,
              currentPeriodEnd: subscription.current_period_end,
            });
          }
        }
        break;
      }

      default:
        // Other event types are fine to ignore — we only act on the ones above.
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err.message);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}