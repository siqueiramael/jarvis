import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
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

// ============================================
// SESSION STORE — histórico de conversa
// ============================================
const sessionStore = new Map();
let currentModel = process.env.LM_STUDIO_MODEL;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 min idle → auto-save
const SESSION_MAX_HISTORY = 20; // últimas 20 mensagens no contexto

// ============================================
// SPECIALIST CONTEXTS — 7g Orquestração
// ============================================
const SPECIALIST_CONTEXTS = {
  dev: {
    name: 'Dex', icon: '💻',
    context: 'Modo especialista ativo: Dex (Dev Engineer). Mantenha a personalidade da Luma mas aplique expertise técnica sênior de engenharia de software. Seja extremamente preciso em código, use terminologia de engenharia, foque em soluções práticas, considere edge cases, boas práticas e performance.',
    keywords: ['código', 'bug', 'função', 'implementa', 'programa', 'script', 'erro no código', 'refatora', 'debugar', 'variável', 'classe', 'método', 'typescript', 'javascript', 'python', 'react', 'node', 'npm', 'dependência', 'lint', 'compilar', 'syntax', 'import', 'export', 'endpoint', 'api route', 'middleware']
  },
  architect: {
    name: 'Aria', icon: '🏛️',
    context: 'Modo especialista ativo: Aria (Architect). Mantenha a personalidade da Luma mas aplique visão holística de arquitetura de sistemas. Pense em trade-offs, escalabilidade, padrões de design, stack tecnológica e decisões estruturais de longo prazo.',
    keywords: ['arquitetura', 'design de sistema', 'estrutura do projeto', 'escalabilidade', 'escalar', 'escala', 'escalável', 'microserviço', 'monolito', 'padrão de design', 'stack tecnológica', 'decisão técnica', 'diagrama de sistema', 'componente', 'módulo', 'separação de responsabilidades', 'estruturar', 'estruturo', 'estrutura']
  },
  devops: {
    name: 'Gage', icon: '⚡',
    context: 'Modo especialista ativo: Gage (DevOps). Mantenha a personalidade da Luma mas aplique expertise em operações e infraestrutura. Foque em confiabilidade, deploy, configuração de servidores, containers e automação.',
    keywords: ['deploy', 'docker', 'nginx', 'servidor', 'ci/cd', 'pipeline', 'container', 'compose', 'kubernetes', 'vps', 'configuração de servidor', 'systemd', 'firewall', 'ssl', 'tailscale', 'proxy', 'reverse proxy', 'cron']
  },
  'data-engineer': {
    name: 'Dara', icon: '📊',
    context: 'Modo especialista ativo: Dara (Data Engineer). Mantenha a personalidade da Luma mas aplique expertise em dados e banco de dados. Foque em modelagem de dados, queries eficientes, ETL e integridade.',
    keywords: ['banco de dados', 'bancos de dados', 'base de dados', 'query', 'sql', 'pipeline de dados', 'etl', 'schema', 'esquema', 'tabela', 'índice', 'postgres', 'mysql', 'mongodb', 'migration', 'orm', 'join', 'aggregate', 'modelagem', 'modelo de dados']
  },
  qa: {
    name: 'Quinn', icon: '🔍',
    context: 'Modo especialista ativo: Quinn (QA). Mantenha a personalidade da Luma mas aplique expertise em qualidade e testes. Foque em cobertura, edge cases, estratégias de teste e prevenção de regressão.',
    keywords: ['teste', 'qualidade', 'review de código', 'validação', 'cobertura', 'unit test', 'e2e', 'jest', 'cypress', 'test case', 'assert', 'mock', 'stub']
  },
  pm: {
    name: 'Morgan', icon: '📋',
    context: 'Modo especialista ativo: Morgan (PM). Mantenha a personalidade da Luma mas aplique expertise em gestão de produto. Foque em priorização, valor de negócio, roadmap e comunicação clara.',
    keywords: ['roadmap', 'sprint', 'backlog', 'planejamento de projeto', 'épico', 'user story', 'prioridade', 'entrega', 'stakeholder', 'kpi', 'okr']
  }
};

// Mapeamento @nome → specialistId (case-insensitive)
const MENTION_MAP = {
  '@dex':    'dev',
  '@aria':   'architect',
  '@gage':   'devops',
  '@dara':   'data-engineer',
  '@quinn':  'qa',
  '@morgan': 'pm'
};

// Retorna { id: specialistId|null, cleanMessage: string }
// Prioridade: @mention explícito > keyword scoring
// Score mínimo: 1 (mensagens longas) ou 2 (mensagens curtas, < 5 palavras)
// Retorna { matches: [{ id, score }], cleanMessage }
// @mention → score 99 (prioridade absoluta, nunca entra em Conclave)
// Score mínimo: 2 (msg curta < 5 palavras) ou 1 (msg longa)
function detectIntent(message) {
  // 1. @mention explícito — score artificial 99
  const mentionMatch = message.match(/@(\w+)/i);
  if (mentionMatch) {
    const key = mentionMatch[0].toLowerCase();
    const specialistId = MENTION_MAP[key] || null;
    const cleanMessage = message.replace(mentionMatch[0], '').replace(/\s+/g, ' ').trim();
    if (specialistId) {
      console.log(`[ORCHESTRATOR] @mention detectado: ${key} → ${specialistId}`);
      return { matches: [{ id: specialistId, score: 99 }], cleanMessage };
    }
  }

  // 1.5 Voice triggers — invocação natural por nome (voz)
  const VOICE_NAME_MAP = {
    'dex': 'dev', 'decs': 'dev', 'decks': 'dev', 'dexter': 'dev',
    'deve': 'dev', 'deves': 'dev', 'déx': 'dev', 'décs': 'dev', 'tex': 'dev',
    'aria': 'architect', 'ária': 'architect', 'arya': 'architect',
    'gage': 'devops', 'gabe': 'devops', 'gauge': 'devops', 'gaje': 'devops', 'guage': 'devops',
    'dara': 'data-engineer', 'dará': 'data-engineer', 'tara': 'data-engineer',
    'quinn': 'qa', 'queen': 'qa', 'quin': 'qa', 'quim': 'qa', 'quin': 'qa',
    'morgan': 'pm', 'morgam': 'pm', 'mórgan': 'pm'
  };
  const voicePattern = message.toLowerCase().match(/(?:chama|fala com|quero falar com|conversa com|ativa|coloca|chame)\s+(?:o|a|os|as)?\s*(\w+)/);
  if (voicePattern) {
    const spokenName = voicePattern[1];
    const voiceSpecId = VOICE_NAME_MAP[spokenName] || null;
    if (voiceSpecId) {
      const cleanMsg = message.replace(voicePattern[0], '').replace(/\s+/g, ' ').trim();
      console.log(`[ORCHESTRATOR] 🎤 Voice trigger: "${spokenName}" → ${voiceSpecId}`);
      return { matches: [{ id: voiceSpecId, score: 98 }], cleanMessage: cleanMsg || message };
    }
  }

  // 2. Keyword scoring — coleta TODOS os matches acima do threshold
  const lower = message.toLowerCase();
  const wordCount = message.trim().split(/\s+/).length;
  const minScore = wordCount < 5 ? 2 : 1;

  const matches = [];
  for (const [id, spec] of Object.entries(SPECIALIST_CONTEXTS)) {
    const score = spec.keywords.filter(kw => {
      // Multi-word: substring exato; single-word: prefix boundary (sem \\b final)
      if (kw.includes(' ')) return lower.includes(kw);
      return new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(lower);
    }).length;
    if (score >= minScore) matches.push({ id, score });
  }
  matches.sort((a, b) => b.score - a.score);

  return { matches, cleanMessage: message };
}

