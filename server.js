import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import multer from 'multer';

dotenv.config();

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Multer para upload de áudio
const upload = multer({ dest: '/tmp/' });

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

let currentAgent = null;
let agentsList = [];
const VAULT_PATH = join(__dirname, 'data/obsidian-vault');
const WHISPER_PATH = join(__dirname, 'whisper.cpp/build/bin/whisper-cli');
const WHISPER_MODEL = join(__dirname, 'whisper.cpp/models/ggml-medium.bin');
const PIPER_PATH = join(__dirname, 'piper-tts/piper');
const PIPER_MODEL = join(__dirname, 'piper-tts/pt_BR-cadu-medium.onnx');

// [Código anterior de loadAgents, searchNotes, readNote...]
async function loadAgents() {
  try {
    const agentsDir = join(__dirname, '.claude/agents');
    const files = await readdir(agentsDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    agentsList = await Promise.all(
      mdFiles.map(async (file) => {
        const content = await readFile(join(agentsDir, file), 'utf-8');
        const name = file.replace('.md', '');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : name;
        return { id: name, name: title, file, systemPrompt: content };
      })
    );
    currentAgent = agentsList.find(a => a.id === 'aios-master') || agentsList[0];
    console.log(`[AGENTS] ✅ ${agentsList.length} agentes`);
  } catch (err) {
    console.error('[AGENTS] ❌', err.message);
  }
}

async function searchNotes(searchTerm) {
  const results = [];
  async function walkDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walkDir(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8');
        const relativePath = fullPath.replace(VAULT_PATH + '/', '');
        if (content.toLowerCase().includes(searchTerm.toLowerCase())) {
          const titleMatch = content.match(/^#\s+(.+)$/m);
          const title = titleMatch ? titleMatch[1] : entry.name.replace('.md', '');
          const lines = content.split('\n');
          const matchLine = lines.find(l => l.toLowerCase().includes(searchTerm.toLowerCase()));
          const snippet = matchLine ? matchLine.substring(0, 200) : lines.slice(0, 3).join(' ').substring(0, 200);
          results.push({ path: relativePath, title, snippet: snippet + '...' });
        }
      }
    }
  }
  await walkDir(VAULT_PATH);
  return results;
}

async function readNote(notePath) {
  const fullPath = join(VAULT_PATH, notePath);
  if (!existsSync(fullPath) || !fullPath.startsWith(VAULT_PATH)) return null;
  return await readFile(fullPath, 'utf-8');
}

// ============================================
// VOICE ENDPOINTS
// ============================================

// ============================================
// STT helper: chama Whisper Windows (GPU) com fallback pro whisper.cpp local
// ============================================
async function transcribeAudio(audioPath, language = 'pt') {
  const whisperUrl = process.env.WHISPER_URL;

  // Caminho A: Whisper Windows (preferencial — GPU)
  if (whisperUrl) {
    try {
      const { readFile } = await import('fs/promises');
      const path = await import('path');

      // Ler arquivo em buffer e criar Blob (FormData nativo Node 18+)
      const buffer = await readFile(audioPath);
      const blob = new Blob([buffer], { type: 'audio/wav' });

      const form = new FormData();
      form.append('audio', blob, path.basename(audioPath));
      form.append('language', language);

      const resp = await fetch(`${whisperUrl}/transcribe`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60000)
      });

      if (resp.ok) {
        const data = await resp.json();
        console.log(`[STT-Windows] ${data.elapsed_ms}ms → "${data.text.substring(0, 60)}..."`);
        return { text: data.text || '', source: 'windows-gpu', elapsed: data.elapsed_ms };
      } else {
        const errBody = await resp.text().catch(() => 'no body');
        console.error('[STT-Windows] HTTP', resp.status, 'body:', errBody.substring(0, 300), '— caindo para fallback CPU');
      }
    } catch (err) {
      console.error('[STT-Windows] Falhou:', err.message, '— caindo para fallback CPU');
    }
  }

  // Caminho B: whisper.cpp local (fallback)
  console.log('[STT-Local] Usando whisper.cpp CPU (lento)');
  // Converter pra WAV 16k mono primeiro
  const wavPath = `${audioPath}.wav`;
  await execAsync(`ffmpeg -y -i ${audioPath} -ar 16000 -ac 1 -c:a pcm_s16le ${wavPath} 2>&1`);

  const { stdout } = await execAsync(
    `${WHISPER_PATH} -m ${WHISPER_MODEL} -f ${wavPath} --language ${language} --no-timestamps`
  );

  const { unlink } = await import('fs/promises');
  await unlink(wavPath).catch(() => {});

  const lines = stdout.split('\n');
  const text = (lines.find(l => l.trim() && !l.includes('[') && !l.includes('whisper_')) || '').trim();
  return { text, source: 'cpu-local', elapsed: null };
}

