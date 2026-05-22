#!/usr/bin/env python3
"""Patch Phase 7g — Orquestração automática de agents na Luma"""

import re

# ─── server.js ──────────────────────────────────────────────────────────────

SERVER = '/opt/jarvis-v2/server.js'

with open(SERVER, 'r') as f:
    src = f.read()

# 1. SPECIALIST_CONTEXTS + detectIntent após SESSION_MAX_HISTORY
SPECIALIST_BLOCK = '''const SESSION_MAX_HISTORY = 20; // últimas 20 mensagens no contexto

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
    keywords: ['arquitetura', 'design de sistema', 'estrutura do projeto', 'escalabilidade', 'microserviço', 'monolito', 'padrão de design', 'stack tecnológica', 'decisão técnica', 'diagrama de sistema', 'componente', 'módulo', 'separação de responsabilidades']
  },
  devops: {
    name: 'Gage', icon: '⚡',
    context: 'Modo especialista ativo: Gage (DevOps). Mantenha a personalidade da Luma mas aplique expertise em operações e infraestrutura. Foque em confiabilidade, deploy, configuração de servidores, containers e automação.',
    keywords: ['deploy', 'docker', 'nginx', 'servidor', 'ci/cd', 'pipeline', 'container', 'compose', 'kubernetes', 'vps', 'configuração de servidor', 'systemd', 'firewall', 'ssl', 'tailscale', 'proxy', 'reverse proxy', 'cron']
  },
  'data-engineer': {
    name: 'Dara', icon: '📊',
    context: 'Modo especialista ativo: Dara (Data Engineer). Mantenha a personalidade da Luma mas aplique expertise em dados e banco de dados. Foque em modelagem de dados, queries eficientes, ETL e integridade.',
    keywords: ['banco de dados', 'query', 'sql', 'pipeline de dados', 'etl', 'schema', 'tabela', 'índice', 'postgres', 'mysql', 'mongodb', 'migration', 'orm', 'join', 'aggregate']
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

function detectIntent(message) {
  const lower = message.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  for (const [id, spec] of Object.entries(SPECIALIST_CONTEXTS)) {
    const score = spec.keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) { bestScore = score; bestMatch = id; }
  }
  return bestScore >= 1 ? bestMatch : null;
}'''

OLD1 = "const SESSION_MAX_HISTORY = 20; // últimas 20 mensagens no contexto"
assert OLD1 in src, "ERRO: anchor SESSION_MAX_HISTORY não encontrado"
src = src.replace(OLD1, SPECIALIST_BLOCK, 1)
print("✅ [1/4] SPECIALIST_CONTEXTS + detectIntent adicionados")

# 2. Injetar specialist context no /api/chat (após push do português, antes do histórico)
OLD2 = "  // Historico da sessao\n  if (session.messages.length > 0) {"
NEW2 = """  // 7g: Orquestração — detecta intent e injeta contexto do specialist
  const specialistId = detectIntent(message);
  let specialistActive = null;
  if (specialistId) {
    const spec = SPECIALIST_CONTEXTS[specialistId];
    specialistActive = { id: specialistId, name: spec.name, icon: spec.icon };
    messages.push({ role: 'system', content: spec.context });
    console.log(`[ORCHESTRATOR] ${spec.icon} ${spec.name} ativado: "${message.substring(0, 50)}"`);
  }

  // Historico da sessao
  if (session.messages.length > 0) {"""
assert OLD2 in src, "ERRO: anchor histórico sessão não encontrado"
src = src.replace(OLD2, NEW2, 1)
print("✅ [2/4] Injeção de specialist context no /api/chat")

# 3. Adicionar specialistActive na resposta JSON
OLD3 = "res.json({ reply: replyText, action, actionResult, agent: currentAgent?.name, ragUsed: useRAG && searchQuery, sessionId });"
NEW3 = "res.json({ reply: replyText, action, actionResult, agent: currentAgent?.name, ragUsed: useRAG && searchQuery, sessionId, specialistActive });"
assert OLD3 in src, "ERRO: anchor res.json do /api/chat não encontrado"
src = src.replace(OLD3, NEW3, 1)
print("✅ [3/4] specialistActive adicionado à resposta")

