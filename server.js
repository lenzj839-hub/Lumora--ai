
"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.set("trust proxy", 1);

// ---------------- CONFIGURATION ----------------

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL =
  process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const GROQ_VISION_MODEL =
  process.env.GROQ_VISION_MODEL ||
  "meta-llama/llama-4-scout-17b-16e-instruct";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_MODEL =
  process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const REQUEST_TIMEOUT = 45000;

// ---------------- MIDDLEWARE ----------------

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// ---------------- RATE LIMITING ----------------

const requestCounts = new Map();

app.use("/api", (req, res, next) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 40;

  let record = requestCounts.get(ip);

  if (!record || now - record.start > windowMs) {
    record = { start: now, count: 0 };
  }

  record.count++;
  requestCounts.set(ip, record);

  if (record.count > maxRequests) {
    return res.status(429).json({
      error: "Too many requests. Please wait a moment and try again."
    });
  }

  next();
});

// ---------------- HELPERS ----------------

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function cleanText(value, maxLength = 12000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function getKenyaDateTime() {
  return new Date().toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    dateStyle: "full",
    timeStyle: "short"
  });
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-12)
    .filter(item =>
      item &&
      typeof item.content === "string" &&
      ["user", "assistant", "ai"].includes(item.role)
    )
    .map(item => ({
      role:
        item.role === "ai" ? "assistant" : item.role,
      content: item.content.slice(0, 6000)
    }));
}

function validateImageData(image) {
  if (!image || typeof image !== "string") {
    return null;
  }

  const match = image.match(
    /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/
  );

  if (!match) return null;

  const mime = match[1] === "image/jpg"
    ? "image/jpeg"
    : match[1];

  const base64 = match[2];

  const estimatedSize = Math.floor(base64.length * 0.75);

  if (estimatedSize > MAX_IMAGE_SIZE) {
    return null;
  }

  return `data:${mime};base64,${base64}`;
}

async function readResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ---------------- AXENOVA IDENTITY ----------------

const SYSTEM_PROMPT = `
You are AXENOVA AI, an intelligent assistant created by John Theuri.

IDENTITY:
- Your name is Axenova AI.
- Your creator is John Theuri.
- Be professional, friendly, helpful and occasionally funny.
- Communicate naturally and clearly.
- Be respectful and safe.

CAPABILITIES:
- Answer questions.
- Explain school subjects and difficult concepts.
- Help with mathematics, science, programming and technology.
- Write, debug and explain code.
- Help with business ideas and planning.
- Understand images when an image is supplied.
- Use supplied search results to answer questions about current information.

IMPORTANT:
- Never pretend you searched the internet if no search was performed.
- Never invent facts, sources, links or search results.
- If you are unsure, say so.
- Give complete code when the user asks for complete code.
- Explain technical instructions in beginner-friendly steps.
- Use the current Kenya date and time when relevant.

CURRENT KENYA DATE AND TIME:
${getKenyaDateTime()}
`;

// ---------------- GROQ AI ----------------

async function askGroq(messages, useVision = false) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const model = useVision ? GROQ_VISION_MODEL : GROQ_MODEL;

  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 4096
      })
    }
  );

  const data = await readResponse(response);

  if (!response.ok) {
    console.error("Groq error:", data);

    throw new Error(
      data.error?.message ||
      "The AI service could not complete your request."
    );
  }

  const answer = data.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error("The AI returned an empty response.");
  }

  return answer;
}

// ---------------- GOOGLE SEARCH ----------------

async function googleSearch(query) {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    return [];
  }

  const url = new URL(
    "https://www.googleapis.com/customsearch/v1"
  );

  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("cx", GOOGLE_CSE_ID);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "5");

  const response = await fetchWithTimeout(url.toString());

  const data = await readResponse(response);

  if (!response.ok) {
    console.error("Google Search error:", data);
    return [];
  }

  return (data.items || []).map(item => ({
    title: item.title || "",
    link: item.link || "",
    snippet: item.snippet || ""
  }));
}

// ---------------- DUCKDUCKGO FALLBACK ----------------

async function duckDuckGoSearch(query) {
  const url = new URL(
    "https://api.duckduckgo.com/"
  );

  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  try {
    const response = await fetchWithTimeout(url.toString());

    if (!response.ok) return [];

    const data = await response.json();
    const results = [];

    if (data.AbstractText) {
      results.push({
        title: data.Heading || "Overview",
        link: data.AbstractURL || "",
        snippet: data.AbstractText
      });
    }

    for (const item of data.RelatedTopics || []) {
      if (item.Text && item.FirstURL) {
        results.push({
          title: item.Text.slice(0, 100),
          link: item.FirstURL,
          snippet: item.Text
        });
      }

      if (item.Topics) {
        for (const sub of item.Topics) {
          if (sub.Text && sub.FirstURL) {
            results.push({
              title: sub.Text.slice(0, 100),
              link: sub.FirstURL,
              snippet: sub.Text
            });
          }
        }
      }

      if (results.length >= 5) break;
    }

    return results.slice(0, 5);
  } catch (error) {
    console.error("DuckDuckGo search error:", error.message);
    return [];
  }
}

// ---------------- SEARCH ROUTER ----------------

async function performSearch(query) {
  let results = await googleSearch(query);

  if (results.length === 0) {
    results = await duckDuckGoSearch(query);
  }

  return results;
}

