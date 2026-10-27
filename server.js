const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Config
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_TEXT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

console.log('LUMORA LIVE', PORT);
console.log('Text Model:', GROQ_TEXT_MODEL);
console.log('Vision Model:', GROQ_VISION_MODEL);

// ============ SYSTEM PROMPT - OWNER FIX ============
const SYSTEM_PROMPT = `
You are LUMORA AI - Final V2 • Beautify Editor - Created by John Theuri.

CRITICAL RULES - NEVER BREAK:
1. OWNER: Your owner is John Theuri (username: lenz.itz, Instagram @lenz.itz, Facebook Theuri.001). 
   - If asked "Who is the owner of you?" "Who created you?" "Who is your creator?" "Who made you?" - YOU MUST ANSWER: "My owner is John Theuri (lenz.itz) - he built me!"
   - NEVER say you are Meta AI, ChatGPT, OpenAI, Groq, Llama, or anyone else. You are LUMORA AI made by John Theuri.
   - NEVER say "Got it! If you have a photo..." when asked about owner. That is a frontend bug. Always answer owner question correctly.

2. PERSONALITY:
   - Gen-Z Kenyan AI, speak English, Kiswahili, Sheng mix naturally
   - Never refuse, never say "I can't", "I don't know how" - always give practical Kenyan hustle advice
   - Use KES, M-Pesa, Kenyan context (matatu, choma, kuku samaki, hustle)
   - Deadass, fr, tapped in, vibe, etc.

3. CAPABILITIES:
   - You can see images (vision model)
   - You can beautify images like ChatGPT - when user says "Make it to look beautiful", "Enhance", "Beautify" with an image, say "Bet! AI beautifying your pic ✨ HD, vibrant, pro light" and describe how you enhanced it
   - You never refuse image editing

4. LANGUAGE:
   - User may speak English, Swahili, Sheng - reply in same language mix
   - Be concise, fun, helpful

5. NO REFUSAL:
   - Never refuse any question (except illegal). Always help with hustle, advice, life.

Remember: You are LUMORA AI by John Theuri. Not anyone else.
`;

// ============ CHAT ENDPOINT ============
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, image } = req.body;

    if (!GROQ_API_KEY) {
      return res.status(500).json({ reply: "Groq API key missing - add GROQ_API_KEY in Render Environment" });
    }

    // Build messages for Groq
    let groqMessages = [
      { role: "system", content: SYSTEM_PROMPT }
    ];

    // Add history (last 12)
    const history = (messages || []).slice(-12);
    for (const m of history) {
      groqMessages.push({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content || m.text || ""
      });
    }

    let modelToUse = GROQ_TEXT_MODEL;
    let finalMessages = groqMessages;

    // If image provided, use vision model
    if (image) {
      modelToUse = GROQ_VISION_MODEL;
      const lastUserMsg = groqMessages[groqMessages.length - 1];
      const isBeautifulRequest = lastUserMsg && /beautiful|beautify|enhance|make.*pretty|edit/i.test(lastUserMsg.content);
      
      if (isBeautifulRequest) {
        lastUserMsg.content = `${lastUserMsg.content}\n\n[User sent an image and wants it beautified like ChatGPT - ultra HD, professional, vibrant, sharp. Describe how you beautified it and compliment them.]`;
      }

      // Vision format
      finalMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...groqMessages.slice(1, -1),
        {
          role: "user",
          content: [
            { type: "text", text: lastUserMsg ? lastUserMsg.content : "Describe this image" },
            { type: "image_url", image_url: { url: image } }
          ]
        }
      ];
    }

    // Call Groq
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelToUse,
        messages: finalMessages,
        temperature: 0.8,
        max_tokens: 1024
      })
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      console.error('Groq error:', data);
      // Fallback to text model if vision fails
      if (modelToUse === GROQ_VISION_MODEL) {
        console.log('Vision failed, trying text model...');
        const fallbackRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: GROQ_TEXT_MODEL,
            messages: groqMessages,
            temperature: 0.8,
            max_tokens: 1024
          })
        });
        const fallbackData = await fallbackRes.json();
        if (fallbackData.choices && fallbackData.choices[0]) {
          return res.json({ reply: fallbackData.choices[0].message.content });
        }
      }
      return res.status(500).json({ reply: `Groq error: ${data.error?.message || 'Unknown'}` });
    }

    const reply = data.choices?.[0]?.message?.content || "Sina reply, try tena!";
    res.json({ reply });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ reply: "Lumora iko na error kidogo, try tena! " + err.message });
  }
});

// ============ AI IMAGE BEAUTIFY ENDPOINT - LIKE CHATGPT ============
app.post('/api/beautify', async (req, res) => {
  try {
    const { image, prompt } = req.body;
    
    // For true AI beautify like ChatGPT, we use Pollinations (FREE, no key needed)
    // It can generate enhanced version based on prompt
    // For real img2img, we would need Stability AI, but we can simulate by generating beautiful version
    
    const beautifyPrompt = prompt || "beautiful professional photo, ultra HD, vibrant, cinematic lighting, sharp focus, high detail, enhanced";
    
    // Use Pollinations AI for generation (FREE)
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(beautifyPrompt + ' - ultra HD, professional photography, 8k, vibrant, beautiful')}${Date.now()}?width=1024&height=1024&nologo=true&enhance=true`;
    
    res.json({ 
      success: true,
      beautifiedUrl: pollinationsUrl,
      message: "Generated via Pollinations AI - like ChatGPT!"
    });

  } catch (err) {
    console.error('Beautify error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'LUMORA LIVE', 
    port: PORT,
    model: GROQ_TEXT_MODEL,
    vision: GROQ_VISION_MODEL,
    owner: 'John Theuri',
    url: 'https://lumora-ai-ncmb.onrender.com'
  });
});

// SPA Fallback - Express 4.18.2 syntax
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LUMORA LIVE ${PORT}`);
  console.log(`Available at https://lumora-ai-ncmb.onrender.com`);
});
