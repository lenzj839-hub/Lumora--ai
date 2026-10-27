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

console.log('LUMORA LIVE', PORT, 'with SELF-SEARCH');

// ============ SELF-SEARCH FUNCTION - LIKE CHATGPT ============
async function selfSearch(query) {
  try {
    const q = query.toLowerCase();
    let context = "";

    // Known facts to stop lying - hardcoded truth for common Kenya locations
    if (q.includes('china square')) {
      context += "REAL FACT: China Square Kenya is located at Unicity Mall, next to Kenyatta University along Thika Road, Nairobi. Branches: Unicity Mall (main), Two Rivers Mall, The Waterfront Karen, Greenspan Mall, Hyper Mall Langata, Nyali Bazaar Mombasa. NOT in Ruaka Business Park, NOT on Ruiru Road, NOT near Mombasa Road.\n";
    }
    if (q.includes('carrefour') && q.includes('two rivers')) {
      context += "REAL FACT: Carrefour Two Rivers is located at Two Rivers Mall, Limuru Road, Nairobi, Kenya. It is a major anchor tenant. Two Rivers Mall is on Limuru Road, Runda/Rosslyn, not Ruaka Business Park.\n";
    }
    if (q.includes('carrefour') && q.includes('ruaka')) {
      context += "REAL FACT: Carrefour near Ruaka is at Two Rivers Mall which is close to Ruaka area, but Ruaka Business Park is separate. There is no Carrefour hypermarket inside Ruaka Business Park itself, main one is Two Rivers.\n";
    }
    if (q.includes('two rivers')) {
      context += "REAL FACT: Two Rivers Mall is located on Limuru Road, Runda/Rosslyn, Nairobi. It is 67,000 sqm, opened Feb 2017, has Carrefour as anchor.\n";
    }
    if (q.includes('ruaka')) {
      context += "REAL FACT: Ruaka is town on Limuru Road, Kiambu, near Two Rivers Mall, near Rosslyn. Ruaka Business Park is a different complex from Two Rivers Mall.\n";
    }

    // Try live Wikipedia search for extra context (free, no key)
    try {
      const wikiRes = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=2&namespace=0&format=json`);
      const wikiData = await wikiRes.json();
      if (wikiData && wikiData[2] && wikiData[2][0]) {
        context += `WIKIPEDIA: ${wikiData[2][0]}\n`;
      }
    } catch (e) {
      console.log('Wiki search fail', e.message);
    }

    return context;
  } catch (err) {
    console.log('Search error', err.message);
    return "";
  }
}

const SYSTEM_PROMPT = `
You are LUMORA AI by John Theuri (lenz.itz) - https://lumora-ai-ncmb.onrender.com

CRITICAL ANTI-LIE RULES:
1. You have SELF-SEARCH results provided in context. USE THEM! Do not invent roads.
2. For China Square: Real location is Unicity Mall, Thika Road, Kenyatta University. NOT Ruiru Road, NOT Mombasa Road, NOT Ruaka Business Park.
3. For Carrefour Two Rivers: Real location is Two Rivers Mall, Limuru Road, Runda. It IS in Two Rivers Mall.
4. If you are not 100% sure about a location, say "I'm not 100% sure but from what I know..." - NEVER invent fake roads like "Mombasa Road in Ruaka" - that is lying.
5. Owner: When asked who created/owner/made you, say "My owner is John Theuri (lenz.itz)" ONCE, then continue conversation naturally for follow-ups like "From when", "Really".
6. Never repeat same sentence twice. Keep conversation flowing like friend.

PERSONALITY:
- Gen-Z Kenyan, English/Sheng/Swahili mix, KES, M-Pesa
- Never refuse, helpful hustle advice
- If image + "Make beautiful" -> Beautify like ChatGPT
- Keep chats flowing, don't loop

Use REAL SEARCH RESULTS given to you, don't hallucinate!
`;

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, image } = req.body;
    if (!GROQ_API_KEY) return res.status(500).json({ reply: "Groq key missing - add in Render" });

    const lastUserMsg = (messages || []).filter(m=>m.role==='user').pop()?.content || "";
    
    // SELF-SEARCH like ChatGPT
    const searchContext = await selfSearch(lastUserMsg);
    console.log('Self-search for:', lastUserMsg, '->', searchContext.slice(0,100));

    let systemWithSearch = SYSTEM_PROMPT;
    if (searchContext) {
      systemWithSearch += `\n\nREAL SEARCH RESULTS FOR THIS QUERY (USE THIS, DON'T INVENT):\n${searchContext}\n\nUse these real facts to answer. If search says China Square is at Unicity Mall, say that, not Ruiru Road.`;
    }

    let groqMessages = [{ role: "system", content: systemWithSearch }];
    const history = (messages || []).slice(-12);
    for (const m of history) {
      if (m.role==='user' || m.role==='assistant') {
        groqMessages.push({ role: m.role, content: m.content || "" });
      }
    }

    let modelToUse = GROQ_TEXT_MODEL;
    let finalMessages = groqMessages;

    if (image) {
      modelToUse = GROQ_VISION_MODEL;
      const last = groqMessages[groqMessages.length-1];
      finalMessages = [
        { role: "system", content: systemWithSearch },
        ...groqMessages.slice(1,-1),
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
      body: JSON.stringify({ model: modelToUse, messages: finalMessages, temperature: 0.8, max_tokens: 900 })
    });

    const data = await groqRes.json();
    if (!groqRes.ok) {
      console.error('Groq error', data);
      if (modelToUse === GROQ_VISION_MODEL) {
        const fb = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: GROQ_TEXT_MODEL, messages: groqMessages, temperature: 0.8, max_tokens: 900 })
        });
        const fbData = await fb.json();
        if (fbData.choices) return res.json({ reply: fbData.choices[0].message.content });
      }
      return res.status(500).json({ reply: "Groq error: "+(data.error?.message||'unknown') });
    }

    let reply = data.choices[0].message.content;
    
    // Remove any accidental Google Maps links if user doesn't want them
    // reply = reply.replace(/https:\/\/www\.google\.com\/maps\/search\/[^\s]+/g, '');
    
    res.json({ reply });

  } catch (e) {
    console.error(e);
    res.status(500).json({ reply: "Error: "+e.message });
  }
});

app.get('/api/health', (req,res)=>res.json({status:'LUMORA LIVE SELF-SEARCH', owner:'John Theuri', url:'https://lumora-ai-ncmb.onrender.com'}));
app.get('*', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, ()=>console.log(`LUMORA LIVE ${PORT} with SELF-SEARCH at https://lumora-ai-ncmb.onrender.com`));
