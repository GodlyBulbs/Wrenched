// /api/create-checkout-session.js
//
// Creates a Stripe Checkout session for the one-time $4.99 "Remove Ads"
// purchase on the website (the iOS/Android apps use RevenueCat instead).
// It's a ONE-TIME payment (`mode: "payment"`), not a subscription, so it
// needs a one-time Stripe Price (Products → Add price → Recurring OFF).
//
// SETUP REQUIRED (Vercel env vars):
//   STRIPE_REMOVE_ADS_PRICE_ID — the new $4.99 one-time Price (price_...)
//   STRIPE_SECRET_KEY          — unchanged
// Falls back to the old STRIPE_LIFETIME_PRICE_ID if the new one isn't set.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId, userEmail } = req.body || {};
  if (!userId || !userEmail) {
    return res.status(400).json({ error: "Missing userId or userEmail" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment", // one-time charge, not "subscription"
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_REMOVE_ADS_PRICE_ID || process.env.STRIPE_LIFETIME_PRICE_ID,
          quantity: 1,
        },
      ],
      customer_email: userEmail,
      client_reference_id: userId,
      metadata: { userId },
      success_url: `${process.env.SITE_URL || "https://wrenched.shop"}/?checkout=success`,
      cancel_url: `${process.env.SITE_URL || "https://wrenched.shop"}/?checkout=cancelled`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Could not start checkout." });
  }
}