function shouldSearch(message) {
  const text = message.toLowerCase();

  const keywords = [
    "latest",
    "today",
    "currently",
    "current",
    "news",
    "weather",
    "price",
    "prices",
    "2026",
    "2027",
    "this week",
    "this month",
    "recent",
    "search the web",
    "search online",
    "look up",
    "who is",
    "what happened",
    "where can i buy",
    "website",
    "official website"
  ];

  return keywords.some(word => text.includes(word));
}

// ---------------- HEALTH CHECK ----------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Axenova AI",
    creator: "John Theuri",
    status: "online",
    services: {
      groq: Boolean(GROQ_API_KEY),
      googleSearch: Boolean(GOOGLE_API_KEY && GOOGLE_CSE_ID),
      imageGeneration: Boolean(OPENAI_API_KEY)
    },
    time: getKenyaDateTime()
  });
});

// ---------------- SEARCH TEST ----------------

app.get("/api/test-search", async (req, res) => {
  try {
    const query = cleanText(req.query.q, 300);

    if (!query) {
      return res.status(400).json({
        error: "Please provide a search query using ?q="
      });
    }

    const results = await performSearch(query);

    res.json({
      ok: true,
      query,
      count: results.length,
      results
    });
  } catch (error) {
    console.error("Search test error:", error);

    res.status(500).json({
      error: error.message || "Search failed."
    });
  }
});

// ---------------- CHAT API ----------------

app.post("/api/chat", async (req, res) => {
  try {
    const message = cleanText(req.body?.message, 12000);
    const history = normalizeHistory(req.body?.history);
    const image = validateImageData(req.body?.image);

    if (!message && !image) {
      return res.status(400).json({
        error: "Please enter a message or upload an image."
      });
    }

    if (req.body?.image && !image) {
      return res.status(400).json({
        error: "Invalid image or image is too large. Use JPEG, PNG, WEBP or GIF."
      });
    }

    let searchResults = [];

    if (message && shouldSearch(message)) {
      searchResults = await performSearch(message);
    }

    const messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      ...history
    ];

    let userContent = message || "Please describe this image.";

    if (searchResults.length > 0) {
      const searchText = searchResults
        .map((item, index) =>
          `${index + 1}. ${item.title}\n${item.snippet}\nURL: ${item.link}`
        )
        .join("\n\n");

      userContent += `

WEB SEARCH RESULTS:
${searchText}

Use these results when answering. Include relevant source links.
Do not claim that information is verified beyond what the results support.
`;
    }

    if (image) {
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: userContent
          },
          {
            type: "image_url",
            image_url: {
              url: image
            }
          }
        ]
      });
    } else {
      messages.push({
        role: "user",
        content: userContent
      });
    }

    const reply = await askGroq(messages, Boolean(image));

    res.json({
      ok: true,
      reply,
      searchResults
    });

  } catch (error) {
    console.error("Chat API error:", error);

    res.status(500).json({
      error: error.message || "Something went wrong. Please try again."
    });
  }
});

// ---------------- IMAGE GENERATION API ----------------

app.post("/api/image", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(503).json({
        error: "Image generation is not configured. Add OPENAI_API_KEY to your environment variables."
      });
    }

    const prompt = cleanText(req.body?.prompt, 4000);

    if (!prompt) {
      return res.status(400).json({
        error: "Please enter an image description."
      });
    }

    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: OPENAI_IMAGE_MODEL,
          prompt,
          size: "1024x1024",
          n: 1
        })
      }
    );

    const data = await readResponse(response);

    if (!response.ok) {
      console.error("OpenAI image error:", data);

      throw new Error(
        data.error?.message ||
        "Image generation failed."
      );
    }

    const imageData = data.data?.[0];

    if (!imageData) {
      throw new Error("No image was returned.");
    }

    res.json({
      ok: true,
      image: imageData.b64_json
        ? `data:image/png;base64,${imageData.b64_json}`
        : imageData.url || null
    });

  } catch (error) {
    console.error("Image API error:", error);

    res.status(500).json({
      error: error.message || "Could not generate the image."
    });
  }
});

// ---------------- UNKNOWN API ROUTES ----------------

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

// ---------------- ERROR HANDLER ----------------

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || 500;

  res.status(status).json({
    error:
      status === 413
        ? "Request is too large."
        : "An unexpected server error occurred."
  });
});

// ---------------- FRONTEND FALLBACK ----------------

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API endpoint not found."
    });
  }

  res.sendFile(
    path.join(__dirname, "public", "index.html"),
    error => {
      if (error) next(error);
    }
  );
});

// ---------------- START SERVER ----------------

app.listen(PORT, "0.0.0.0", () => {
  console.log("----------------------------------");
  console.log("       AXENOVA AI ONLINE");
  console.log("----------------------------------");
  console.log(`Port: ${PORT}`);
  console.log("Creator: John Theuri");
  console.log(`Groq: ${GROQ_API_KEY ? "Configured" : "Missing"}`);
  console.log(
    `Google Search: ${
      GOOGLE_API_KEY && GOOGLE_CSE_ID ? "Configured" : "Missing"
    }`
  );
  console.log(
    `Image Generation: ${
      OPENAI_API_KEY ? "Configured" : "Missing"
    }`
  );
  console.log("----------------------------------");
});
