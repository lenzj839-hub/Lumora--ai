const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({limit:'15mb'}));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM = `You are LUMORA AI by John Theuri (lenz.itz). Gen-Z, Sheng master, friendly. NEVER say sorry can't help. ALWAYS help with practical Kenyan advice, KES, M-Pesa, Sheng. Answer directly.`;

app.get('/api/health',(req,res)=>res.json({status:'LIVE', creator:'John Theuri'}));

app.post('/api/chat', async (req,res)=>{
  try{
    const key = process.env.GROQ_API_KEY;
    let model = process.env.GROQ_MODEL || 'mixtral-8x7b-32768';
    const messages = req.body.messages || [{role:'user', content: req.body.message||'Hello'}];
    const image = req.body.image;
    if(!key) return res.json({reply:'GROQ_API_KEY missing'});
    if(image) model = 'meta-llama/llama-4-scout-17b-16e-instruct';
    let finalMessages = [{role:'system', content: SYSTEM}, ...messages.slice(-12)];
    if(image){
      const lastIdx = finalMessages.length-1;
      const txt = typeof finalMessages[lastIdx].content==='string' ? finalMessages[lastIdx].content : 'Describe image';
      finalMessages[lastIdx] = {role:'user', content:[{type:'text', text:txt},{type:'image_url', image_url:{url:image}}]};
    }
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body: JSON.stringify({model, messages:finalMessages, temperature:0.85, max_tokens:1500})
    });
    const d = await r.json();
    if(!r.ok) return res.json({reply:`Groq Error: ${d.error?.message||'model error'}`});
    res.json({reply: d.choices[0].message.content});
  }catch(e){res.json({reply:'Error: '+e.message})}
});

app.get('*',(req,res)=>{res.sendFile(path.join(__dirname,'public','index.html'))});
app.listen(PORT,()=>console.log('LUMORA LIVE '+PORT));
