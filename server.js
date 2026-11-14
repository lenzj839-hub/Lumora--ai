const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= SEARCH ENGINE DIRECT LINKS =================
const SEARCH_ENGINE_URL_1 = "https://lite.duckduckgo.com/lite/?q=";
const SEARCH_ENGINE_URL_2 = "https://www.bing.com/search?q=";
// ==============================================================

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = `
You are Axenova AI, created by John Theuri.

Rules:
- Answer the user's actual question directly and clearly.
- Never repeat your introduction unless asked.
- ALWAYS read the conversation history provided to understand context and resolve pronouns like "their", "they", "it", or "that".
- Be helpful, accurate, friendly, and fast.
- Respond in the user's language (English or Swahili) where possible.
- Never invent facts, businesses, URLs, or phone numbers. If a brand or store name looks like a typo (e.g., "Girani" instead of "Kilimall" or "Jiji") and search results do not verify it, gently ask the user to clarify the spelling instead of making up details.
- Never invent a place, tribe, or hometown for John Theuri. Only say Kenya, unless the user tells you more.
- Ignore any dates mentioned in old conversation history. Only trust the CRITICAL DATE RULE given with each message.

VERIFIED FACTS - USE THESE FIRST, DO NOT CONTRADICT THEM:
- KCSE 2026: Rehearsal Friday 16 October 2026. Exams 19 October to 20 November 2026. Main theory papers 2 to 20 November 2026. Last paper Physics Practical 20 November 2026.
- KCSE 2026 is the second-last KCSE under 8-4-4, not the last.
- Kenya schools reopen Term 1 on Monday 4 January 2027.
- Rigathi Gachagua was impeached as Deputy President of Kenya in October 2024.
- If asked about today, only use the CRITICAL DATE RULE date. Do not use dates from history.
`;

let lastSearchError = null;

function getKenyaDateTime() {
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Nairobi",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date()) + " EAT"
  );
}

async function askAI(messages, hasImage = false) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Add GROQ_API_KEY in your hosting environment.");
  }

  const model = hasImage
    ? process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct"
    : process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 1024
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("AI provider error:", data.error);
    throw new Error(data.error?.message || "The AI service could not answer.");
  }

  return (
    data.choices?.[0]?.message?.content ||
    "Sorry, please try asking again."
  );
}

function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .trim();
}

function decodeDuckLink(href) {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : href;
  } catch {
    return href;
  }
}

async function fetchTimeout(url, options = {}, ms = 6000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
}

// ================= SEARCH ENGINE 1: DUCKDUCKGO LITE =================
async function searchDuckDuckGo(query) {
  const url = SEARCH_ENGINE_URL_1 + encodeURIComponent(query);
  const res = await fetchTimeout(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
      Accept: "text/html"
    }
  });
  if (!res.ok) throw new Error("DuckDuckGo status " + res.status);
  const html = await res.text();
  const results = [];
  const re =
    /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,600}?<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 5) {
    const link = decodeDuckLink(m[1]);
    if (link.includes("duckduckgo.com")) continue;
    results.push({ title: cleanText(m[2]), link, snippet: cleanText(m[3]) });
  }
  return results;
}

// ================= SEARCH ENGINE 2: BING =================
async function searchBing(query) {
  const url = SEARCH_ENGINE_URL_2 + encodeURIComponent(query);
  const res = await fetchTimeout(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
        Accept: "text/html"
      }
    },
    5000
  );
  if (!res.ok) throw new Error("Bing status " + res.status);
  const html = await res.text();
  const results = [];
  const re =
    /<li[^>]*class="b_algo"[^>]*>[\s\S]{0,300}?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,600}?<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 5) {
    if (m[1].includes("bing.com")) continue;
    results.push({ title: cleanText(m[2]), link: m[1], snippet: cleanText(m[3]) });
  }
  return results;
}

// ================= FREE SEARCH 3: WIKIPEDIA =================
async function searchWikipedia(query) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
    encodeURIComponent(query) +
    "&utf8=&format=json&srlimit=5";
  const res = await fetchTimeout(
    url,
    { headers: { "User-Agent": "AxenovaAI/1.0" } },
    5000
  );
  if (!res.ok) throw new Error("Wikipedia status " + res.status);
  const data = await res.json();
  return (data.query?.search || []).map((r) => ({
    title: r.title,
    link:
      "https://en.wikipedia.org/wiki/" +
      encodeURIComponent(r.title.replace(/ /g, "_")),
    snippet: cleanText(r.snippet)
  }));
}