// STT: Audio → Text
app.post('/api/voice/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file' });

    const audioPath = req.file.path;
    console.log(`[STT] Processing: ${audioPath}`);

    const result = await transcribeAudio(audioPath, 'pt');
    await unlink(audioPath).catch(() => {});

    res.json({ text: result.text, source: result.source, elapsed_ms: result.elapsed });
  } catch (err) {
    console.error('[STT] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// TTS: Text → Audio
app.post('/api/voice/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }
    
    const outputPath = `/tmp/tts-${Date.now()}.wav`;
    console.log(`[TTS] Generating: ${text.substring(0, 50)}...`);
    
    // Executar Piper
    await execAsync(
      `echo "${text}" | ${PIPER_PATH} --model ${PIPER_MODEL} --output_file ${outputPath}`
    );
    
    // Enviar áudio
    res.sendFile(outputPath, async (err) => {
      if (err) console.error('[TTS] Send error:', err);
      // Limpar arquivo após envio
      try { await unlink(outputPath); } catch {}
    });
    
  } catch (err) {
    console.error('[TTS] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// [Resto dos endpoints: /api/agents, /api/chat, /api/obsidian/*, /api/health...]
app.get('/api/agents', (req, res) => {
  res.json({ agents: agentsList.map(a => ({ id: a.id, name: a.name })), current: currentAgent?.id });
});

app.post('/api/agents/select', (req, res) => {
  const { agentId } = req.body;
  const agent = agentsList.find(a => a.id === agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  currentAgent = agent;
  res.json({ success: true, agent: { id: agent.id, name: agent.name } });
});

app.get('/api/obsidian/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ results: [] });
  try {
    const results = await searchNotes(q);
    res.json({ results, query: q, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/obsidian/note', async (req, res) => {
  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'path required' });
  try {
    const content = await readNote(path);
    if (!content) return res.status(404).json({ error: 'Note not found' });
    res.json({ path, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { message, useRAG = false, searchQuery } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  
  const messages = [];
  if (currentAgent?.systemPrompt) {
    messages.push({ role: 'system', content: currentAgent.systemPrompt });
  }
  // Luma: forçar resposta em pt-BR independente do system prompt do agente
  messages.push({ role: 'system', content: 'IMPORTANTE: Responda SEMPRE em português brasileiro, de forma natural e conversacional. Ignore qualquer instrução de idioma anterior.' });
  if (useRAG && searchQuery) {
    try {
      const results = await searchNotes(searchQuery);
      if (results.length > 0) {
        const context = results.slice(0, 3).map(r => `[${r.title}]: ${r.snippet}`).join('\n\n');
        messages.push({ role: 'system', content: `Contexto do Obsidian Vault:\n\n${context}` });
      }
    } catch (err) {
      console.error('[RAG] Erro:', err.message);
    }
  }
  messages.push({ role: 'user', content: message });
  
  try {
    const response = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.LM_STUDIO_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 500
      })
    });
    const data = await response.json();
    res.json({ reply: data.choices[0].message.content, agent: currentAgent?.name, ragUsed: useRAG && searchQuery });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Limpa texto pra TTS: remove emojis, markdown, code blocks, limita tamanho
function sanitizeForTTS(text, maxLen = 500) {
  let t = text || '';
  t = t.replace(/```[\s\S]*?```/g, ''); // code blocks
  t = t.replace(/`[^`]*`/g, ''); // inline code
  t = t.replace(/[*_~#>]/g, ''); // markdown chars
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // links
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ''); // emojis
  t = t.replace(/<0x[0-9A-Fa-f]+>/g, ''); // bytes weird
  t = t.replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
  if (t.length > maxLen) {
    const cut = t.substring(0, maxLen);
    const lastDot = cut.lastIndexOf('.');
    t = lastDot > maxLen * 0.6 ? cut.substring(0, lastDot + 1) : cut + '...';
  }
  return t;
}

// ============================================
// VOICE PIPELINE: STT → CHAT → TTS (tudo em um)
// ============================================
app.post('/api/voice/pipeline', upload.single('audio'), async (req, res) => {
  const t0 = Date.now();
  const timings = {};

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file' });
    }

    const audioPath = req.file.path;
    const useRAG = req.body.useRAG === 'true';
    const searchQuery = req.body.searchQuery || '';

    // ─── 1. STT (via helper: Windows GPU preferencial) ───
    const tStt = Date.now();
    console.log(`[PIPELINE] STT processando: ${audioPath}`);

    const sttResult = await transcribeAudio(audioPath, 'pt');
    const userText = sttResult.text;
    timings.stt = Date.now() - tStt;
    timings.sttSource = sttResult.source;

    await unlink(audioPath).catch(() => {});

    if (!userText) {
      return res.status(400).json({ error: 'STT returned empty', timings });
    }
    console.log(`[PIPELINE] STT (${timings.stt}ms): "${userText}"`);

    // ─── 2. CHAT (LLM) ───
    const tChat = Date.now();
    const messages = [];

    // Modo voz: prompt curto e conversacional (não usa system prompt do agente)
    messages.push({
      role: 'system',
      content: 'Você é a Luma, assistente pessoal por voz em português brasileiro. Responda de forma curta, natural e conversacional. NÃO use markdown, emojis, código ou listas. Máximo 2-3 frases curtas.'
    });

    if (useRAG && searchQuery) {
      try {
        const results = await searchNotes(searchQuery);
        if (results.length > 0) {
          const context = results.slice(0, 3).map(r => `[${r.title}]: ${r.snippet}`).join('\n\n');
          messages.push({ role: 'system', content: `Contexto do Obsidian Vault:\n\n${context}` });
        }
      } catch (e) {
        console.error('[PIPELINE RAG]', e.message);
      }
    }

    messages.push({ role: 'user', content: userText });

    const llmResp = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.LM_STUDIO_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 300
      })
    });

    const llmData = await llmResp.json();
    const replyText = llmData.choices?.[0]?.message?.content || 'Erro ao gerar resposta.';
    timings.chat = Date.now() - tChat;
    console.log(`[PIPELINE] CHAT (${timings.chat}ms): "${replyText.substring(0, 80)}..."`);

    // ─── 3. TTS ───
    const tTts = Date.now();
    const ttsPath = `/tmp/pipeline-${Date.now()}.wav`;
    const replyClean = sanitizeForTTS(replyText, 500);
    const ttsTextEscaped = replyClean.replace(/"/g, '\\"');

    await execAsync(
      `echo "${ttsTextEscaped}" | ${PIPER_PATH} --model ${PIPER_MODEL} --output_file ${ttsPath}`
    );
    timings.tts = Date.now() - tTts;
    timings.total = Date.now() - t0;
    console.log(`[PIPELINE] TTS (${timings.tts}ms) — TOTAL ${timings.total}ms`);

    // Enviar metadados nos headers + WAV no body
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-User-Text', encodeURIComponent(userText));
    res.setHeader('X-Reply-Text', encodeURIComponent(replyText));
    res.setHeader('X-Reply-Clean', encodeURIComponent(replyClean));
    res.setHeader('X-Agent', currentAgent?.name || 'unknown');
    res.setHeader('X-Timing-Stt', timings.stt);
    res.setHeader('X-Timing-Chat', timings.chat);
    res.setHeader('X-Timing-Tts', timings.tts);
    res.setHeader('X-Timing-Total', timings.total);

    res.sendFile(ttsPath, async (err) => {
      if (err) console.error('[PIPELINE] sendFile:', err);
      try { await unlink(ttsPath); } catch {}
    });

  } catch (err) {
    console.error('[PIPELINE] Error:', err);
    res.status(500).json({ error: err.message, timings });
  }
});


// ─── LOCAL AGENT (Phase 7a) ──────────────────────────────────────────────
async function callAgent(endpoint, payload = null) {
  const agentUrl = process.env.JARVIS_AGENT_URL;
  const agentToken = process.env.JARVIS_AGENT_TOKEN;
  if (!agentUrl) throw new Error('JARVIS_AGENT_URL not configured');
  const resp = await fetch(`${agentUrl}${endpoint}`, {
    method: payload ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-agent-token': agentToken },
    ...(payload && { body: JSON.stringify(payload) })
  });
  if (!resp.ok) throw new Error(`Agent ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

app.post('/api/agent/execute', async (req, res) => {
  try {
    const { cmd, timeout = 30 } = req.body;
    if (!cmd) return res.status(400).json({ error: 'cmd required' });
    const result = await callAgent('/execute/shell', { cmd, timeout });
    res.json(result);
  } catch (err) {
    console.error('[AGENT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agent/screenshot', async (req, res) => {
  try {
    const result = await callAgent('/capture/screenshot');
    res.json(result);
  } catch (err) {
    console.error('[AGENT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agent/file/read', async (req, res) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });
    res.json(await callAgent('/filesystem/read', { path }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agent/file/list', async (req, res) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });
    res.json(await callAgent('/filesystem/list', { path }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    agent: currentAgent?.name,
    agentsLoaded: agentsList.length,
    vaultPath: VAULT_PATH,
    voice: {
      whisper: existsSync(WHISPER_PATH),
      piper: existsSync(PIPER_PATH)
    }
  });
});

loadAgents().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║  🚀 JARVIS v2.0 - Voice System        ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`📍 Server: :${PORT}`);
    console.log(`🤖 Agentes: ${agentsList.length}`);
    console.log(`📚 Vault: ${VAULT_PATH}`);
    console.log(`🎤 Whisper: ${existsSync(WHISPER_PATH) ? '✅' : '❌'}`);
    console.log(`🔊 Piper: ${existsSync(PIPER_PATH) ? '✅' : '❌'}`);
    console.log('');
  });
});
