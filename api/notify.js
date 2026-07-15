export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, car, location, details, timeframe } = req.body;

  if (!name || !email || !car || !details) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "ModGuide On-Site <onboarding@resend.dev>",
        to: process.env.OWNER_EMAIL,
        subject: `New On-Site Request — ${car}`,
        html: `
          <h2>New service request</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Car:</strong> ${car}</p>
          <p><strong>Location:</strong> ${location || "Not provided"}</p>
          <p><strong>Timeframe:</strong> ${timeframe || "Not provided"}</p>
          <p><strong>What's going on:</strong></p>
          <p>${details}</p>
        `,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}