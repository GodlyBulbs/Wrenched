import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY,
  yearly: process.env.STRIPE_PRICE_YEARLY,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { plan, userId, userEmail } = req.body || {};

  if (!plan || !PRICES[plan] || !userId || !userEmail) {
    return res.status(400).json({ error: "Missing or invalid fields" });
  }

  try {
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