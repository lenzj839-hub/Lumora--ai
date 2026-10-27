const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req,res)=>{
  res.json({status:'Lumora LIVE', creator:'John Theuri', hasKey: !!process.env.GROQ_API_KEY});
});

app.post('/api/chat', async (req,res)=>{
  try{
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    const userText = req.body.message || 'Hello';
    
    if(!GROQ_API_KEY){
      return res.json({reply: 'GROQ_API_KEY missing! Add it in Render > Environment > Save'});
    }

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{'Authorization':'Bearer '+GROQ_API_KEY,'Content-Type':'application/json'},
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages:[
          {role:'system', content:'You are Lumora AI, created by John Theuri. You are helpful, friendly, funny, Gen-Z. Speak English, Swahili, Sheng.'},
          {role:'user', content: userText}
        ],
        temperature: 0.7,
        max_tokens: 800
      })
    });

    const d = await r.json();
    if(!r.ok){
      return res.json({reply: 'Groq Error: '+(d.error?.message || JSON.stringify(d))});
    }
    res.json({reply: d.choices[0].message.content});
  }catch(e){
    res.json({reply: 'Server Error: '+e.message});
  }
});

// FIXED FOR EXPRESS 5 - use /* not *
app.get('/*',(req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.listen(PORT, ()=> console.log('LUMORA running on '+PORT));
