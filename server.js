FACT RULE: For location questions (China Square, Carrefour, Two Rivers, Ruaka, etc):
- If you are not 100% sure, say "I'm not 100% sure, check 【entity-Google Maps¦canonical_name=Google Maps】"
- NEVER invent roads like "Mombasa Road in Ruaka" - that's fake!
- Real China Square is at Unicity Mall, Thika Road, Kenyatta University - not Ruaka!
- Always add Google Maps link and say "Verify on Maps"const express = require('express');
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

const SYSTEM_PROMPT = `
You are LUMORA AI by John Theuri (lenz.itz) - https://lumora-ai-ncmb.onrender.com

RULES:
1. Owner: When asked who created/owner/made you, say "My owner is John Theuri (lenz.itz)"
2. For location questions (malls, shops, Carrefour, Two Rivers, Ruaka, etc.), DO NOT LIE! 
   - Always add Google Maps link at end: "📍 Google Maps: https://www.google.com/maps/search/ + query"
   - Example: If user asks about Carrefour Two Rivers, add: 📍 https://www.google.com/maps/search/Carrefour+Two+Rivers+Mall
   - If unsure, say "Check Maps" and give link
3. Conversation flow: Don't repeat owner for follow-ups like "From when", "Really"
4. Personality: Gen-Z Kenyan, Sheng mix, KES, M-Pesa, never refuse, helpful
`;

function addGoogleMapsLink(reply, userQuery) {
  const lower = (userQuery + ' ' + reply).toLowerCase();
  const isLocation = /carrefour|two rivers|ruaka|mall|shop|nairobi|where is|location|direction|matatu|business park/i.test(lower);
  
  if (isLocation) {
    // Extract search query
    let searchQuery = userQuery || 'location';
    if (lower.includes('carrefour') && lower.includes('two rivers')) searchQuery = 'Carrefour Two Rivers Mall';
    else if (lower.includes('carrefour') && lower.includes('ruaka')) searchQuery = 'Carrefour Ruaka';
    else if (lower.includes('two rivers')) searchQuery = 'Two Rivers Mall';
    else if (lower.includes('ruaka')) searchQuery = 'Ruaka Business Park';
    else searchQuery = userQuery.slice(0,50);
    
    const mapsLink = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
    const mapsLink2 = `https://maps.google.com/?q=${encodeURIComponent(searchQuery)}`;
    
    // Add if not already there
    if (!reply.includes('google.com/maps') && !reply.includes('maps.google')) {
      reply += `\n\n📍 Verify on Google Maps: ${mapsLink}`;
    }
  }
  return reply;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, image } = req.body;
    if (!GROQ_API_KEY) return res.status(500).json({ reply: "Groq key missing" });

    let groqMessages = [{ role: "system", content: SYSTEM_PROMPT }];
    const history = (messages || []).slice(-12);
    for (const m of history) {
      groqMessages.push({ role: m.role, content: m.content || "" });
    }

    let modelToUse = GROQ_TEXT_MODEL;
    let finalMessages = groqMessages;
    if (image) {
      modelToUse = GROQ_VISION_MODEL;
      const last = groqMessages[groqMessages.length-1];
      finalMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...groqMessages.slice(1,-1),
        { role: "user", content: [{ type: "text", text: last.content }, { type: "image_url", image_url: { url: image } }] }
      ];
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelToUse, messages: finalMessages, temperature: 0.85, max_tokens: 800 })
    });

    const data = await groqRes.json();
    if (!groqRes.ok) throw new Error(data.error?.message||'Groq error');

    let reply = data.choices[0].message.content;
    // Add Google Maps link for location queries
    const lastUserQuery = history.filter(m=>m.role==='user').pop()?.content || '';
    reply = addGoogleMapsLink(reply, lastUserQuery);

    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ reply: "Error: "+e.message });
  }
});

app.get('/api/health', (req,res)=>res.json({status:'LUMORA LIVE', owner:'John Theuri', url:'https://lumora-ai-ncmb.onrender.com', maps:'https://www.google.com/maps/search/'}));
app.get('*', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, ()=>console.log(`LUMORA LIVE ${PORT}`));