# 4. Endpoint GET /api/agents/detect antes do /api/chat
OLD4 = "app.post('/api/chat', async (req, res) => {"
NEW4 = """// 7g: Debug endpoint — detecta qual specialist seria ativado
app.get('/api/agents/detect', (req, res) => {
  const q = req.query.q || '';
  const specialistId = detectIntent(q);
  const spec = specialistId ? SPECIALIST_CONTEXTS[specialistId] : null;
  res.json({
    detected: specialistId,
    specialist: spec ? { id: specialistId, name: spec.name, icon: spec.icon } : null,
    query: q
  });
});

app.post('/api/chat', async (req, res) => {"""
assert OLD4 in src, "ERRO: anchor app.post('/api/chat') não encontrado"
src = src.replace(OLD4, NEW4, 1)
print("✅ [4/4] Endpoint GET /api/agents/detect adicionado")

with open(SERVER, 'w') as f:
    f.write(src)
print("💾 server.js salvo\n")

# ─── luma.js ────────────────────────────────────────────────────────────────

LUMA = '/opt/jarvis-v2/public/luma.js'

with open(LUMA, 'r') as f:
    lsrc = f.read()

BADGE_FN = """// === SPECIALIST BADGE — 7g ===
window.updateSpecialistBadge = function(specialist) {
  const display = document.getElementById('current-agent-display');
  if (!display) return;
  if (specialist) {
    display.textContent = 'Luma [' + specialist.icon + ' ' + specialist.name + ']';
    display.title = 'Modo especialista: ' + specialist.name;
    display.style.opacity = '0.85';
  } else {
    const active = document.querySelector('.aiox-agent.active .aiox-name');
    display.textContent = active ? active.textContent : 'Luma';
    display.title = '';
    display.style.opacity = '';
  }
};

"""

OLD_LUMA = "// === AUTO-SCROLL ==="
assert OLD_LUMA in lsrc, "ERRO: anchor AUTO-SCROLL não encontrado em luma.js"
lsrc = lsrc.replace(OLD_LUMA, BADGE_FN + "// === AUTO-SCROLL ===", 1)

with open(LUMA, 'w') as f:
    f.write(lsrc)
print("✅ luma.js — updateSpecialistBadge adicionada")

# ─── script.js ──────────────────────────────────────────────────────────────

SCRIPT = '/opt/jarvis-v2/public/script.js'

with open(SCRIPT, 'r') as f:
    ssrc = f.read()

# Handler terminal (addTerminalLineV2)
OLD_T = """      if (data.reply) {
        addTerminalLineV2(data.reply, 'jarvis-line');
      } else if (data.error) {"""
NEW_T = """      if (window.updateSpecialistBadge) window.updateSpecialistBadge(data.specialistActive || null);
      if (data.reply) {
        addTerminalLineV2(data.reply, 'jarvis-line');
      } else if (data.error) {"""
assert OLD_T in ssrc, "ERRO: anchor terminal handler não encontrado em script.js"
ssrc = ssrc.replace(OLD_T, NEW_T, 1)
print("✅ script.js — badge update no handler terminal")

# Handler mini chat (addMiniLine)
OLD_M = """      if (data.reply) {
        addMiniLine(data.reply, 'assistant');
      } else if (data.error) {"""
NEW_M = """      if (window.updateSpecialistBadge) window.updateSpecialistBadge(data.specialistActive || null);
      if (data.reply) {
        addMiniLine(data.reply, 'assistant');
      } else if (data.error) {"""
assert OLD_M in ssrc, "ERRO: anchor mini handler não encontrado em script.js"
ssrc = ssrc.replace(OLD_M, NEW_M, 1)
print("✅ script.js — badge update no handler mini chat")

with open(SCRIPT, 'w') as f:
    f.write(ssrc)
print("💾 script.js salvo\n")

print("=" * 50)
print("🚀 Phase 7g aplicada! Rode:")
print("   docker compose up -d --build --no-deps jarvis-api")
print("=" * 50)
