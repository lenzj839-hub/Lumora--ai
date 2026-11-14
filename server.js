
require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const rateLimit = require("express-rate-limit");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 10000;

app.set("trust proxy", 1);

app.use(express.json({ limit: "15mb" }));

if (process.env.FRONTEND_ORIGIN) {
  app.use(cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true
  }));
}

app.use(express.static(path.join(__dirname, "public")));

/* DATABASE
   Uses a local writable folder by default.
   For a Render persistent disk, set DB_PATH=/var/data/axenova.db
*/

const dbPath = process.env.DB_PATH || path.join(__dirname, "axenova.db");

if (dbPath !== ":memory:") {
  const dbDirectory = path.dirname(dbPath);

  if (!fs.existsSync(dbDirectory)) {
    fs.mkdirSync(dbDirectory, { recursive: true });
  }
}

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  title TEXT,
  messages TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, conversation_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const systemPrompt = `
You are Axenova AI, an intelligent assistant created by John Theuri.

You are helpful, accurate, friendly and professional.
You can explain topics, write code, help with business ideas,
answer questions and assist with learning.

Use clear language. Be honest when you do not know something.
Never pretend that you have performed an action you have not performed.
Support English and Kiswahili naturally.
`;

function asyncRoute(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(name + " is not configured on the server.");
  }
  return process.env[name];
}

async function fetchWithTimeout(url, options = {}, timeout = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function cleanText(value, max = 12000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history.slice(-12).map(item => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: cleanText(item.content, 5000)
  })).filter(item => item.content);
}

function validateImageData(image) {
  if (!image) return null;

  if (typeof image !== "string" || image.length > 14_000_000) {
    throw new Error("Image is too large or invalid.");
  }

  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) {
    throw new Error("Unsupported image format.");
  }

  return image;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    requireEnv("JWT_SECRET"),
    { expiresIn: "7d" }
  );
}

function setAuthCookie(res, token) {
  res.cookie("axenova_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

function getToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)axenova_token=([^;]+)/);

  return match ? decodeURIComponent(match[1]) : null;
}

function authenticate(req, res, next) {
  try {
    const token = getToken(req);

    if (!token) {
      return res.status(401).json({ error: "Please sign in first." });
    }

    const decoded = jwt.verify(token, requireEnv("JWT_SECRET"));

    const user = db.prepare(
      "SELECT id, name, email FROM users WHERE id = ?"
    ).get(decoded.id);

    if (!user) {
      return res.status(401).json({ error: "Account not found." });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({
      error: "Session expired. Please sign in again."
    });
  }
}

/* HEALTH */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Axenova AI",
    groqConfigured: !!process.env.GROQ_API_KEY,
    googleSearchConfigured: !!(
      process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID
    ),
    imageGenerationConfigured: !!process.env.OPENAI_API_KEY,
    database: "connected"
  });
});

/* REGISTER */

app.post("/api/auth/register", authLimiter, asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 80);
  const email = cleanText(req.body.email, 180).toLowerCase();
  const password = req.body.password;

  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      error: "Enter a valid name and email."
    });
  }

  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({
      error: "Password must contain at least 8 characters."
    });
  }

  const existing = db.prepare(
    "SELECT id FROM users WHERE email = ?"
  ).get(email);

  if (existing) {
    return res.status(409).json({
      error: "This email is already registered."
    });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const result = db.prepare(`
    INSERT INTO users (name, email, password)
    VALUES (?, ?, ?)
  `).run(name, email, hashedPassword);

  const user = {
    id: Number(result.lastInsertRowid),
    name,
    email
  };

  setAuthCookie(res, makeToken(user));

  res.status(201).json({ ok: true, user });
}));

/* LOGIN */

app.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 180).toLowerCase();
  const password = req.body.password;

  const user = db.prepare(
    "SELECT * FROM users WHERE email = ?"
  ).get(email);

  if (!user || typeof password !== "string" ||
      !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  const publicUser = {
    id: user.id,
    name: user.name,
    email: user.email
  };

  setAuthCookie(res, makeToken(publicUser));

  res.json({ ok: true, user: publicUser });
}));

/* CURRENT USER */

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ ok: true, user: req.user });
});

/* LOGOUT */

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("axenova_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });

  res.json({ ok: true });
});

/* SAVE CONVERSATIONS */

