// /api/sync-subscription.js
//
// Called by the app immediately after a purchase completes, so the paywall
// clears right away instead of waiting on the RevenueCat webhook (which is
// reliable but can lag a few seconds — fine for renewals/cancellations
// happening in the background, not great for "I just paid, unlock now").
//
// Deliberately does NOT trust anything the client sends about whether a
// purchase succeeded — it takes only a userId, then asks RevenueCat's own
// API for that user's actual current entitlement state and writes THAT to
// Supabase. A user tampering with their own browser/app can't fake this,
// since the write is driven by what RevenueCat says server-to-server, not
// by client-supplied purchase data.
//
// SETUP REQUIRED:
// Add your RevenueCat SECRET API key (Project Settings → API Keys → Secret
// API Keys — different from the public iOS/Android keys used in the app)
// to Vercel as: REVENUECAT_SECRET_API_KEY
// Also needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, same as the webhook.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  try {
    const rcRes = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${process.env.REVENUECAT_SECRET_API_KEY}` },
    });
    if (!rcRes.ok) {
      // A 404 here just means RevenueCat has never seen this user (e.g. they
      // haven't opened the paywall yet) — not an error worth surfacing.
      if (rcRes.status === 404) return res.status(200).json({ status: "inactive" });
      throw new Error(`RevenueCat API returned ${rcRes.status}`);
    }
    const rcData = await rcRes.json();
    const entitlements = rcData.subscriber?.entitlements || {};
    const active = Object.values(entitlements).find((e) => new Date(e.expires_date) > new Date());

    const status = active ? (active.period_type === "trial" ? "trialing" : "active") : "inactive";
    const periodEnd = active?.expires_date || null;

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          status,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
          billing_source: "revenuecat",
        },
        { onConflict: "user_id" }
      );
    if (error) throw error;

    return res.status(200).json({ status });
  } catch (err) {
    console.error("sync-subscription error:", err);
    return res.status(500).json({ error: "Failed to sync subscription" });
  }
}
