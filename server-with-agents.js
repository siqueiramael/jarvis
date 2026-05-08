import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir, readFile } from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Estado global: agente selecionado
let currentAgent = null;
let agentsList = [];

// ============================================
// CARREGAR AGENTES NA INICIALIZAÇÃO
// ============================================
async function loadAgents() {
  try {
    const agentsDir = join(__dirname, '.claude/agents');
    const files = await readdir(agentsDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    
    agentsList = await Promise.all(
      mdFiles.map(async (file) => {
        const content = await readFile(join(agentsDir, file), 'utf-8');
        const name = file.replace('.md', '');
        
        // Extrair título se tiver
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : name;
        
        return {
          id: name,
          name: title,
          file: file,
          systemPrompt: content
        };
      })
    );
    
    console.log(`[AGENTS] ✅ Carregados ${agentsList.length} agentes`);
    
    // Definir Orion como padrão
    currentAgent = agentsList.find(a => a.id === 'aios-master') || agentsList[0];
    console.log(`[AGENTS] 🎯 Agente padrão: ${currentAgent.name}`);
    
  } catch (err) {
    console.error('[AGENTS] ❌ Erro ao carregar agentes:', err.message);
    agentsList = [];
  }
}

// Endpoints
app.get('/api/agents', (req, res) => {
  res.json({
    agents: agentsList.map(a => ({ id: a.id, name: a.name })),
    current: currentAgent ? currentAgent.id : null
  });
});

app.post('/api/agents/select', (req, res) => {
  const { agentId } = req.body;
  const agent = agentsList.find(a => a.id === agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  currentAgent = agent;
  res.json({ success: true, agent: { id: agent.id, name: agent.name } });
});

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  
  const messages = [];
  if (currentAgent?.systemPrompt) {
    messages.push({ role: 'system', content: currentAgent.systemPrompt });
  }
  messages.push({ role: 'user', content: message });
  
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
  res.json({ reply: data.choices[0].message.content, agent: currentAgent?.name });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', agent: currentAgent?.name, agentsLoaded: agentsList.length });
});

loadAgents().then(() => {
  app.listen(PORT, () => console.log(`🚀 JARVIS v2.0 Agents - :${PORT} - ${agentsList.length} agentes`));
});
