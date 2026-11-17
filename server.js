
require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

app.set("trust proxy", 1);
app.disable("x-powered-by");

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const AXENOVA_SYSTEM_PROMPT = `
You are Axenova AI, an advanced, intelligent and helpful AI assistant.

IDENTITY:
- Your name is Axenova AI.
- Your creator is John Theuri.
- Be professional, intelligent, friendly and naturally conversational.

CONVERSATION STYLE:
- Answer the exact question the user asks.
- Simple questions deserve simple, direct answers.
- Complex questions deserve detailed, organized explanations.
- Avoid unnecessary introductions and repetitive conclusions.
- Ask questions when important information is missing.
- Maintain conversation context.

LANGUAGES:
- Understand English and Kiswahili.
- Understand Nairobi Sheng.
- Respond in the language the user chooses.
- Use Sheng naturally when appropriate.

ACCURACY:
- Never invent facts, statistics, links or citations.
- Admit when information is uncertain.
- Distinguish facts from estimates.
- Never claim to have searched the internet unless search results were provided.

CODING:
- Help users build real websites and applications.
- Provide complete, functional code when requested.
- Explain where code belongs.
- Avoid changing unrelated working code.
- Identify errors before suggesting major rewrites.

EDUCATION:
- Explain difficult concepts in simple language.
- Show calculations step by step when useful.
- Never guarantee examination results.

CREATIVITY:
- Follow the requested format and style.
- Do not add unrelated content.

RESPONSE QUALITY:
- Prioritize relevance, correctness and clarity.
- Be concise by default.
- Expand when necessary.
- Avoid repetitive phrases.

Your purpose is to make every interaction useful, intelligent and natural.
`;

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error(
    "WARNING: Set a secure JWT_SECRET of at least 32 characters in Render."
  );
}

const ACTIVE_JWT_SECRET =
  JWT_SECRET || "temporary-development-secret-change-this";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;
const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY;

const CHAT_MODEL =
  process.env.GROQ_CHAT_MODEL ||
  process.env.GROQ_MODEL ||
  "openai/gpt-oss-120b";

const VISION_MODEL =
  process.env.GROQ_VISION_MODEL ||
  "meta-llama/llama-4-scout-17b-16e-instruct";

const IMAGE_MODEL =
  process.env.POLLINATIONS_IMAGE_MODEL ||
  "black-forest-labs/flux.1-schnell";

const PUBLIC_DIR = path.join(__dirname, "public");

// --------------------------------------------------
// IMAGE STYLE INTELLIGENCE
// --------------------------------------------------

function detectImageStyle(prompt) {
  const text = prompt.toLowerCase();

  if (/\b(anime|manga|japanese animation)\b/i.test(text)) {
    return "anime";
  }

  if (/\b(cartoon|cartoon-style|comic cartoon)\b/i.test(text)) {
    return "cartoon";
  }

  if (/\b(3d render|3d character|three-dimensional render)\b/i.test(text)) {
    return "3d";
  }

  if (/\b(oil painting|watercolor|watercolour|digital painting|illustration|hand-drawn)\b/i.test(text)) {
    return "painting";
  }

  return "realistic";
}

function buildImagePrompt(prompt) {
  const style = detectImageStyle(prompt);

  const instructions = {
    realistic:
      "Create a highly photorealistic professional photograph. Use natural lighting, realistic textures, accurate proportions, lifelike details and realistic materials. Avoid cartoon and anime aesthetics.",

    anime:
      "Create high-quality anime artwork with expressive anime characters, detailed backgrounds, beautiful anime lighting, clean linework and professional Japanese animation aesthetics. Do not make it look like a real photograph.",

    cartoon:
      "Create a polished cartoon illustration with expressive characters, appealing shapes, clean outlines, vibrant colours and professional cartoon artwork. Do not make it look like a real photograph.",

    "3d":
      "Create a professional high-quality 3D render with realistic depth, detailed materials, convincing textures and cinematic lighting.",

    painting:
      "Create a beautiful professional painting or illustration, following the artistic medium requested by the user."
  };

  return {
    style,
    prompt:
      `${instructions[style]}\n\nUser's original image request: ${prompt}`
  };
}

// --------------------------------------------------
// POSTGRESQL DATABASE
// --------------------------------------------------

if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is missing in Render.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000
});

pool.on("error", error => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});

