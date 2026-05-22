// Session ID — gerado uma vez por sessão de browser
if (!window.lumaSessionId) {
  window.lumaSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Salva sessão ao fechar/sair da página
window.addEventListener('beforeunload', () => {
  if (window.lumaSessionId) {
    navigator.sendBeacon('/api/session/end', JSON.stringify({ sessionId: window.lumaSessionId }));
  }
});

// luma.js — Drawer, Status, Header Agent Display

// === DRAWER ===
const menuBtn   = document.getElementById('menu-btn');
const drawerClose = document.getElementById('drawer-close');
const sidebar   = document.getElementById('luma-drawer');
const overlay   = document.getElementById('drawer-overlay');

function openDrawer()  { sidebar?.classList.add('open'); overlay?.classList.add('open'); }
function closeDrawer() { sidebar?.classList.remove('open'); overlay?.classList.remove('open'); }

menuBtn?.addEventListener('click', openDrawer);
drawerClose?.addEventListener('click', closeDrawer);
overlay?.addEventListener('click', closeDrawer);

// Fechar drawer ao selecionar agente no mobile
document.querySelectorAll('.aiox-agent').forEach(el => {
  el.addEventListener('click', () => { if (window.innerWidth < 768) closeDrawer(); });
});

// === HEADER: atualiza nome do agente ativo ===
new MutationObserver(() => {
  const active = document.querySelector('.aiox-agent.active .aiox-name');
  const display = document.getElementById('current-agent-display');
  if (active && display) display.textContent = active.textContent;
}).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });

// === STATUS CHECK ===
async function checkStatus() {
  const set = (id, state) => {
    const el = document.getElementById(id);
    if (el) el.className = `status-dot-sm ${state}`;
  };
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    set('bar-api-status',    r.ok ? 'online' : 'offline');
    set('bar-claude-status', d.agentsLoaded > 0 ? 'online' : 'offline');
    set('obsidian-status-dot', d.vaultPath ? 'online' : 'offline');
    set('bar-voice-status',  d.voice?.whisper ? 'online' : 'offline');
  } catch {
    ['bar-api-status','bar-claude-status','bar-voice-status','obsidian-status-dot']
      .forEach(id => set(id, 'offline'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(checkStatus, 800);
  setInterval(checkStatus, 30000);

  // 7j-B: inicializa badge clicável sem esperar primeira mensagem
  setTimeout(function() {
    const display = document.getElementById('current-agent-display');
    if (display && !display.dataset.pickerBound) {
      display.style.cursor = 'pointer';
      display.title = 'Clique para escolher specialist';
      display.addEventListener('click', function(e) {
        e.stopPropagation();
        const picker = document.getElementById('specialist-picker');
        if (picker) { closeSpecialistPicker(); return; }
        openSpecialistPicker();
      });
      display.dataset.pickerBound = '1';
    }
  }, 500);
});

// === SPECIALIST BADGE + PICKER — 7j-B ===
const SPECIALIST_OPTIONS = [
  { id: 'dev',           mention: '@dex',    icon: '💻', name: 'Dex',    role: 'Dev Engineer'  },
  { id: 'architect',     mention: '@aria',   icon: '🏛️', name: 'Aria',   role: 'Architect'     },
  { id: 'devops',        mention: '@gage',   icon: '⚡', name: 'Gage',   role: 'DevOps'        },
  { id: 'data-engineer', mention: '@dara',   icon: '📊', name: 'Dara',   role: 'Data Engineer' },
  { id: 'qa',            mention: '@quinn',  icon: '🔍', name: 'Quinn',  role: 'QA'            },
  { id: 'pm',            mention: '@morgan', icon: '📋', name: 'Morgan', role: 'PM'            },
];

window.updateSpecialistBadge = function(specialist) {
  const display = document.getElementById('current-agent-display');
  if (!display) return;

  // Torna o badge clicável na primeira chamada
  if (!display.dataset.pickerBound) {
    display.style.cursor = 'pointer';
    display.title = 'Clique para escolher specialist';
    display.addEventListener('click', function(e) {
      e.stopPropagation();
      const picker = document.getElementById('specialist-picker');
      if (picker) { closeSpecialistPicker(); return; }
      openSpecialistPicker();
    });
    display.dataset.pickerBound = '1';
  }

  if (specialist) {
    const persisted = specialist.persisted === true;
    display.textContent = 'Luma [' + specialist.icon + ' ' + specialist.name + (persisted ? ' ~' : '') + ']';
    display.title = (persisted ? 'Persistindo: ' : 'Modo especialista: ') + specialist.name + ' — clique para trocar';
    display.style.opacity = persisted ? '0.65' : '0.85';
    display.dataset.specialistId = specialist.id;
  } else {
    const active = document.querySelector('.aiox-agent.active .aiox-name');
    display.textContent = active ? active.textContent : 'Luma';
    display.title = 'Clique para escolher specialist';
    display.style.opacity = '';
    display.dataset.specialistId = '';
  }
};

function openSpecialistPicker() {
  const display = document.getElementById('current-agent-display');
  if (!display) return;

  const picker = document.createElement('div');
  picker.id = 'specialist-picker';
  picker.className = 'specialist-picker';

  // Posiciona via fixed usando bounding rect do badge
  const rect = display.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top = (rect.bottom + 8) + 'px';
  picker.style.right = (window.innerWidth - rect.right) + 'px';
  picker.style.left = 'auto';
  picker.style.transform = 'none';

  // Opção: limpar (Luma geral)
  const clearBtn = document.createElement('button');
  clearBtn.className = 'sp-option sp-clear';
  clearBtn.innerHTML = '<span class="sp-icon">✦</span><span class="sp-info"><span class="sp-name">Luma</span><span class="sp-role">Geral</span></span>';
  clearBtn.addEventListener('click', function() {
    closeSpecialistPicker();
    document.getElementById('chat-mini-input')?.focus();
  });
  picker.appendChild(clearBtn);

  // Opções de specialists
  SPECIALIST_OPTIONS.forEach(function(opt) {
    const btn = document.createElement('button');
    btn.className = 'sp-option';
    if (display.dataset.specialistId === opt.id) {
      btn.classList.add('sp-active');
    }
    btn.innerHTML = '<span class="sp-icon">' + opt.icon + '</span><span class="sp-info"><span class="sp-name">' + opt.name + '</span><span class="sp-role">' + opt.role + '</span></span>';
    btn.addEventListener('click', function() {
      const input = document.getElementById('chat-mini-input');
      if (input) {
        const clean = input.value.replace(/^@\w+\s*/, '').trim();
        input.value = opt.mention + (clean ? ' ' + clean : ' ');
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
      closeSpecialistPicker();
    });
    picker.appendChild(btn);
  });

  document.body.appendChild(picker);

  // Fecha ao clicar fora
  setTimeout(function() {
    document.addEventListener('click', function handler(e) {
      if (!e.target.closest('#specialist-picker') && !e.target.closest('.header-agent-pill') && e.target !== display) {
        closeSpecialistPicker();
        document.removeEventListener('click', handler);
      }
    });
  }, 50);
}

function closeSpecialistPicker() {
  const p = document.getElementById('specialist-picker');
  if (p) p.remove();
}

// === AUTO-SCROLL ===
const chatOut = document.getElementById('chat-mini-output');
if (chatOut) {
  new MutationObserver(() => {
    chatOut.scrollTop = chatOut.scrollHeight;
  }).observe(chatOut, { childList: true, subtree: true });
}
