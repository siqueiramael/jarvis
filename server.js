import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ============================================
// ENDPOINT CHAT (chama LM Studio local)
// ============================================

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const lmStudioUrl = process.env.OPENAI_API_BASE || 'http://100.112.73.46:1234/v1';
    const model = process.env.LM_STUDIO_MODEL || 'openhermes-2.5-neural-chat-7b-v3-2-7b';

    console.log(`[CHAT] Chamando LM Studio: ${lmStudioUrl}`);
    console.log(`[CHAT] Mensagem: ${message}`);

    const response = await fetch(`${lmStudioUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: message }],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[CHAT] LM Studio error:', error);
      return res.status(500).json({ error: 'LM Studio error', details: error });
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;

    console.log(`[CHAT] Resposta: ${reply}`);

    res.json({ 
      reply: reply,
      model: model,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('[CHAT] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    lmStudio: process.env.OPENAI_API_BASE,
    model: process.env.LM_STUDIO_MODEL
  });
});

// Start
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║     🚀 JARVIS v2.0 - Chat Server      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(`📍 Servidor: http://localhost:${PORT}`);
  console.log(`🧠 LM Studio: ${process.env.OPENAI_API_BASE}`);
  console.log(`📦 Modelo: ${process.env.LM_STUDIO_MODEL}`);
  console.log('');
  console.log('🎯 Endpoints:');
  console.log('   POST /api/chat');
  console.log('   GET  /api/health');
  console.log('');
});
