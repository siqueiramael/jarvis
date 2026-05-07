# 🤖 JARVIS v2.0 - AI Assistant (100% Local)

**J.A.R.V.I.S.** - Just A Rather Very Intelligent System

![Status](https://img.shields.io/badge/status-operational-brightgreen)
![LM Studio](https://img.shields.io/badge/LLM-Local-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 🎯 Overview

JARVIS v2.0 is a **fully local AI assistant** with Iron Man-inspired HUD interface. No external API calls - everything runs on your own hardware.

**Key Features:**
- 🧠 **100% Local LLM** via LM Studio
- 🎨 **Iron Man HUD Interface** with 3D brain visualization
- 🤖 **17 Specialized AI Agents** (Orion, Aria, Dex, Atlas, etc.)
- 📝 **Obsidian Integration** for knowledge management
- 🎤 **Voice Support** (STT/TTS planned)
- 🐳 **Docker Setup** for easy deployment

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- LM Studio running locally
- Tailscale (optional, for remote access)

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/siqueiramael/jarvis.git
cd jarvis
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your settings
```

3. **Start with Docker:**
```bash
docker-compose up -d
```

4. **Access the interface:**
```
http://localhost:3000
```

---

## 📁 Project Structure

```
jarvis-v2/
├── public/              # Frontend (HTML, CSS, JS, 3D brain)
├── .claude/agents/      # 17 AI agent definitions
├── .synapse/            # Context engine
├── obsidian-template/   # Knowledge base template
├── server.js            # Express backend
├── docker-compose.yml   # Docker orchestration
└── README.md
```

---

## 🧠 AI Agents

JARVIS includes 17 specialized agents:

**Squad:**
- **Orion** - Master orchestrator
- **Aria** - System architect
- **Dex** - Developer
- **Atlas** - Analyst
- **Dara** - Data engineer
- **Gage** - DevOps
- **Quinn** - QA
- **Morgan** - PM
- **Pax** - PO
- **River** - Scrum Master
- **Uma** - UX Designer
- **Craft** - Squad creator

**Conclave (3 specialized agents):**
- Crítico, Advogado, Sintetizador

---

## ⚙️ Configuration

Edit `.env`:

```env
# LM Studio Local
OPENAI_API_BASE=http://YOUR_IP:1234/v1
LM_STUDIO_MODEL=openhermes-2.5-neural-chat-7b-v3-2-7b

# Obsidian Vault
GIT_REPO=https://github.com/YOUR_USERNAME/jarvis-brain.git
```

---

## 🎨 Features

### ✅ Implemented
- [x] 3D Brain Visualization (Three.js)
- [x] Chat with LM Studio
- [x] Iron Man HUD Interface
- [x] Docker Setup
- [x] Obsidian Sync
- [x] 17 Agent System (defined)

### ⏳ Roadmap
- [ ] Agent Selection UI
- [ ] Obsidian RAG Integration
- [ ] Voice (Whisper + Piper local)
- [ ] Screen Analysis
- [ ] Task Automation

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JS, Three.js
- **Backend:** Node.js, Express
- **LLM:** LM Studio (local)
- **Knowledge:** Obsidian (Markdown vault)
- **Deploy:** Docker, Docker Compose

---

## 📸 Screenshots

![JARVIS HUD](docs/screenshot.png)
*Iron Man inspired HUD with 3D brain*

---

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

---

## 📄 License

MIT License - see LICENSE file

---

## 🙏 Credits

- Original concept inspired by gaahzx/jarvis
- 3D Brain model: Three.js + GLTF
- LLM: LM Studio local inference

---

## 📞 Contact

- GitHub: [@siqueiramael](https://github.com/siqueiramael)

---

**Built with ❤️ by Mael Siqueira**
