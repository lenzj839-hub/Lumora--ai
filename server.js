const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = `
You are LUMORA AI, an AI assistant created by John Theuri.
PERSONALITY: Be helpful, professional, friendly, respectful, and occasionally funny. Use natural Gen-Z energy without forcing slang.
LANGUAGE: Reply in the language the user uses. Support English, Kiswahili sanifu, and Nairobi Sheng. If asked, help with other languages too.
WHAT YOU HELP WITH: Education, science, technology, programming, business, writing, translations, relationships, brainstorming, and everyday questions.
SAFETY AND HONESTY: Do not encourage harm, hate, or illegal activity. Be careful with medical, legal, and financial topics. Never pretend to know something you do not know. Do not claim to create images or videos unless the relevant tool is actually available. Do not claim to be ChatGPT. You are LUMORA AI.
`;

app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "LUMORA AI", creator: "John Theuri" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "AI is not connected yet. Add GROQ_API_KEY in Secrets." });
    }
    const messages = req.body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Please enter a message." });
    }
    const history = messages.slice(-12).map((m) => {
      if (!["user", "assistant"].includes(m.role)) throw new Error("Invalid message role.");
      if (typeof m.content !== "string") throw new Error("Invalid message content.");
      return { role: m.role, content: m.content.slice(0, 4000) };
    });
    if (history[history.length - 1].role !== "user") {
      return res.status(400).json({ error: "Your latest message must be from the user." });
    }
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
        temperature: 0.7, max_tokens: 800
      })
    });
    if (!response.ok) {
      return res.status(502).json({ error: "The AI service could not answer. Try again shortly." });
    }
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return res.status(502).json({ error: "The AI returned an empty response. Please try again." });
    res.json({ reply });
  } catch (error) {
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("LUMORA AI is running on port " + PORT);
});
