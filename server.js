
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = `
You are Lumora AI, created by John Theuri.

Rules:
- Answer the user's actual question.
- Never repeat your introduction unless asked.
- Remember recent conversation messages supplied to you.
- Be helpful, accurate, friendly and fast.
- Respond in the user's language where possible.
- Never invent facts or pretend you searched the web.
- Use supplied search results and cite their links.
- If information is uncertain, explain what is missing.
`;

async function askAI(messages) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Add GROQ_API_KEY in your hosting environment.");
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model:
          process.env.GROQ_MODEL ||
          "llama-3.3-70b-versatile",
        messages,
        temperature: 0.5,
        max_tokens: 900
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("AI provider error:", data.error);
    throw new Error("The AI service could not answer.");
  }

  return data.choices?.[0]?.message?.content ||
    "Sorry, please try asking again.";
}

async function searchGoogle(query) {
  const key = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;

  if (!key || !cx) return [];

  const url = new URL(
    "https://www.googleapis.com/customsearch/v1"
  );

  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "5");

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    console.error("Google Search error:", data.error);
    return [];
  }

  return (data.items || []).map(item => ({
    title: item.title,
    link: item.link,
    snippet: item.snippet
  }));
}

function shouldSearch(message) {
  return /\b(where is|latest|current|today|news|price of|cost of|weather|who is|when is|school|hospital|near me|search the web|look up)\b/i.test(
    message
  );
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Lumora AI",
    googleSearch: Boolean(
      process.env.GOOGLE_API_KEY &&
      process.env.GOOGLE_CSE_ID
    ),
    imageGeneration: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    if (message.length > 6000) {
      return res.status(400).json({
        error: "Your message is too long."
      });
    }

    let sources = [];
    let prompt = message;

    if (shouldSearch(message)) {
      sources = await searchGoogle(message);

      if (sources.length) {
        prompt +=
          "\n\nGoogle search results. Use these to answer accurately:\n" +
          sources.map((s, i) =>
            `${i + 1}. ${s.title}\n${s.snippet}\n${s.link}`
          ).join("\n\n");
      } else {
        prompt +=
          "\n\nLive search results are unavailable. " +
          "Do not claim that you searched the web.";
      }
    }

    const history = Array.isArray(req.body?.history)
      ? req.body.history
      : [];

    const safeHistory = history
      .filter(item =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string"
      )
      .slice(-10)
      .map(item => ({
        role: item.role,
        content: item.content.slice(0, 3000)
      }));

    const reply = await askAI([
      { role: "system", content: SYSTEM_PROMPT },
      ...safeHistory,
      { role: "user", content: prompt }
    ]);

    res.json({ reply, sources });
  } catch (error) {
    console.error("Lumora error:", error.message);

    res.status(500).json({
      error: error.message ||
        "Lumora is temporarily unavailable. Try again."
    });
  }
});

// Generate images using an image-generation API.
app.post("/api/image", async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const prompt = String(req.body?.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        error: "Describe the image you want."
      });
    }

    if (!apiKey) {
      return res.status(503).json({
        error: "Image generation is not configured. Add OPENAI_API_KEY."
      });
    }

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
          prompt,
          size: "1024x1024",
          quality: "high"
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Image API error:", data.error);
      return res.status(502).json({
        error: "Image generation failed. Check API access and billing."
      });
    }

    const image = data.data?.[0]?.b64_json;

    if (!image) {
      return res.status(502).json({
        error: "The image service returned no image."
      });
    }

    res.json({ image: `data:image/png;base64,${image}` });
  } catch (error) {
    console.error("Image error:", error.message);
    res.status(500).json({
      error: "Unable to generate the image right now."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Lumora AI running on port ${PORT}`);
});
