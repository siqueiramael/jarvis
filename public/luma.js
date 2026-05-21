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
});

// === AUTO-SCROLL ===
const chatOut = document.getElementById('chat-mini-output');
if (chatOut) {
  new MutationObserver(() => {
    chatOut.scrollTop = chatOut.scrollHeight;
  }).observe(chatOut, { childList: true, subtree: true });
}