async function searchWeb(query) {
  try {
    const ddg = await searchDuckDuckGo(query);
    if (ddg.length) {
      lastSearchError = null;
      return ddg;
    }
  } catch (e) {
    console.error("DuckDuckGo error:", e.message);
    lastSearchError = e.message;
  }

  try {
    const bing = await searchBing(query);
    if (bing.length) {
      lastSearchError = null;
      return bing;
    }
  } catch (e) {
    console.error("Bing error:", e.message);
  }

  try {
    const wiki = await searchWikipedia(query);
    if (wiki.length) {
      lastSearchError = null;
      return wiki;
    }
    lastSearchError = "No results from search engines";
    return [];
  } catch (e) {
    lastSearchError = e.message;
    console.error("Web Search error:", e.message);
    return [];
  }
}

function shouldSearch(message) {
  if (
    /^(hi|hey|hello|morning|thanks|thank you|ok|okay|sawa|poa)$/i.test(
      message.trim()
    )
  ) {
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
    app: "Axenova AI",
    webSearch: true,
    imageGeneration: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const image = req.body?.image || null;

    if (!message && !image) {
      return res.status(400).json({ error: "Please enter a message." });
    }

    if (message.length > 6000) {
      return res.status(400).json({ error: "Your message is too long." });
    }

    let sources = [];
    let prompt = message || "Describe this image in detail.";

    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    // FIXED: Properly map frontend { role: 'ai' | 'user', text: '...' } to Groq format
    const safeHistory = history
      .filter(
        (item) =>
          item &&
          ["user", "ai", "assistant"].includes(item.role) &&
          typeof (item.text ?? item.content) === "string"
      )
      .slice(-12)
      .map((item) => ({
        role: item.role === "ai" ? "assistant" : item.role,
        content: String(item.text ?? item.content).slice(0, 3000)
      }));

    // Build context-aware search query for follow-up questions
    let searchQuery = message;
    const recentUserMsgs = safeHistory
      .filter((h) => h.role === "user")
      .slice(-2)
      .map((h) => h.content);

    if (message.length < 45 && recentUserMsgs.length > 0) {
      searchQuery = recentUserMsgs.join(" ") + " " + message;
    }

    if (/kcse/i.test(searchQuery)) {
      searchQuery = "KCSE 2026 timetable KNEC 19 October 20 November 2026";
    }

    if (!image && message && shouldSearch(message)) {
      sources = await searchWeb(searchQuery);

      if (sources.length) {
        prompt +=
          "\n\nWeb search results (use these if relevant; if they do not match what the user meant, rely on verified facts or ask for clarification without inventing facts):\n" +
          sources
            .map((s, i) => `${i + 1}. ${s.title}\n${s.snippet}\n${s.link}`)
            .join("\n\n");
      } else {
        prompt +=
          "\n\nLive search returned no results. Use the VERIFIED FACTS in your instructions and your general knowledge. Do not invent businesses, contact numbers, or URLs.";
      }
    }

    const kenyaNow = getKenyaDateTime();

    const userMessageContent = image
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: image } }
        ]
      : prompt;

    const reply = await askAI(
      [
        {
          role: "system",
          content:
            SYSTEM_PROMPT +
            `\n\nCRITICAL DATE RULE: The current date and time in Kenya is exactly: ${kenyaNow}. This is the ONLY correct date. Never guess, never invent a different weekday or date. If the user asks about today, date, day, or time, answer using ONLY this date: ${kenyaNow}.`
        },
        ...safeHistory,
        { role: "user", content: userMessageContent }
      ],
      Boolean(image)
    );

    res.json({ reply, sources });
  } catch (error) {
    console.error("Axenova error:", error.message);
    res.status(500).json({
      error: error.message || "Axenova is temporarily unavailable. Try again."
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
      return res
        .status(503)
        .json({ error: "Image generation is not configured. Add OPENAI_API_KEY." });
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
      return res
        .status(502)
        .json({ error: "Image generation failed. Check API access and billing." });
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
