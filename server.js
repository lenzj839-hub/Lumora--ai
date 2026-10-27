const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req,res)=>{
  res.json({status:'LIVE', creator:'John Theuri'});
});

app.post('/api/chat', async (req,res)=>{
  try{
    const key = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    const text = req.body.message || 'hi';
    if(!key) return res.json({reply:'Add GROQ_API_KEY in Render Environment'});
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body: JSON.stringify({model, messages:[{role:'system',content:'You are Lumora AI by John Theuri. Helpful, funny, Gen-Z, speaks English, Swahili, Sheng.'},{role:'user',content:text}], temperature:0.7, max_tokens:800})
    });
    const d = await r.json();
    if(!r.ok) return res.json({reply:'Groq: '+(d.error?.message||JSON.stringify(d))});
    res.json({reply:d.choices[0].message.content});
  }catch(e){res.json({reply:'Error: '+e.message})}
});

app.get('*',(req,res)=>{res.sendFile(path.join(__dirname,'public','index.html'))});
app.listen(PORT,()=>console.log('LUMORA LIVE '+PORT));
