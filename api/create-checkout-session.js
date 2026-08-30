// /api/create-checkout-session.js
//
// Creates a Stripe Checkout session for the one-time $9.99 "Lifetime Access"
// purchase — replaces the old monthly/yearly SUBSCRIPTION checkout with a
// single ONE-TIME PAYMENT. The key difference from a subscription checkout
// is `mode: "payment"` instead of `mode: "subscription"`, and using a
// one-time Stripe Price (not a recurring one) — Stripe treats these as
// genuinely different objects, so a new Price needs to be created in the
// Stripe dashboard (Products → your product → Add another price → set
// "Recurring" to OFF).
//
// SETUP REQUIRED:
// Add your new one-time Price's ID (starts with `price_`) to Vercel as:
// STRIPE_LIFETIME_PRICE_ID
// (Keep your existing STRIPE_SECRET_KEY env var — unchanged.)

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
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
          price: process.env.STRIPE_LIFETIME_PRICE_ID,
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
