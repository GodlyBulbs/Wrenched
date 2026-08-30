// /api/stripe-webhook.js
//
// Handles Stripe events for the one-time $9.99 lifetime purchase. This is
// simpler than a subscription webhook needed to be — there's no renewal,
// no cancellation, no "past due" to track. The only event that matters is
// "checkout.session.completed" for a payment-mode session: the moment that
// fires, the purchase is done and access should be permanent.
//
// Writes into the same `subscriptions` table RevenueCat's webhook also
// writes to (keyed by user_id) — `status: "active"` here means the same
// thing regardless of whether it came from Stripe or RevenueCat.
//
// SETUP REQUIRED:
// 1. In the Stripe Dashboard: Developers → Webhooks → Add endpoint
//    URL: https://wrenched.shop/api/stripe-webhook
//    Event to send: checkout.session.completed
// 2. Copy the generated "Signing secret" (starts with whsec_) and add it
//    to Vercel as: STRIPE_WEBHOOK_SECRET
// 3. This also needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, same as
//    the RevenueCat webhook — should already be set from that setup.
//
// Vercel-specific note: Stripe webhook signature verification needs the
// RAW request body, not Vercel's default auto-parsed JSON — the config
// export below disables Vercel's body parsing so the raw buffer is
// available for Stripe's signature check.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { buffer } from "micro";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sig = req.headers["stripe-signature"];
  const rawBody = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    // Only act on payment-mode sessions (the lifetime purchase) — if this
    // endpoint ever needs to handle other checkout types later, this guard
    // keeps them from being mistakenly treated as a lifetime unlock.
    if (session.mode !== "payment") {
      return res.status(200).json({ received: true, skipped: true });
    }

    const userId = session.client_reference_id || session.metadata?.userId;
    if (!userId) {
      console.error("stripe-webhook: checkout session had no userId reference");
      return res.status(200).json({ received: true, skipped: true });
    }

    try {
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .upsert(
          {
            user_id: userId,
            status: "active",
            stripe_customer_id: session.customer || null,
            current_period_end: null, // lifetime — no expiry
            updated_at: new Date().toISOString(),
            billing_source: "stripe",
          },
          { onConflict: "user_id" }
        );
      if (error) throw error;
    } catch (err) {
      console.error("stripe-webhook: failed to update subscription:", err);
      return res.status(500).json({ error: "Failed to update subscription" });
    }
  }

  return res.status(200).json({ received: true });
}
