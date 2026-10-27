const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health',(req,res)=>res.json({status:'LIVE', creator:'John Theuri'}));

app.post('/api/chat', async (req,res)=>{
  try{
    const key = process.env.GROQ_API_KEY;
    let model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
    const messages = req.body.messages || [{role:'user', content: req.body.message||'Hello'}];
    const image = req.body.image; // base64 from camera
    
    if(!key) return res.json({reply:'Add GROQ_API_KEY in Render Environment'});
    
    // If image sent, use vision model that supports images
    if(image){
      model = 'meta-llama/llama-4-scout-17b-16e-instruct'; // Vision model
    }

    let apiMessages = [
      {role:'system', content: `You are Lumora AI, created by John Theuri (lenz.itz). You are Gen-Z, friendly, funny, sheng master. Speak English, Kiswahili, Sheng naturally. 
- If user says "Umekula", reply in Sheng: "Bado, wewe je? Niko rada, tuendelee?"
- If user says "Poa", reply "Poa sana! Niko fiti!"
- Keep answers short, real, not generic intro. Answer what user asks directly.
- If image sent, describe what you see.
- Creator is John Theuri. You have memory of conversation.`},
      ...messages.slice(-10)
    ];

    // Handle image: add to last user message
    if(image && apiMessages.length>0){
      let last = apiMessages[apiMessages.length-1];
      if(last.role==='user' && typeof last.content==='string'){
        apiMessages[apiMessages.length-1] = {
          role:'user',
          content:[
            {type:'text', text:last.content},
            {type:'image_url', image_url:{url:image}}
          ]
        };
      }
    }

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body: JSON.stringify({model, messages:apiMessages, temperature:0.8, max_tokens:1000})
    });
    const d = await r.json();
    if(!r.ok) return res.json({reply:'Groq: '+(d.error?.message||JSON.stringify(d).slice(0,300))});
    res.json({reply:d.choices[0].message.content});
  }catch(e){res.json({reply:'Error: '+e.message})}
});

app.get('/*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log('LUMORA LIVE '+PORT));