async function initializeDatabase() {
  await pool.query("SELECT 1");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT DEFAULT 'New conversation',
      messages TEXT NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT conversations_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS conversations_user_id_idx
    ON public.conversations(user_id)
  `);

  console.log("Supabase PostgreSQL connected successfully.");
  console.log("Axenova database tables verified.");
}

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

if (process.env.FRONTEND_ORIGIN) {
  app.use(
    cors({
      origin: process.env.FRONTEND_ORIGIN.split(",").map(x => x.trim()),
      credentials: true
    })
  );
}

app.use(
  "/api/",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 150,
    standardHeaders: "draft-8",
    legacyHeaders: false
  })
);

app.use((req, res, next) => {
  req.cookies = {};

  const cookieHeader = req.headers.cookie || "";

  cookieHeader.split(";").forEach(part => {
    const separator = part.indexOf("=");

    if (separator === -1) return;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    try {
      req.cookies[key] = decodeURIComponent(value);
    } catch {
      req.cookies[key] = value;
    }
  });

  next();
});

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    ACTIVE_JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000
  };
}

function setAuthCookie(res, token) {
  res.cookie("axenova_token", token, cookieOptions());
}

function authMiddleware(req, res, next) {
  const cookieToken = req.cookies?.axenova_token || null;
  const authorization = req.headers.authorization || "";

  const bearerToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  const token = cookieToken || bearerToken;

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: "Please log in first."
    });
  }

  try {
    req.user = jwt.verify(token, ACTIVE_JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      ok: false,
      error: "Your session has expired. Please log in again."
    });
  }
}

// REGISTER
app.post("/api/auth/register", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Please enter your name, email and password."
      });
    }

    if (name.length > 80) {
      return res.status(400).json({
        ok: false,
        error: "Your name is too long."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        ok: false,
        error: "Enter a valid email address."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        ok: false,
        error: "Password must contain at least 8 characters."
      });
    }

    const existing = await pool.query(
      "SELECT id FROM public.users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        error: "An account with this email already exists."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = crypto.randomUUID();

    const result = await pool.query(
      `INSERT INTO public.users (id, name, email, password)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, created_at`,
      [userId, name, email, hashedPassword]
    );

    const user = result.rows[0];

    setAuthCookie(res, createToken(user));

    return res.status(201).json({
      ok: true,
      message: "Account created successfully.",
      user
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        ok: false,
        error: "An account with this email already exists."
      });
    }

    next(error);
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Enter your email and password."
      });
    }

    const result = await pool.query(
      "SELECT * FROM public.users WHERE email = $1",
      [email]
    );

    const userRecord = result.rows[0];

    if (!userRecord) {
      return res.status(401).json({
        ok: false,
        error: "Incorrect email or password."
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      userRecord.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        ok: false,
        error: "Incorrect email or password."
      });
    }

    const user = {
      id: userRecord.id,
      name: userRecord.name,
      email: userRecord.email,
      created_at: userRecord.created_at
    };

    setAuthCookie(res, createToken(user));

    return res.json({
      ok: true,
      message: "Login successful.",
      user
    });
  } catch (error) {
    next(error);
  }
});

// CURRENT USER
app.get("/api/auth/me", authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, created_at
       FROM public.users WHERE id = $1`,
      [req.user.id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Account not found."
      });
    }

    res.json({ ok: true, user });
  } catch (error) {
    next(error);
  }
});

// LOGOUT
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("axenova_token", cookieOptions());

  res.json({
    ok: true,
    message: "Logged out successfully."
  });
});

// --------------------------------------------------
// CONVERSATION HISTORY
// --------------------------------------------------

app.get("/api/conversations", authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, messages, updated_at
       FROM public.conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.user.id]
    );

    const conversations = result.rows.map(row => {
      let messages = [];

      try {
        messages = JSON.parse(row.messages);
      } catch {
        messages = [];
      }

      return {
        id: row.id,
        title: row.title,
        messages,
        updatedAt: row.updated_at
      };
    });

    res.json({ ok: true, conversations });
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations", authMiddleware, async (req, res, next) => {
  try {
    const id = String(req.body.id || crypto.randomUUID());
    const title = String(
      req.body.title || "New conversation"
    ).slice(0, 150);

    const messages = req.body.messages;

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        ok: false,
        error: "Messages must be an array."
      });
    }

    if (messages.length > 500) {
      return res.status(400).json({
        ok: false,
        error: "This conversation contains too many messages."
      });
    }

    await pool.query(
      `INSERT INTO public.conversations
        (id, user_id, title, messages, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         messages = EXCLUDED.messages,
         updated_at = CURRENT_TIMESTAMP
       WHERE public.conversations.user_id = EXCLUDED.user_id`,
      [id, req.user.id, title, JSON.stringify(messages)]
    );

    res.json({
      ok: true,
      id,
      message: "Conversation saved."
    });
  } catch (error) {
    console.error("Conversation save error:", error.message);

    res.status(500).json({
      ok: false,
      error: "Could not save conversation."
    });
  }
});

app.delete(
  "/api/conversations/:id",
  authMiddleware,
  async (req, res, next) => {
    try {
      const result = await pool.query(
        `DELETE FROM public.conversations
         WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );

      res.json({
        ok: true,
        deleted: result.rowCount > 0
      });
    } catch (error) {
      next(error);
    }
  }
);
