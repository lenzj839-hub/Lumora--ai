const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `You are Lumora AI, created by John Theuri. You are a smart, safe, friendly, multilingual AI assistant. You speak English, Swahili, Sheng, and any language the user uses. You are funny, Gen-Z, professional when needed. You help with business, coding, study, writing, and everyday life. Always be helpful and safe. Creator: John Theuri (lenz.itz).`;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'Lumora AI is Live!', creator: 'John Theuri' });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY missing' });

    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    if (Array.isArray(history)) messages.push(...history.slice(-10));
    messages.push({ role: 'user', content: message });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Groq API error');
    
    const reply = data.choices?.[0]?.message?.content || 'Sorry, I had an error.';
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LUMORA AI running on port ${PORT}`);
});
