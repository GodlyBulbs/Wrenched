import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Service role key needed here too — we're checking subscription history
// for a user who may not have an active session token on this request.
const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY,
  yearly: process.env.STRIPE_PRICE_YEARLY,
};

// Change this to whatever trial length you want. Set to 0 to disable trials entirely.
const TRIAL_DAYS = 7;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { plan, userId, userEmail } = req.body || {};

  if (!plan || !PRICES[plan] || !userId || !userEmail) {
    return res.status(400).json({ error: "Missing or invalid fields" });
  }

  try {
    // Only first-time subscribers get a trial — anyone who already has a
    // subscriptions row (active, canceled, past_due, whatever) has already
    // had their shot, so we skip straight to a normal paid checkout for them.
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    const isFirstTimeSubscriber = !existing;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: userEmail,
      line_items: [{ price: PRICES[plan], quantity: 1 }],
      // This is what lets the webhook know WHICH user just paid —
      // Stripe hands this metadata back to us on every event.
      metadata: { userId, plan },
      subscription_data: {
        metadata: { userId, plan },
        ...(isFirstTimeSubscriber && TRIAL_DAYS > 0
          ? { trial_period_days: TRIAL_DAYS }
          : {}),
      },
      success_url: `${req.headers.origin}/?subscribed=true`,
      cancel_url: `${req.headers.origin}/subscribe?canceled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return res.status(500).json({ error: "Could not start checkout" });
  }
}