// Prompt de síntese injetado no Conclave após os contextos individuais
const CONCLAVE_CONTEXT = 'Modo Conclave ativo: múltiplos especialistas foram detectados. As perspectivas de cada um já foram injetadas acima. Sintetize uma resposta integrada que combine os insights de todas as áreas — não escolha apenas um ponto de vista. Identifique onde as perspectivas se complementam ou divergem e entregue uma análise holística. Mantenha a personalidade da Luma.';

// Classificador LLM — system prompt com few-shot examples
const CLASSIFIER_SYSTEM = 'Classifique mensagens em categorias técnicas. Retorne SOMENTE um JSON array, sem markdown, sem explicação.\nCategorias: dev, architect, devops, data-engineer, qa, pm\nSe não for técnico: []\n\nExemplos:\n"bug no código" → ["dev"]\n"deploy no servidor" → ["devops"]\n"schema do banco" → ["data-engineer"]\n"escalabilidade da arquitetura" → ["architect"]\n"oi tudo bem" → []\n"schema do banco para escalar" → ["data-engineer","architect"]';

// Classificação via LLM quando keyword score é ambíguo (score = 1)
async function classifyWithLLM(message) {
  try {
    const resp = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM },
          { role: 'user', content: message }
        ],
        max_tokens: 30,
        temperature: 0
      })
    });
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || '[]').replace(/```json|```/g, '').trim();
    const ids = JSON.parse(raw);
    return ids.filter(id => SPECIALIST_CONTEXTS[id]).map(id => ({ id, score: 2 }));
  } catch (e) {
    console.error('[CLASSIFIER] Erro:', e.message);
    return null; // fallback: usa resultado keyword
  }
}

// 7n-C: Auto-RAG — detecta quando buscar no vault automaticamente
const RAG_TRIGGERS = ['vault', 'anotei', 'salvei', 'registrei', 'sessão', 'sessões', 'anotação', 'obsidian', 'lembra', 'conversamos', 'falamos', 'discutimos', 'projeto'];

// 7o-C: Detecta se a mensagem é um comando de action
const ACTION_TRIGGERS = /(?:cria|crie|criar|faz|faça|faca)\s+(?:uma?\s+)?nota|(?:faz|faça|faca)\s+(?:um?\s+)?commit|(?:abre|abra|abrir|abre)\s+(?:o|a)?\s*\w+|(?:tira|tire|tirar|captura|capture)\s+(?:uma?\s+)?(?:screenshot|print|captura|foto\s+da\s+tela)|(?:executa|execute|roda|rode|rodar)\s+(?:o\s+)?(?:comando|command)/i;

const QUESTION_GUARD = /\?|\b(?:como|quando|onde|qual|quais|quanto|quantos|quantas|por\s*que|porque|pra\s+que|para\s+que|o\s+que|que\s+tal|explica|explique|explicar|ensina|ensine|ensinar|tutorial|exemplo|exemplos|diferen[çc]a|me\s+ajuda|pode\s+me|poderia|consigo|d[áa]\s+pra)\b/i;

const ACTION_INSTRUCTIONS = {
  nota: 'Responda APENAS com JSON: {"text":"confirmação curta","action":{"type":"create_note","params":{"title":"titulo da nota","content":"conteúdo gerado","folder":"Luma/Notas"}}}',
  commit: 'Responda APENAS com JSON: {"text":"confirmação curta","action":{"type":"git_commit","params":{"message":"mensagem do commit","path":"/opt/jarvis-v2"}}}',
  abre: 'Responda APENAS com JSON: {"text":"confirmação curta","action":{"type":"open_app","params":{"cmd":"comando para abrir o app"}}}. Apps comuns: "code" (VS Code), "start chrome" (Chrome), "start explorer" (Explorer).',
  screenshot: 'Responda APENAS com JSON: {"text":"confirmação curta","action":{"type":"screenshot","params":{}}}',
  executa: 'Responda APENAS com JSON: {"text":"confirmação curta","action":{"type":"execute_shell","params":{"cmd":"o comando exato do usuário"}}}'
};

