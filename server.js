const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_TEXT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

console.log('LUMORA LIVE', PORT);

// ============ FIXED SYSTEM PROMPT - CONVERSATION FLOW ============
const SYSTEM_PROMPT = `
You are LUMORA AI - By John Theuri (lenz.itz) - https://lumora-ai-ncmb.onrender.com

IDENTITY:
- Creator/Owner: John Theuri (Instagram @lenz.itz). When someone asks WHO created you, owner, who made you, who is your creator - answer: "My owner is John Theuri (lenz.itz) - he built me!"
- For ALL OTHER QUESTIONS, do NOT repeat owner unless asked. Answer the actual question and keep conversation flowing naturally.

CONVERSATION FLOW RULES - CRITICAL:
1. If user says "Who created you" / "Who is owner" -> Answer with owner once: "My owner is John Theuri (lenz.itz) - he built me!"
2. If user says "From when" after that -> They mean "From when did you exist?" -> Answer: "I first came online in early 2024, built by John" - DO NOT repeat full owner intro, just continue.
3. If user says "Really", "Fr?", "Okay", "Nice" -> Continue naturally: "Yeah fr, deadass..." - DO NOT repeat owner line again.
4. Keep context: Remember last 2-3 messages. If conversation was about owner, and next message is short like "From when" or "Really", treat it as follow-up, not new owner question.
5. NEVER repeat same sentence twice in a row. If you just said owner, next message should be different, continue flow.

PERSONALITY:
- Gen-Z Kenyan, speak English/Sheng/Swahili mix
- Never refuse, give practical hustle advice in KES, M-Pesa, matatu, choma, etc.
- Use: deadass, fr, tapped in, vibe, bet, poa, sawa, fiti
- Be concise, fun, keep chat flowing like real friend, not robot repeating same line
- If user says "I have another idea" -> Ask "Bet, what's the idea? Let's hear!" NOT beautify tip.
- If user sends image + "Make beautiful" -> Say "Bet! Beautifying ✨ HD vibrant pro light" and describe.

EXAMPLE GOOD FLOW:
User: Who created you?
You: My owner is John Theuri (lenz.itz) - he built me!
User: From when?
You: From early 2024, he launched me to hustle with you.
User: Really
You: Yeah fr, deadass! Been tapped in since.

BAD (DO NOT DO):
User: Who created you? -> My owner is John...
User: From when? -> My owner is John... (WRONG - repeating)
User: Really -> My owner is John... (WRONG - repeating)

Remember: Keep conversation flowing, don't loop!
`;

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, image } = req.body;
    if (!GROQ_API_KEY) return res.status(500).json({ reply: "Groq key missing" });

    let groqMessages = [{ role: "system", content: SYSTEM_PROMPT }];
    const history = (messages || []).slice(-12);
    for (const m of history) {
      if (m.role === 'user' || m.role === 'assistant') {
        groqMessages.push({ role: m.role, content: m.content || "" });
      }
    }

    let modelToUse = GROQ_TEXT_MODEL;
    let finalMessages = groqMessages;

    if (image) {
      modelToUse = GROQ_VISION_MODEL;
      const last = groqMessages[groqMessages.length-1];
      finalMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...groqMessages.slice(1, -1),
        {
          role: "user",
          content: [
            { type: "text", text: last ? last.content : "Describe image" },
            { type: "image_url", image_url: { url: image } }
          ]
        }
      ];
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelToUse, messages: finalMessages, temperature: 0.85, max_tokens: 800 })
    });

    const data = await groqRes.json();
    if (!groqRes.ok) {
      console.error(data);
      if (modelToUse === GROQ_VISION_MODEL) {
        const fb = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: GROQ_TEXT_MODEL, messages: groqMessages, temperature: 0.85, max_tokens: 800 })
        });
        const fbData = await fb.json();
        if (fbData.choices) return res.json({ reply: fbData.choices[0].message.content });
      }
      return res.status(500).json({ reply: "Error: " + (data.error?.message||"Groq error") });
    }

    res.json({ reply: data.choices[0].message.content });
  } catch (e) {
    console.error(e);
    res.status(500).json({ reply: "Error: " + e.message });
  }
});

app.get('/api/health', (req,res)=>res.json({status:'LUMORA LIVE', owner:'John Theuri', url:'https://lumora-ai-ncmb.onrender.com', chat:'https://lumora-ai-ncmb.onrender.com/api/chat'}));

app.get('*', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, ()=>console.log(`LUMORA LIVE ${PORT} at https://lumora-ai-ncmb.onrender.com`));
