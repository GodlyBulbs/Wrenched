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

async function upsertSubscription({ userId, customerId, subscriptionId, status, plan, currentPeriodEnd }) {
  const { data, error } = await supabaseAdmin.from("subscriptions").upsert(
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
  if (error) {
    console.error("SUPABASE WRITE FAILED:", JSON.stringify(error));
    throw new Error("Supabase write failed: " + error.message);
  }
  console.log("Subscription upserted successfully for user:", userId);
  return data;
}

// Vercel's Web API-style handler — request.text() gives the true raw body,
// which is what Stripe's signature check requires. This avoids the
// Next.js-only "config.api.bodyParser" convention, which Vercel's native
// runtime doesn't actually recognize.
export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  // TEMPORARY DIAGNOSTIC — remove once the signature issue is confirmed fixed.
  // Shows just enough of the secret to compare against Stripe's dashboard
  // without ever exposing the full value in logs.
  const secretInUse = process.env.STRIPE_WEBHOOK_SECRET;
  console.log("DIAGNOSTIC — webhook secret seen by this function:", 
    secretInUse ? `${secretInUse.slice(0,12)}... (length ${secretInUse.length})` : "MISSING / UNDEFINED"
  );

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;
        console.log("checkout.session.completed received. userId:", userId, "plan:", plan, "session.metadata:", JSON.stringify(session.metadata));
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
        } else {
          console.error("NO userId found in session metadata — skipping write. Full session metadata was:", JSON.stringify(session.metadata));
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

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error("Webhook handler error:", err.message);
    return new Response(JSON.stringify({ error: "Webhook handler failed" }), { status: 500 });
  }
}