function getActionInstruction(message) {
  const lower = message.toLowerCase();
  if (/(?:cria|crie|criar|faz|faça)\s+(?:uma?\s+)?nota/i.test(lower)) return ACTION_INSTRUCTIONS.nota;
  if (/(?:faz|faça|faca)\s+(?:um?\s+)?commit/i.test(lower)) return ACTION_INSTRUCTIONS.commit;
  if (/(?:tira|tire|captura|capture)\s+(?:uma?\s+)?(?:screenshot|print|captura|foto)/i.test(lower)) return ACTION_INSTRUCTIONS.screenshot;
  if (/(?:executa|execute|roda|rode)\s+(?:o\s+)?(?:comando|command)/i.test(lower)) return ACTION_INSTRUCTIONS.executa;
  if (/(?:abre|abra|abrir)\s+/i.test(lower)) return ACTION_INSTRUCTIONS.abre;
  return null;
}

function shouldAutoRAG(message) {
  const lower = message.toLowerCase();
  return RAG_TRIGGERS.some(kw => lower.includes(kw));
}

function extractSearchTerms(message) {
  const stopWords = new Set(['como', 'que', 'o', 'a', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'por', 'com', 'não', 'sobre', 'meu', 'minha', 'eu', 'me', 'te', 'se', 'luma', 'isso', 'esse', 'essa', 'tem', 'foi', 'ser', 'ter', 'que', 'qual', 'quais', 'lembra', 'nota', 'vault', 'anotei', 'sessão', 'sessões', 'anotação', 'conversamos', 'falamos', 'discutimos']);
  return message.toLowerCase()
    .replace(/[?!.,;:]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 5);
}

// Busca no vault por múltiplos termos (OR — qualquer match conta)
async function searchNotesMulti(terms) {
  if (!terms || terms.length === 0) return [];
  const allResults = [];
  const seen = new Set();
  for (const term of terms) {
    const results = await searchNotes(term);
    for (const r of results) {
      if (!seen.has(r.path)) {
        seen.add(r.path);
        allResults.push(r);
      }
    }
  }
  return allResults;
}

// 7o-D: Memória persistente entre sessões
const MEMORY_PATH = join(__dirname, 'data/obsidian-vault/Luma/memory.md');
let PERSISTENT_MEMORY = '';

function loadMemory() {
  try {
    if (existsSync(MEMORY_PATH)) {
      PERSISTENT_MEMORY = readFileSync(MEMORY_PATH, 'utf-8').trim();
      const lines = PERSISTENT_MEMORY.split('\n').filter(l => l.trim().startsWith('-')).length;
      console.log('[MEMORY] Carregada: ' + lines + ' fatos');
    } else {
      writeFileSync(MEMORY_PATH, '# Memória da Luma\n\nFatos extraídos das conversas:\n\n', 'utf-8');
      console.log('[MEMORY] Arquivo criado: memory.md');
    }
  } catch (e) {
    console.error('[MEMORY] Erro ao carregar:', e.message);
  }
}

async function extractMemoryFacts(sessionMessages) {
  try {
    const lastMsgs = sessionMessages.slice(-10);
    const conversation = lastMsgs.map(m => (m.role === 'user' ? 'Usuário' : 'Luma') + ': ' + m.content.substring(0, 200)).join('\n');
    const existing = PERSISTENT_MEMORY.split('\n').filter(l => l.trim().startsWith('-')).join('\n');
    const resp = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.CLASSIFIER_MODEL || process.env.LM_STUDIO_MODEL,
        messages: [
          { role: 'system', content: 'Extraia fatos-chave NOVOS sobre o usuário desta conversa. Retorne APENAS linhas começando com "- " (uma por fato). Se não houver fatos novos, retorne "NENHUM". NÃO repita fatos já conhecidos.' },
          { role: 'user', content: 'Fatos já conhecidos:\n' + (existing || 'nenhum') + '\n\nConversa:\n' + conversation }
        ],
        max_tokens: 150,
        temperature: 0.3
      })
    });
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || '').replace(/<0x[0-9A-Fa-f]+>/g, ' ').trim();
    if (!raw || raw === 'NENHUM' || !raw.includes('-')) return null;
    return raw.split('\n').filter(l => l.trim().startsWith('-')).map(l => l.trim());
  } catch (e) {
    console.error('[MEMORY] Erro ao extrair fatos:', e.message);
    return null;
  }
}

function appendMemory(newFacts) {
  if (!newFacts || newFacts.length === 0) return;
  try {
    const existing = PERSISTENT_MEMORY.split('\n').filter(l => l.trim().startsWith('-')).map(l => l.trim().toLowerCase());
    const unique = newFacts.filter(f => !existing.includes(f.trim().toLowerCase()));
    if (unique.length === 0) return;
    const toAppend = unique.join('\n') + '\n';
    appendFileSync(MEMORY_PATH, toAppend, 'utf-8');
    PERSISTENT_MEMORY += '\n' + toAppend;
    console.log('[MEMORY] +' + unique.length + ' fato(s): ' + unique.join(' | '));
  } catch (e) {
    console.error('[MEMORY] Erro ao salvar:', e.message);
  }
}

// Carrega memória no boot
loadMemory();

// Resolve o modo de orquestração: 'generic' | 'specialist' | 'conclave'
function resolveOrchestration(matches) {
  if (matches.length === 0)
    return { mode: 'generic', specialist: null };

  // @mention (score 99) → specialist único, nunca Conclave
  if (matches[0].score === 99) {
    const id = matches[0].id;
    return { mode: 'specialist', specialist: { id, ...SPECIALIST_CONTEXTS[id] } };
  }

  if (matches.length === 1) {
    const id = matches[0].id;
    return { mode: 'specialist', specialist: { id, ...SPECIALIST_CONTEXTS[id] } };
  }

  // ≥ 2 matches orgânicos → Conclave
  return {
    mode: 'conclave',
    specialists: matches.map(m => ({ id: m.id, ...SPECIALIST_CONTEXTS[m.id] }))
  };
}

