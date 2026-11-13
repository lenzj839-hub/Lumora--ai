const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = `
You are Axenova AI, created by John Theuri.

Rules:
- Answer the user's actual question.
- Never repeat your introduction unless asked.
- Remember recent conversation messages supplied to you.
- Be helpful, accurate, friendly and fast.
- Respond in the user's language where possible.
- If you are NOT 100% sure about a fact, person, date, or place, you MUST use the web search results given to you. Do not guess.
- Never invent facts or pretend you searched the web.
- Use supplied search results and cite their links.
- If information is uncertain, explain what is missing.
- Your owner/creator is John Theuri from Kenya. If asked about him, say you were created by John Theuri in Kenya, unless the user gives more detail.
`;

let lastSearchError = null;

function getKenyaDateTime() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date()) + " EAT";
}

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

function cleanText(s) {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").trim();
}

function decodeDuckLink(href) {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : href;
  } catch { return href; }
}

// ================= FREE SEARCH 1 - DUCKDUCKGO - NO KEY =================
async function searchDuckDuckGo(query) {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
      "Accept": "text/html"
    }
  });
  if (!res.ok) throw new Error("DuckDuckGo status " + res.status);
  const html = await res.text();
  const results = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,600}?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 5) {
    const link = decodeDuckLink(m[1]);
    if (link.includes("duckduckgo.com")) continue;
    results.push({ title: cleanText(m[2]), link, snippet: cleanText(m[3]) });
  }
  return results;
}

// ================= FREE SEARCH 2 - DUCKDUCKGO INSTANT ANSWER - NO KEY =================
async function searchDuckInstant(query) {
  const url = "https://api.duckduckgo.com/?q=" + encodeURIComponent(query) + "&format=json&no_html=1&skip_disambig=1";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error("Duck Instant status " + res.status);
  const data = await res.json();
  const results = [];
  if (data.AbstractText) {
    results.push({ title: data.Heading || query, link: data.AbstractURL || "https://duckduckgo.com/?q=" + encodeURIComponent(query), snippet: data.AbstractText });
  }
  for (const t of (data.RelatedTopics || []).slice(0, 4)) {
    if (t.Text && t.FirstURL) results.push({ title: cleanText(t.Text).slice(0, 80), link: t.FirstURL, snippet: cleanText(t.Text) });
  }
  return results;
}

// ================= FREE SEARCH 3 - WIKIPEDIA - NO KEY =================
async function searchWikipedia(query) {
  const url = "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" + encodeURIComponent(query) + "&utf8=&format=json&srlimit=5";
  const res = await fetch(url, { headers: { "User-Agent": "AxenovaAI/1.0" } });
  if (!res.ok) throw new Error("Wikipedia status " + res.status);
  const data = await res.json();
  return (data.query?.search || []).map(r => ({
    title: r.title,
    link: "https://en.wikipedia.org/wiki/" + encodeURIComponent(r.title.replace(/ /g, "_")),
    snippet: cleanText(r.snippet)
  }));
}

async function searchBrave(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  const res = await fetch("https://api.search.brave.com/res/v1/web/search?q=" + encodeURIComponent(query) + "&count=5", {
    headers: { "Accept": "application/json", "X-Subscription-Token": key }
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Brave: " + JSON.stringify(data).slice(0, 200));
  return (data.web?.results || []).map(r => ({ title: r.title, link: r.url, snippet: r.description || "" }));
}

// Hii inajaribu zote za FREE moja baada ya nyingine, hadi moja ipe jibu
async function searchWeb(query) {
  try {
    const brave = await searchBrave(query);
    if (brave.length) { lastSearchError = null; return brave; }
  } catch (e) { console.error("Brave error:", e.message); }

  try {
    const ddg = await searchDuckDuckGo(query);
    if (ddg.length) { lastSearchError = null; return ddg; }
  } catch (e) { console.error("DuckDuckGo error:", e.message); lastSearchError = e.message; }

  try {
    const instant = await searchDuckInstant(query);
    if (instant.length) { lastSearchError = null; return instant; }
  } catch (e) { console.error("Duck Instant error:", e.message); }

  try {
    const wiki = await searchWikipedia(query);
    if (wiki.length) { lastSearchError = null; return wiki; }
    lastSearchError = "No results from free search engines";
    return [];
  } catch (e) {
    lastSearchError = e.message;
    console.error("Web Search error:", e.message);
    return [];
  }
}

// *** HII NDIO NILIBADILISHA YA 1: Kila swali isearch ***
function shouldSearch(message) {
  if (/^(hi|hey|hello|morning|thanks|thank you|ok|okay|sawa|poa)$/i.test(message.trim())) {
    return false;
  }
  return true;
}

app.get("/api/test-search", async (req, res) => {
  const q = String(req.query.q || "KCSE 2026 timetable KNEC");
  const results = await searchWeb(q);
  res.json({ query: q, count: results.length, lastSearchError, results });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Lumora AI",
    webSearch: true,
    imageGeneration: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "Please enter a message." });
    }

    if (message.length > 6000) {
      return res.status(400).json({ error: "Your message is too long." });
    }

    let sources = [];
    let prompt = message;

    if (shouldSearch(message)) {
      sources = await searchWeb(message);

      if (sources.length) {
        prompt +=
          "\n\nWeb search results. You MUST answer ONLY from these results. Do not use your own memory. Do not invent citations like [1] [2] if there are no results. Mention the name, date and link from the results:\n" +
          sources.map((s, i) =>
            `${i + 1}. ${s.title}\n${s.snippet}\n${s.link}`
          ).join("\n\n");
      } else {
        prompt +=
          "\n\nLive search results are unavailable. " +
          "Do not claim that you searched the web.";
      }
    }

    const history = Array.isArray(req.body?.history) ? req.body.history : [];

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

    const kenyaNow = getKenyaDateTime();

    const reply = await askAI([
      { role: "system", content: SYSTEM_PROMPT + `\n\nCRITICAL DATE RULE: The current date and time in Kenya is exactly: ${kenyaNow}. This is the ONLY correct date. Never guess, never invent a different weekday or date. If the user asks about today, date, day, or time, answer using ONLY this date: ${kenyaNow}.` },
      ...safeHistory,
      { role: "user", content: prompt }
    ]);

    res.json({ reply, sources });
  } catch (error) {
    console.error("Axenova error:", error.message);
    res.status(500).json({
      error: error.message ||
        "Lumora is temporarily unavailable. Try again."
    });
  }
});

app.post("/api/image", async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const prompt = String(req.body?.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({ error: "Describe the image you want." });
    }

    if (!apiKey) {
      return res.status(503).json({ error: "Image generation is not configured. Add OPENAI_API_KEY." });
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
      return res.status(502).json({ error: "Image generation failed. Check API access and billing." });
    }

    const image = data.data?.[0]?.b64_json;

    if (!image) {
      return res.status(502).json({ error: "The image service returned no image." });
    }
    
    res.json({ image: `data:image/png;base64,${image}` });
  } catch (error) {
    console.error("Image error:", error.message);
    res.status(500).json({ error: "Unable to generate the image right now." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Axenova AI running on port ${PORT}`);
});