app.get("/api/conversations", authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT conversation_id, title, messages
    FROM conversations
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `).all(req.user.id);

  const conversations = rows.map(row => ({
    id: row.conversation_id,
    title: row.title,
    messages: JSON.parse(row.messages)
  }));

  res.json({ ok: true, conversations });
});

app.post("/api/conversations", authenticate, (req, res) => {
  const conversations = req.body.conversations;

  if (!Array.isArray(conversations) || conversations.length > 100) {
    return res.status(400).json({
      error: "Invalid conversations."
    });
  }

  const save = db.prepare(`
    INSERT INTO conversations
      (user_id, conversation_id, title, messages, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, conversation_id)
    DO UPDATE SET
      title = excluded.title,
      messages = excluded.messages,
      updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction(items => {
    for (const chat of items) {
      if (!chat || typeof chat.id !== "string" ||
          !Array.isArray(chat.messages) || chat.messages.length > 300) {
        continue;
      }

      const messages = chat.messages.slice(-300).map(message => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: cleanText(message.content, 12000)
      }));

      save.run(
        req.user.id,
        chat.id.slice(0, 100),
        cleanText(chat.title, 100),
        JSON.stringify(messages)
      );
    }
  });

  transaction(conversations);

  res.json({ ok: true });
});

/* GOOGLE SEARCH */

async function googleSearch(query) {
  if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_CSE_ID) {
    return "";
  }

  const params = new URLSearchParams({
    key: process.env.GOOGLE_API_KEY,
    cx: process.env.GOOGLE_CSE_ID,
    q: query,
    num: "5"
  });

  const response = await fetchWithTimeout(
    "https://www.googleapis.com/customsearch/v1?" + params
  );

  if (!response.ok) {
    throw new Error("Google Search request failed.");
  }

  const data = await response.json();

  return (data.items || []).map(item =>
    `Title: ${item.title}\nLink: ${item.link}\nSnippet: ${item.snippet}`
  ).join("\n\n");
}

/* CHAT */

app.post("/api/chat", chatLimiter, asyncRoute(async (req, res) => {
  const message = cleanText(req.body.message, 12000);
  const image = validateImageData(req.body.image);
  const history = normalizeHistory(req.body.history);

  if (!message && !image) {
    return res.status(400).json({
      error: "Enter a message or attach an image."
    });
  }

  const apiKey = requireEnv("GROQ_API_KEY");

  let searchContext = "";

  const wantsSearch = /\b(search|latest|current|today|news|weather|price|2026|look up|find online)\b/i.test(message);

  if (wantsSearch && !image) {
    try {
      searchContext = await googleSearch(message);
    } catch (error) {
      console.error("Search error:", error.message);
    }
  }

  const system = systemPrompt + (
    searchContext
      ? "\n\nUse these web search results when answering. Be clear about uncertainty:\n" + searchContext
      : ""
  );

  const userContent = [];

  if (message) {
    userContent.push({ type: "text", text: message });
  } else {
    userContent.push({
      type: "text",
      text: "Please analyse this image."
    });
  }

  if (image) {
    userContent.push({
      type: "image_url",
      image_url: { url: image }
    });
  }

  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: image ? userContent : message }
  ];

  const model = image
    ? (process.env.GROQ_VISION_MODEL ||
       "meta-llama/llama-4-scout-17b-16e-instruct")
    : (process.env.GROQ_MODEL || "llama-3.3-70b-versatile");

  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 1800
      })
    },
    60000
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Groq error:", data);
    return res.status(response.status).json({
      error: data.error?.message || "AI service request failed."
    });
  }

  const reply = data.choices?.[0]?.message?.content;

  res.json({
    ok: true,
    reply: typeof reply === "string"
      ? reply
      : "I could not generate a response."
  });
}));

/* IMAGE GENERATION */

app.post("/api/image", chatLimiter, asyncRoute(async (req, res) => {
  const prompt = cleanText(req.body.prompt, 3000);

  if (!prompt) {
    return res.status(400).json({
      error: "Describe the image first."
    });
  }

  const apiKey = requireEnv("OPENAI_API_KEY");

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024"
      })
    },
    120000
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("OpenAI image error:", data);
    return res.status(response.status).json({
      error: data.error?.message || "Image generation failed."
    });
  }

  const item = data.data?.[0];

  if (item?.b64_json) {
    return res.json({
      ok: true,
      image: "data:image/png;base64," + item.b64_json
    });
  }

  if (item?.url) {
    return res.json({ ok: true, image: item.url });
  }

  res.status(500).json({
    error: "No image was returned."
  });
}));

/* TEST SEARCH */

app.get("/api/test-search", asyncRoute(async (req, res) => {
  const query = cleanText(req.query.q, 300);

  if (!query) {
    return res.status(400).json({
      error: "Provide a search query."
    });
  }

  const results = await googleSearch(query);

  res.json({ ok: true, results });
}));

/* UNKNOWN API ROUTES */

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
}));

/* FRONTEND FALLBACK - EXPRESS 5 */

app.get("/{*splat}", (req, res, next) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html"),
    error => {
      if (error) next(error);
    }
  );
});

/* ERROR HANDLER */

app.use((error, req, res, next) => {
  console.error("Server error:", error);

  if (res.headersSent) return next(error);

  res.status(error.status || 500).json({
    error: error.message || "Internal server error."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Axenova AI running on port " + PORT);
});