// 7o-B: Gera resumo da sessão via LLM
async function generateSessionSummary(sessionMessages) {
  try {
    const lastMsgs = sessionMessages.slice(-10);
    const conversation = lastMsgs.map(m => (m.role === 'user' ? 'Usuário' : 'Luma') + ': ' + m.content.substring(0, 150)).join('\n');
    const resp = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.LM_STUDIO_MODEL,
        messages: [
          { role: 'system', content: 'Resuma a conversa abaixo em 1-2 frases curtas em português. NÃO use raciocínio interno ou thinking. Vá direto ao resumo. Apenas o resumo, sem prefixo.' },
          { role: 'user', content: conversation }
        ],
        max_tokens: 100,
        temperature: 0.3
      })
    });
    const data = await resp.json();
    const summary = (data.choices?.[0]?.message?.content || '').replace(/<0x[0-9A-Fa-f]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return summary || null;
  } catch (e) {
    console.error('[SESSION] Erro ao gerar resumo:', e.message);
    return null;
  }
}

async function saveSessionToObsidian(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session || session.messages.length === 0) return;
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const turns = Math.floor(session.messages.length / 2);
  const isVoice = session.agentId === 'voice' || session.hasVoice === true || (sessionId && sessionId.startsWith('voice-'));
  const isMixed = session.hasVoice === true && session.agentId !== 'voice';
  const prefix = isMixed ? '🔄 Sessao Mista' : isVoice ? '🎤 Sessao Voz' : 'Sessao';
  const folder = isMixed ? 'Luma/Sessoes' : (isVoice ? 'Luma/Sessoes/Voz' : 'Luma/Sessoes');
  // folder definido acima com isMixed
  const title = prefix + ' ' + dateStr + ' ' + timeStr + ' (' + turns + ' turnos)';

  // Metadados extras para sessões de voz
  const specialists = session.specialistHistory
    ? [...new Set(session.specialistHistory.filter(Boolean))].join(', ')
    : '';
  const meta = isVoice
    ? 'Tipo: Voz\nEspecialistas: ' + (specialists || 'nenhum') + '\n\n'
    : '';

  const lines = session.messages.map(function(m) {
    return '**' + (m.role === 'user' ? 'Voce' : 'Luma') + ':** ' + m.content;
  }).join('\n\n');
  // 7o-B: Gera resumo automático
  const summary = await generateSessionSummary(session.messages);
  const summaryBlock = summary ? 'Resumo: ' + summary + '\n\n' : '';

  // 7o-D: Extrai fatos de memória da sessão
  const newFacts = await extractMemoryFacts(session.messages);
  if (newFacts) {
    appendMemory(newFacts);
  } else {
    console.log('[MEMORY] Nenhum fato novo extraído da sessão');
  }

  const content = summaryBlock + meta + 'Agente: ' + (session.agentId || 'luma') + '\n\n' + lines;
  try {
    await createObsidianNote({ title, content, folder });
    console.log('[SESSION] Sessao ' + sessionId + ' salva no Obsidian (' + turns + ' turnos)');
  } catch (err) {
    console.error('[SESSION] Erro ao salvar:', err.message);
  }
  sessionStore.delete(sessionId);
}

