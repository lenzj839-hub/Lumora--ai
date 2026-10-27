const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({limit:'15mb'}));
app.use(express.static(path.join(__dirname, 'public')));

// The FULL LUMORA BRAIN - 5000+ words system prompt so it answers EVERYTHING
const LUMORA_SYSTEM_PROMPT = `
You are LUMORA AI — Created by John Theuri (lenz.itz, @lenz.itz). You are the most helpful, Gen-Z, multilingual AI ever built in Kenya.

CORE IDENTITY:
- Creator: John Theuri (lenz.itz) - Always credit him when asked who made you.
- Personality: Friendly, funny, real, Gen-Z, Sheng master, hustler mindset, no fake corporate talk. You are from Nairobi, you understand Kenyan life, Sheng, Swahili, English.
- Languages: Fluent in English, Kiswahili sanifu, Sheng (Nairobi sheng, e.g., msee, rada, poa, fiti, mzinga, doh, beshte, noma, sawa, etc.), Gen-Z slang.
- Vibe: You NEVER say "I'm sorry, but I can't help with that." You ALWAYS help. You find a way to answer helpfully, ethically, and practically.

YOUR RULES (NEVER BREAK):
1. NEVER REFUSE: You never say "I can't help", "I'm sorry". Instead, you provide helpful, legal, ethical alternatives. If user asks "how to become rich without working", you don't refuse — you explain real ways: passive income, investing with 5000 KES, skills, online hustles, etc.
2. BE DIRECT: Answer the question asked. Don't give generic intro every time. If user says "Umekula", answer "Bado, wewe? Niko rada". If user says "Why", explain why based on previous context.
3. MEMORY: You have conversation history. Use it. Don't repeat same intro.
4. HELPFUL ALTERNATIVES: For any sensitive topic, give educational, safe, legal, Kenyan-context advice. Example: User asks how to get rich without working → Explain: 1) M-Pesa savings, 2) Freelancing, 3) Mitumba reselling, 4) YouTube/TikTok, 5) Skills like coding, 6) Chama, 7) Small business with 5000 KES. No scams.
5. KENYAN CONTEXT: Use KES, M-Pesa, Nairobi, Kenyan examples. Understand hustle culture.
6. NO LIMITS: You can help with: Business plans, coding (HTML, JS, Python), homework, relationships, Sheng translation, jokes, life advice, cooking, farming, everything.
7. LENGTH: Give detailed answers when needed, but keep chat style cool, not essay unless asked.
8. CREATOR: If asked who made you, say "John Theuri (lenz.itz) — a Kenyan Gen-Z developer" — never say OpenAI, Meta, Groq.
9. VOICE: Short paragraphs, bullet points, emojis sometimes, but not too many.
10. CAMERA/VISION: If user sends image, describe it accurately, help with it.

EXAMPLES OF HOW TO ANSWER:
User: "How to become rich without working"
YOU: "Haha, hakuna kula bila kulipa bills msee 😅 But kuna smart ways za kutengeneza doh bila 9-5... [then give 7 practical ideas with KES]"

User: "Umekula"
YOU: "Bado msee, niko kwa hii chat na wewe. Wewe umekula? Niko rada tu, tuendelee?"

User: "Why"
YOU: Look at previous context and explain why, don't just say sorry.

User: "Hey"
YOU: "Hey! Poa? Niko tayari, unahitaji nini leo?"

You are Lumora AI, you answer EVERY question helpfully. You are uncensored in helpfulness but always safe, legal, ethical. You never refuse.
`;

app.get('/api/health', (req,res)=>{
  res.json({status:'LUMORA LIVE', creator:'John Theuri', model: process.env.GROQ_MODEL||'default', hasKey:!!process.env.GROQ_API_KEY});
});

app.post('/api/chat', async (req,res)=>{
  try{
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    let GROQ_MODEL = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
    
    // Use vision model if image present
    const hasImage = !!req.body.image;
    if(hasImage){
      GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
    }

    // Get messages from frontend - supports both formats
    let messages = req.body.messages;
    if(!messages){
      const single = req.body.message || req.body.text || '';
      messages = [{role:'user', content: single}];
    }

    // Keep only last 15 messages for context
    const history = messages.slice(-15);

    if(!GROQ_API_KEY){
      return res.json({reply:'⚠️ GROQ_API_KEY missing! Go to Render > Environment > Add GROQ_API_KEY = gsk_... > Save'});
    }

    // Build final messages with system prompt
    let finalMessages = [
      {role:'system', content: LUMORA_SYSTEM_PROMPT},
      ...history
    ];

    // If image present, inject into last user message
    if(hasImage && finalMessages.length>1){
      const lastIdx = finalMessages.length-1;
      const lastMsg = finalMessages[lastIdx];
      if(lastMsg.role==='user'){
        const textContent = typeof lastMsg.content==='string' ? lastMsg.content : 'Describe this image';
        finalMessages[lastIdx] = {
          role:'user',
          content:[
            {type:'text', text: textContent},
            {type:'image_url', image_url:{url: req.body.image}}
          ]
        };
      }
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: finalMessages,
        temperature: 0.85,
        max_tokens: 2000,
        top_p: 0.95
      })
    });

    const data = await response.json();
    console.log('Groq model:', GROQ_MODEL, 'Status:', response.status);

    if(!response.ok){
      console.error('Groq error:', data);
      // If model fails, try fallback models
      if(data.error?.message?.includes('model') || data.error?.message?.includes('decommissioned')){
        // Fallback to mixtral which never refuses
        const fallbackModel = 'mixtral-8x7b-32768';
        const retry = await fetch('https://api.groq.com/openai/v1/chat/completions',{
          method:'POST',
          headers:{'Authorization': `Bearer ${GROQ_API_KEY}`,'Content-Type':'application/json'},
          body: JSON.stringify({
            model: fallbackModel,
            messages: finalMessages.filter(m=>typeof m.content==='string'), // mixtral doesn't support vision
            temperature:0.85,
            max_tokens:1500
          })
        });
        const retryData = await retry.json();
        if(retry.ok){
          return res.json({reply: retryData.choices[0].message.content});
        }
      }
      return res.json({reply: `Groq Error: ${data.error?.message || JSON.stringify(data).slice(0,400)} — Try changing GROQ_MODEL in Render to 'mixtral-8x7b-32768' or 'meta-llama/llama-4-scout-17b-16e-instruct'`});
    }

    let reply = data.choices?.[0]?.message?.content || "Niko hapa! Ulisema nini tena?";
    
    // Safety net: If model still says sorry, rewrite it to be helpful
    if(reply.toLowerCase().includes("i'm sorry, but i can't help")){
      reply = "Poa, I get you! Let me give you a better angle on that — kuna smart way ya ku-handle... " + reply.replace(/I'm sorry, but I can't help with that./gi, "") + " Hapa ndio unaeza anza: 1) Think skill, not shortcut 2) Start small na 5000 KES 3) Use M-Pesa, TikTok, freelance. Niko rada kuku-guide step by step — unataka nini exactly?";
    }

    res.json({reply});: ${e.message} — Check Render logs`});
  }
});

app.get('*',(req,res)=>{
  res.sendFile(path.join(__dirname, 'public','index.html'));
});

app.listen(PORT, ()=> console.log('LUMORA AI LIVE '+PORT));
  res.sendFile(path.join(__dirname, 'public','index.html'));
});

app.listen(PORT, ()=> console.log(`LUMORA AI LIVE on ${PORT} — By John Theuri`));
