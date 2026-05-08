import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

let currentAgent = null;
let agentsList = [];

const VAULT_PATH = join(__dirname, 'data/obsidian-vault');

// Carregar agentes
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

// ============================================
// OBSIDIAN: Buscar notas recursivamente
// ============================================
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
        
        // Buscar no título e conteúdo
        if (content.toLowerCase().includes(searchTerm.toLowerCase())) {
          // Extrair título
          const titleMatch = content.match(/^#\s+(.+)$/m);
          const title = titleMatch ? titleMatch[1] : entry.name.replace('.md', '');
          
          // Extrair snippet relevante
          const lines = content.split('\n');
          const matchLine = lines.find(l => l.toLowerCase().includes(searchTerm.toLowerCase()));
          const snippet = matchLine ? matchLine.substring(0, 200) : lines.slice(0, 3).join(' ').substring(0, 200);
          
          results.push({
            path: relativePath,
            title,
            snippet: snippet + '...'
          });
        }
      }
    }
  }
  
  await walkDir(VAULT_PATH);
  return results;
}

// ============================================
// OBSIDIAN: Ler nota específica
// ============================================
async function readNote(notePath) {
  const fullPath = join(VAULT_PATH, notePath);
  
  if (!existsSync(fullPath) || !fullPath.startsWith(VAULT_PATH)) {
    return null;
  }
  
  const content = await readFile(fullPath, 'utf-8');
  return content;
}

// ============================================
// ENDPOINTS OBSIDIAN
// ============================================
app.get('/api/obsidian/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q || q.length < 2) {
    return res.json({ results: [] });
  }
  
  try {
    const results = await searchNotes(q);
    res.json({ results, query: q, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/obsidian/note', async (req, res) => {
  const { path } = req.query;
  
  if (!path) {
    return res.status(400).json({ error: 'path required' });
  }
  
  try {
    const content = await readNote(path);
    
    if (!content) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    res.json({ path, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ENDPOINTS AGENTES
// ============================================
app.get('/api/agents', (req, res) => {
  res.json({
    agents: agentsList.map(a => ({ id: a.id, name: a.name })),
    current: currentAgent?.id
  });
});

app.post('/api/agents/select', (req, res) => {
  const { agentId } = req.body;
  const agent = agentsList.find(a => a.id === agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  currentAgent = agent;
  res.json({ success: true, agent: { id: agent.id, name: agent.name } });
});

// ============================================
// CHAT com RAG
// ============================================
app.post('/api/chat', async (req, res) => {
  const { message, useRAG = false, searchQuery } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  
  const messages = [];
  
  // System prompt do agente
  if (currentAgent?.systemPrompt) {
    messages.push({ role: 'system', content: currentAgent.systemPrompt });
  }
  
  // RAG: buscar contexto no vault
  if (useRAG && searchQuery) {
    try {
      const results = await searchNotes(searchQuery);
      
      if (results.length > 0) {
        const context = results.slice(0, 3).map(r => 
          `[${r.title}]: ${r.snippet}`
        ).join('\n\n');
        
        messages.push({
          role: 'system',
          content: `Contexto do Obsidian Vault:\n\n${context}`
        });
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
    res.json({ 
      reply: data.choices[0].message.content,
      agent: currentAgent?.name,
      ragUsed: useRAG && searchQuery
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    agent: currentAgent?.name,
    agentsLoaded: agentsList.length,
    vaultPath: VAULT_PATH
  });
});

loadAgents().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║  🚀 JARVIS v2.0 - RAG System          ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`📍 Server: :${PORT}`);
    console.log(`🤖 Agentes: ${agentsList.length}`);
    console.log(`📚 Vault: ${VAULT_PATH}`);
    console.log('');
  });
});