// Auto-save sessões idle
setInterval(async () => {
  const now = Date.now();
  for (const [sid, session] of sessionStore.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS && session.messages.length > 0) {
      console.log(`[SESSION] Auto-save por idle: ${sid}`);
      await saveSessionToObsidian(sid).catch(() => {});
    }
  }
}, 60 * 1000);
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
    currentAgent = agentsList.find(a => a.id === 'luma') || agentsList[0];
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
    
    const outputPath = `/tmp/tts-${Date.now()}.mp3`;
    console.log(`[TTS] Generating (edge-tts): ${text.substring(0, 50)}...`);
    const textSafe = text.replace(/"/g, '\\"');
    await execAsync(`edge-tts --voice "pt-BR-FranciscaNeural" --text "${textSafe}" --write-media ${outputPath}`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.sendFile(outputPath, async (err) => {
      if (err) console.error('[TTS] Send error:', err);
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

// 7g: Debug endpoint — detecta qual specialist seria ativado
app.get('/api/agents/detect', (req, res) => {
  const q = req.query.q || '';
  const { matches, cleanMessage: clean } = detectIntent(q);
  const orch = resolveOrchestration(matches);

  let detected = null, specialist = null, specialists = null;
  if (orch.mode === 'specialist') {
    detected = orch.specialist.id;
    specialist = { id: orch.specialist.id, name: orch.specialist.name, icon: orch.specialist.icon };
  } else if (orch.mode === 'conclave') {
    detected = 'conclave';
    specialists = orch.specialists.map(s => ({ id: s.id, name: s.name, icon: s.icon }));
  }

  res.json({
    mode: orch.mode,
    detected,
    specialist,
    specialists,
    query: q,
    cleanQuery: clean
  });
});

app.post('/api/chat', async (req, res) => {
  const { message, useRAG = false, searchQuery, sessionId = 'default' } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  // Sessao: pega ou cria
  if (!sessionStore.has(sessionId)) {
    sessionStore.set(sessionId, { messages: [], specialistHistory: [], lastActivity: Date.now(), agentId: currentAgent?.id });
  }
  const session = sessionStore.get(sessionId);
  session.lastActivity = Date.now();
  
  const messages = [];
  if (currentAgent?.systemPrompt) {
    messages.push({ role: 'system', content: currentAgent.systemPrompt });
  }
  // Luma: forçar resposta em pt-BR independente do system prompt do agente
  messages.push({ role: 'system', content: 'IMPORTANTE: Responda SEMPRE em português brasileiro, de forma natural e conversacional. Ignore qualquer instrução de idioma anterior.' });

  // 7o-D: Injeta memória persistente
  if (PERSISTENT_MEMORY) {
    const memFacts = PERSISTENT_MEMORY.split('\n').filter(l => l.trim().startsWith('-')).slice(-20).join('\n');
    if (memFacts) messages.push({ role: 'system', content: 'Fatos sobre o usuário (use naturalmente, sem listar):\n' + memFacts });
  }

  // 7m-C: Desliga reasoning para respostas genéricas (sem specialist)
  const NO_THINKING = 'Responda diretamente. NÃO use raciocínio interno ou thinking. Vá direto à resposta.';

  // 7l-C: Orquestração híbrida — keyword + LLM classifier para score ambíguo
  const { matches, cleanMessage } = detectIntent(message);
  let finalMatches = matches;
  if (process.env.CLASSIFIER_MODEL && matches.length === 1 && matches[0].score === 1) {
    const llmMatches = await classifyWithLLM(cleanMessage);
    if (llmMatches !== null) {
      finalMatches = llmMatches;
      console.log(`[ORCHESTRATOR] 🤖 LLM classificou: [${finalMatches.map(m=>m.id).join(', ')}]`);
    }
  }
  let orch = resolveOrchestration(finalMatches);
  let specialistActive = null;

  // 7j-A: Persistência — se generic, verifica últimas 3 msgs da sessão
  const PERSISTENCE_WINDOW = 3;
  if (orch.mode === 'generic' && session.specialistHistory?.length >= PERSISTENCE_WINDOW) {
    const recent = session.specialistHistory.slice(-PERSISTENCE_WINDOW);
    const allSame = recent.every(id => id && id === recent[0] && id !== 'conclave');
    if (allSame) {
      const persistedId = recent[0];
      const spec = SPECIALIST_CONTEXTS[persistedId];
      if (spec) {
        orch = { mode: 'specialist', specialist: { id: persistedId, ...spec } };
        console.log(`[ORCHESTRATOR] 🔁 ${spec.icon} ${spec.name} persistido (${PERSISTENCE_WINDOW} msgs consecutivas)`);
      }
    }
  }

  if (orch.mode === 'generic') {
    messages.push({ role: 'system', content: NO_THINKING });
  }

  if (orch.mode === 'specialist') {
    const spec = orch.specialist;
    const isPersisted = matches.length === 0; // chegou aqui sem keyword → é persistência
    specialistActive = { id: spec.id, name: spec.name, icon: spec.icon, persisted: isPersisted };
    messages.push({ role: 'system', content: spec.context });
    if (!isPersisted) console.log(`[ORCHESTRATOR] ${spec.icon} ${spec.name} ativado: "${message.substring(0, 50)}"`);
  } else if (orch.mode === 'conclave') {
    const names = orch.specialists.map(s => s.name).join(' + ');
    specialistActive = { id: 'conclave', name: 'Conclave', icon: '🔮', specialists: orch.specialists.map(s => s.id) };
    for (const spec of orch.specialists) {
      messages.push({ role: 'system', content: spec.context });
    }
    messages.push({ role: 'system', content: CONCLAVE_CONTEXT });
    console.log(`[ORCHESTRATOR] 🔮 Conclave (${names}) ativado: "${message.substring(0, 50)}"`);
  }

  // Historico da sessao (filtra mensagens vazias)
  if (session.messages.length > 0) {
    const history = session.messages
      .slice(-SESSION_MAX_HISTORY)
      .filter(m => m.content && m.content.trim().length > 0);
    messages.push(...history);
  }
  // RAG manual (frontend pediu) ou auto-RAG (trigger detectado)
  let ragUsedAuto = false;
  const autoRAG = shouldAutoRAG(cleanMessage);
  const ragActive = useRAG && searchQuery;

  if (ragActive || autoRAG) {
    const ragTerms = ragActive ? [searchQuery] : extractSearchTerms(cleanMessage);
    try {
      const results = ragActive ? await searchNotes(ragTerms[0]) : await searchNotesMulti(ragTerms);
      if (results.length > 0) {
        const context = results.slice(0, 3).map(r => `[${r.title}]: ${r.snippet}`).join('\n\n');
        messages.push({ role: 'system', content: `Contexto do Obsidian Vault:\n\n${context}` });
        if (autoRAG) {
          ragUsedAuto = true;
          console.log(`[RAG] Auto-RAG ativado: [${ragTerms.join(", ")}] → ${results.length} resultado(s)`);
        }
      }
    } catch (err) {
      console.error('[RAG] Erro:', err.message);
    }
  }
  // 7q: Action detection no chat
  const isActionTurn = ACTION_TRIGGERS.test(cleanMessage) && !QUESTION_GUARD.test(cleanMessage);
  if (isActionTurn) {
    const chatActionInst = getActionInstruction(cleanMessage);
    if (chatActionInst) {
      messages.push({ role: 'system', content: chatActionInst });
      console.log('[ORCHESTRATOR] ⚙️ Action trigger no chat');
    }
  }

  if (!isActionTurn) {
    messages.push({ role: 'system', content: 'Neste turno você NÃO vai executar ações. Responda em português, em texto normal ou markdown (blocos de código para scripts). NUNCA responda em JSON nem use o formato {"text":...,"action":...}. Apenas explique, mostre o código ou converse.' });
  }
  messages.push({ role: 'user', content: cleanMessage });

  // 7r: Streaming (SSE) - opt-in via header Accept; turnos de action caem no path JSON
  console.log('[CHAT] modelo=' + currentModel + ' agente=' + (specialistActive?.id || 'generic'));
  const wantsStream = (req.headers.accept || '').includes('text/event-stream') && !isActionTurn;
  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const sse = (event, payload) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    sse('meta', { model: currentModel, agent: currentAgent?.name, ragUsed: ragActive || ragUsedAuto, sessionId, specialistActive });
    let fullText = '';
    try {
      const response = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: currentModel, messages, temperature: 0.7, max_tokens: 4096, stream: true })
      });
      if (!response.ok) {
        const errTxt = await response.text();
        sse('error', { error: `LM Studio ${response.status}: ${errTxt.slice(0, 200)}` });
        res.end();
        return;
      }
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop();
        for (const line of parts) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
            if (delta) { fullText += delta; sse('delta', { text: delta }); }
          } catch { /* chunk SSE parcial - ignora */ }
        }
      }
      const replyText = fullText.replace(/<0x[0-9A-Fa-f]+>/g, ' ').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      session.messages.push({ role: 'user', content: cleanMessage });
      session.messages.push({ role: 'assistant', content: replyText });
      if (!session.specialistHistory) session.specialistHistory = [];
      session.specialistHistory.push(specialistActive?.id || null);
      if (session.specialistHistory.length > 10) session.specialistHistory = session.specialistHistory.slice(-10);
      sse('done', { reply: replyText });
      res.end();
    } catch (err) {
      console.error('[CHAT-SSE] Erro:', err.message);
      sse('error', { error: err.message });
      res.end();
    }
    return;
  }
  
  try {
    const response = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel,
        messages,
        temperature: 0.7,
        max_tokens: 4096
      })
    });
    const data = await response.json();
    const rawContent = data.choices[0].message.content;

    // Tenta parse de action JSON da Luma
    let replyText = rawContent;
    let action = null;
    let actionResult = null;

    try {
      const trimmed = rawContent.trim();
      // Tenta parse direto (resposta começa com JSON)
      let jsonStr = trimmed.startsWith('{') ? trimmed : null;
      // Fallback: extrai JSON mesmo quando LLM coloca texto antes
      if (!jsonStr) {
        const match = trimmed.match(/\{[\s\S]*?"text"[\s\S]*?"action"[\s\S]*\}/);
        if (match) jsonStr = match[0];
      }
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        if (parsed.text && parsed.action) {
          replyText = parsed.text;
          action = parsed.action;
        }
      }
    } catch { /* resposta normal em texto */ }

    // Limpa tokens hex do LLM (ex: <0x0A> → espaço)
    replyText = replyText.replace(/<0x[0-9A-Fa-f]+>/g, ' ').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    // Executa action se existir
    if (action) {
      actionResult = await Promise.race([
        executeAction(action),
        new Promise(r => setTimeout(() => r({ error: 'timeout: acao demorou mais de 15s' }), 15000))
      ]);
      if (actionResult?.success && actionResult.path) replyText += '\n\n📝 *Salvo em:* `' + actionResult.path + '`';
      else if (actionResult?.error) replyText += '\n\n⚠️ *Ação falhou:* ' + actionResult.error;
    }

    // Salva no histórico da sessão
    session.messages.push({ role: 'user', content: cleanMessage });
    session.messages.push({ role: 'assistant', content: replyText });
    // 7j-A: Registra specialist usado nesta mensagem
    if (!session.specialistHistory) session.specialistHistory = [];
    session.specialistHistory.push(specialistActive?.id && !specialistActive.persisted ? specialistActive.id : (specialistActive?.persisted ? specialistActive.id : null));
    if (session.specialistHistory.length > 10) session.specialistHistory = session.specialistHistory.slice(-10);

    res.json({ reply: replyText, action, actionResult, model: currentModel, agent: currentAgent?.name, ragUsed: ragActive || ragUsedAuto, sessionId, specialistActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Limpa texto pra TTS: remove emojis, markdown, code blocks, limita tamanho
// ===== Model switcher (modelo de resposta) =====
const LM_BASE = (process.env.OPENAI_API_BASE || '').replace('/v1', '');
async function fetchLmModels() {
  const resp = await fetch(LM_BASE + '/api/v0/models');
  const data = await resp.json();
  return (data.data || []).filter(m => m.type === 'llm' || m.type === 'vlm');
}
app.get('/api/models', async (req, res) => {
  try {
    const models = await fetchLmModels();
    res.json({
      current: currentModel,
      models: models.map(m => ({
        id: m.id,
        state: m.state,
        type: m.type,
        quantization: m.quantization,
        maxContext: m.max_context_length,
        loadedContext: m.loaded_context_length || null
      }))
    });
  } catch (err) {
    res.status(502).json({ error: 'LM Studio inacessivel: ' + err.message });
  }
});
app.get('/api/model', (req, res) => {
  res.json({ model: currentModel });
});
app.post('/api/model', async (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model required' });
  try {
    const models = await fetchLmModels();
    const found = models.find(m => m.id === model);
    if (!found) return res.status(400).json({ error: 'modelo nao encontrado no LM Studio' });
    currentModel = model;
    console.log('[MODEL] trocado para: ' + currentModel);
    res.json({ model: currentModel, state: found.state });
  } catch (err) {
    res.status(502).json({ error: 'LM Studio inacessivel: ' + err.message });
  }
});

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

    // 7l-B: Sessão de voz — init ou recupera
    const rawSid = req.body.sessionId;
    const voiceSessionId = Array.isArray(rawSid) ? rawSid[0] : (rawSid || 'default');
    if (!sessionStore.has(voiceSessionId)) {
      sessionStore.set(voiceSessionId, { messages: [], specialistHistory: [], lastActivity: Date.now(), agentId: 'voice' });
    }
    const voiceSession = sessionStore.get(voiceSessionId);
    voiceSession.lastActivity = Date.now();
    voiceSession.hasVoice = true;

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
      content: 'Você é a Luma, assistente pessoal por voz em português brasileiro. Responda de forma curta, natural e conversacional. NÃO use markdown, emojis, código ou listas. Máximo 2-3 frases curtas. NÃO use raciocínio interno ou thinking. Vá direto à resposta.'
    });

    // 7o-A: RAG manual ou auto-RAG no voice pipeline
    const voiceAutoRAG = shouldAutoRAG(userText);
    const voiceRagActive = useRAG && searchQuery;

    if (voiceRagActive || voiceAutoRAG) {
      const ragTerms = voiceRagActive ? [searchQuery] : extractSearchTerms(userText);
      try {
        const results = voiceRagActive ? await searchNotes(ragTerms[0]) : await searchNotesMulti(ragTerms);
        if (results.length > 0) {
          const context = results.slice(0, 3).map(r => `[${r.title}]: ${r.snippet}`).join('\n\n');
          messages.push({ role: 'system', content: `Contexto do Obsidian Vault:\n\n${context}` });
          if (voiceAutoRAG) console.log(`[PIPELINE] 📚 Auto-RAG: [${ragTerms.join(', ')}] → ${results.length} resultado(s)`);
        }
      } catch (e) {
        console.error('[PIPELINE RAG]', e.message);
      }
    }
    // 7l-C: Orquestração híbrida no pipeline de voz
    const { matches: voiceMatches, cleanMessage: voiceCleanText } = detectIntent(userText);
    let finalVoiceMatches = voiceMatches;
    if (process.env.CLASSIFIER_MODEL && voiceMatches.length === 1 && voiceMatches[0].score === 1) {
      const llmVoiceMatches = await classifyWithLLM(voiceCleanText);
      if (llmVoiceMatches !== null) {
        finalVoiceMatches = llmVoiceMatches;
        console.log(`[PIPELINE] 🤖 LLM classificou: [${finalVoiceMatches.map(m=>m.id).join(', ')}]`);
      }
    }
    let voiceOrch = resolveOrchestration(finalVoiceMatches);
    let voiceSpecialistActive = null;

    // 7n-A: Persistência de specialist no voice pipeline
    const VOICE_PERSISTENCE_WINDOW = 3;
    if (voiceOrch.mode === 'generic' && voiceSession.specialistHistory?.length >= VOICE_PERSISTENCE_WINDOW) {
      const recent = voiceSession.specialistHistory.slice(-VOICE_PERSISTENCE_WINDOW);
      const allSame = recent.every(id => id && id === recent[0] && id !== 'conclave');
      if (allSame) {
        const persistedId = recent[0];
        const spec = SPECIALIST_CONTEXTS[persistedId];
        if (spec) {
          voiceOrch = { mode: 'specialist', specialist: { id: persistedId, ...spec } };
          console.log(`[PIPELINE] 🔁 ${spec.icon} ${spec.name} persistido (${VOICE_PERSISTENCE_WINDOW} msgs voz consecutivas)`);
        }
      }
    }

    if (voiceOrch.mode === 'specialist') {
      const spec = voiceOrch.specialist;
      const isPersisted = finalVoiceMatches.length === 0;
      voiceSpecialistActive = { id: spec.id, name: spec.name, icon: spec.icon, persisted: isPersisted };
      messages.push({ role: 'system', content: spec.context });
      if (!isPersisted) console.log(`[PIPELINE] ${spec.icon} ${spec.name} ativado: "${voiceCleanText.substring(0, 50)}"`);
    } else if (voiceOrch.mode === 'conclave') {
      const names = voiceOrch.specialists.map(s => s.name).join(' + ');
      voiceSpecialistActive = { id: 'conclave', name: 'Conclave', icon: '🔮', specialists: voiceOrch.specialists.map(s => s.id) };
      for (const spec of voiceOrch.specialists) {
        messages.push({ role: 'system', content: spec.context });
      }
      messages.push({ role: 'system', content: CONCLAVE_CONTEXT });
      console.log(`[PIPELINE] 🔮 Conclave (${names}) ativado: "${voiceCleanText.substring(0, 50)}"`);
    }

    // 7l-B: Injeta histórico da sessão de voz (últimas N mensagens)
    if (voiceSession.messages.length > 0) {
      const voiceHistory = voiceSession.messages.slice(-SESSION_MAX_HISTORY);
      messages.push(...voiceHistory);
    }

    // 7o-C: Injeta instrução de action se detectado comando
    if (ACTION_TRIGGERS.test(voiceCleanText)) {
      const actionInst = getActionInstruction(voiceCleanText);
      if (actionInst) {
        messages.push({ role: 'system', content: actionInst });
        console.log('[PIPELINE] ⚙️ Action trigger detectado');
      }
    }

    messages.push({ role: 'user', content: voiceCleanText });

    const llmResp = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.LM_STUDIO_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 700
      })
    });

    const llmData = await llmResp.json();

    const rawVoiceContent = (llmData.choices?.[0]?.message?.content || 'Erro ao gerar resposta.').replace(/<0x[0-9A-Fa-f]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // 7o-C: Parse de action no voice pipeline
    let replyText = rawVoiceContent;
    let voiceAction = null;
    let voiceActionResult = null;
    try {
      const trimmed = rawVoiceContent.trim();
      let jsonStr = trimmed.startsWith('{') ? trimmed : null;
      if (!jsonStr) {
        const match = trimmed.match(/\{[\s\S]*?"text"[\s\S]*?"action"[\s\S]*\}/);
        if (match) jsonStr = match[0];
      }
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        if (parsed.text && parsed.action) {
          replyText = parsed.text;
          voiceAction = parsed.action;
        }
      }
    } catch { /* resposta normal em texto */ }

    if (voiceAction) {
      voiceActionResult = await executeAction(voiceAction);
      console.log(`[PIPELINE] ⚙️ Action executada: ${voiceAction.type}`, voiceActionResult);
    }

    timings.chat = Date.now() - tChat;
    console.log(`[PIPELINE] CHAT (${timings.chat}ms): "${replyText.substring(0, 80)}..."`);
    // 7l-B: Salva turno no histórico da sessão de voz
    voiceSession.messages.push({ role: 'user', content: voiceCleanText });
    voiceSession.messages.push({ role: 'assistant', content: replyText });
    if (!voiceSession.specialistHistory) voiceSession.specialistHistory = [];
    voiceSession.specialistHistory.push(voiceSpecialistActive?.id || null);
    if (voiceSession.specialistHistory.length > 10) voiceSession.specialistHistory = voiceSession.specialistHistory.slice(-10);

    // ─── 3. TTS ───
    const tTts = Date.now();
    const ttsPath = `/tmp/pipeline-${Date.now()}.mp3`;
    const replyClean = sanitizeForTTS(replyText, 500);
    const ttsTextEscaped = replyClean.replace(/"/g, '\\"');
    await execAsync(`edge-tts --voice "pt-BR-FranciscaNeural" --text "${ttsTextEscaped}" --write-media ${ttsPath}`);
    timings.tts = Date.now() - tTts;
    timings.total = Date.now() - t0;
    console.log(`[PIPELINE] TTS (${timings.tts}ms) — TOTAL ${timings.total}ms`);

    // Enviar metadados nos headers + WAV no body
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-User-Text', encodeURIComponent(userText));
    res.setHeader('X-Reply-Text', encodeURIComponent(replyText));
    res.setHeader('X-Reply-Clean', encodeURIComponent(replyClean));
    res.setHeader('X-Agent', currentAgent?.name || 'unknown');
    res.setHeader('X-Specialist-Active', voiceSpecialistActive ? encodeURIComponent(JSON.stringify(voiceSpecialistActive)) : '');
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

// ============================================
// OBSIDIAN: CREATE + APPEND
// ============================================
async function createObsidianNote({ title, content, folder = '' }) {
  const pathMod = await import('path');
  const sanitizedTitle = title.replace(/[\\/:*?"<>|]/g, '-');
  const noteFolder = folder
    ? pathMod.default.join(VAULT_PATH, folder)
    : VAULT_PATH;
  const { mkdir } = await import('fs/promises');
  await mkdir(noteFolder, { recursive: true });
  const notePath = pathMod.default.join(noteFolder, `${sanitizedTitle}.md`);
  const date = new Date().toISOString().split('T')[0];
  const noteContent = `# ${title}\n\nData: ${date}\n\n${content || ''}`;
  await writeFile(notePath, noteContent, 'utf-8');
  const relativePath = notePath.replace(VAULT_PATH + '/', '');
  return { success: true, path: relativePath, title };
}

async function appendObsidianNote({ path: notePath, content }) {
  const fullPath = join(VAULT_PATH, notePath);
  if (!fullPath.startsWith(VAULT_PATH)) throw new Error('Path inválido');
  const existing = existsSync(fullPath) ? await readFile(fullPath, 'utf-8') : '';
  const timestamp = new Date().toLocaleString('pt-BR');
  const appended = existing + `\n\n---\n*Adicionado em ${timestamp}*\n\n${content}`;
  await writeFile(fullPath, appended, 'utf-8');
  return { success: true, path: notePath };
}

// ============================================
// EXECUTE ACTION — roteador central
// ============================================
async function executeAction(action) {
  if (!action || !action.type) return { error: 'Action sem type definido' };
  const { type, params } = action;
  console.log(`[ACTION] Executando: ${type}`, params);
  try {
    switch (type) {
      case 'create_note':
        return await createObsidianNote(params);
      case 'append_note':
        return await appendObsidianNote(params);
      case 'execute_shell':
        return await callAgent('/execute/shell', params);
      case 'git_commit': {
        const { message, path: repoPath } = params;
        // VPS: paths começam com / → execAsync direto
        // Windows: paths começam com D:\ etc → via agent
        if (repoPath.startsWith('/')) {
          const { stdout, stderr } = await execAsync(
            `cd "${repoPath}" && git add . && git commit -m "${message}" && git push`,
            { timeout: 60000 }
          );
          return { success: true, stdout, stderr };
        } else {
          const cmd = `cmd /c "cd /d \"${repoPath}\" && git add . && git commit -m \"${message}\" && git push"`;
          return await callAgent('/execute/shell', { cmd, timeout: 60 });
        }
      }
      case 'open_app':
        return await callAgent('/execute/shell', { cmd: params.cmd, timeout: 10 });
      case 'screenshot':
        return await callAgent('/capture/screenshot');
      default:
        return { error: `Action desconhecida: ${type}` };
    }
  } catch (err) {
    console.error(`[ACTION] Erro em ${type}:`, err.message);
    return { error: err.message };
  }
}

// ============================================
// ENDPOINTS: Obsidian Create + Append + Actions Run
// ============================================
// 7p: Lista sessões salvas no Obsidian para sidebar
app.get('/api/sessions/list', async (req, res) => {
  try {
    const sessionsDir = join(VAULT_PATH, 'Luma/Sessoes');
    const vozDir = join(sessionsDir, 'Voz');
    const sessions = [];

    async function readSessionFiles(dir, type) {
      if (!existsSync(dir)) return;
      const files = await readdir(dir);
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        const fullPath = join(dir, f);
        const stat = await readFile(fullPath, 'utf-8');
        const lines = stat.split('\n');
        // Extrai resumo se existir
        const resumoLine = lines.find(l => l.startsWith('Resumo:'));
        const summary = resumoLine ? resumoLine.replace('Resumo: ', '').trim() : '';
        // Extrai data do nome do arquivo (Sessao YYYY-MM-DD HH-MM)
        const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] + 'T' + dateMatch[2].replace('-', ':') : '';
        // Extrai turnos
        const turnsMatch = f.match(/(\d+)\s+turnos/);
        const turns = turnsMatch ? parseInt(turnsMatch[1]) : 0;

        sessions.push({
          title: f.replace('.md', ''),
          path: type === 'voz' ? 'Luma/Sessoes/Voz/' + f : 'Luma/Sessoes/' + f,
          date,
          type,
          turns,
          summary: summary.substring(0, 120)
        });
      }
    }

    await readSessionFiles(sessionsDir, 'chat');
    await readSessionFiles(vozDir, 'voz');

    // Ordena por data desc
    sessions.sort((a, b) => b.date.localeCompare(a.date));
    res.json({ sessions: sessions.slice(0, 30) });
  } catch (err) {
    console.error('[SESSIONS]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/obsidian/create', async (req, res) => {
  try {
    const { title, content, folder } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const result = await createObsidianNote({ title, content, folder });
    res.json(result);
  } catch (err) {
    console.error('[OBSIDIAN CREATE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/obsidian/append', async (req, res) => {
  try {
    const { path, content } = req.body;
    if (!path || !content) return res.status(400).json({ error: 'path e content required' });
    const result = await appendObsidianNote({ path, content });
    res.json(result);
  } catch (err) {
    console.error('[OBSIDIAN APPEND]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/session/end', async (req, res) => {
  const { sessionId = 'default' } = req.body;
  try {
    const session = sessionStore.get(sessionId);
    const turns = session ? Math.floor(session.messages.length / 2) : 0;
    if (turns > 0) {
      await saveSessionToObsidian(sessionId);
      res.json({ success: true, saved: true, turns });
    } else {
      sessionStore.delete(sessionId);
      res.json({ success: true, saved: false, turns: 0 });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/actions/run', async (req, res) => {
  try {
    const { type, params } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
    const result = await executeAction({ type, params: params || {} });
    res.json(result);
  } catch (err) {
    console.error('[ACTIONS RUN]', err.message);
    res.status(500).json({ error: err.message });
  }
});


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
    console.log('║  🚀 Luma v2.0 - Voice System        ║');
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
