# 🤖 JARVIS v2.0 - AI Assistant (100% Local + Voice)
**J.A.R.V.I.S.** - Just A Rather Very Intelligent System

![Status](https://img.shields.io/badge/status-operational-brightgreen)
![Voice](https://img.shields.io/badge/voice-GPU--accelerated-blue)
![LM Studio](https://img.shields.io/badge/LLM-Local-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 🎯 Overview
JARVIS v2.0 is a **fully local AI assistant** with Iron Man-inspired HUD interface and **GPU-accelerated voice support**. Everything runs on your own hardware with zero external API calls.

**Key Features:**
- 🧠 **100% Local LLM** via LM Studio (multi-GPU support)
- 🎙️ **GPU-Accelerated Voice** (Whisper on RTX, Piper TTS)
- 🎨 **Iron Man HUD Interface** with 3D brain visualization
- 🤖 **15 Specialized AI Agents** (Orion, Aria, Dex, Atlas, etc.)
- 📝 **Obsidian RAG Integration** for knowledge management
- 🐳 **Docker Setup** with remote Tailscale bridging
- ⚡ **Sub-7s Voice Pipeline** (STT+Chat+TTS end-to-end)

---

## ⚡ Phase 6: Voice System Complete ✅
**Status:** Production-ready voice pipeline with GPU acceleration

| Component | Hardware | Latency | Status |
|-----------|----------|---------|--------|
| **STT (Whisper)** | Windows RTX 2060 | 1.5s | ✅ GPU |
| **Chat (LLM)** | Windows RTX 3060 | ~2s | ✅ GPU |
| **TTS (Piper)** | VPS CPU | ~2.5s | ✅ Local |
| **Total Pipeline** | Hybrid | ~6-7s | ✅ Production |

**Previous (Phase 5):** CPU Whisper = 110s per utterance  
**Current (Phase 6):** GPU Whisper = 1.5s per utterance  
**Speedup: 73x** 🚀

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- **LM Studio** running locally (with at least 1 GPU)
- **For Voice:** Windows PC with NVIDIA GPU + faster-whisper + FastAPI
- **Networking:** Tailscale (for VPS ↔ Windows GPU bridge)

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/siqueiramael/jarvis.git
cd jarvis
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your settings (see Configuration section)
```

3. **Start with Docker:**
```bash
docker-compose up -d
```

4. **Access the interface:**
```
https://jarvis.fuziontech.com.br  (remote via Tailscale)
http://localhost:3000              (local)
```

---

## 🏗️ Architecture

### VPS Stack (Nginx + Docker)
```
┌─────────────────────────────────┐
│ JARVIS Backend (Docker)         │
│ ├─ Node.js/Express (port 3000)  │
│ ├─ Obsidian Sync (Alpine)       │
│ ├─ Piper TTS (CPU)              │
│ └─ Whisper Fallback (CPU)       │
├─ Nginx (SSL via Let's Encrypt)  │
└─ Tailscale VPN Bridge           │
```

### Windows GPU Stack (LAN)
```
┌──────────────────────────────────┐
│ Windows PC (Tailscale bridged)   │
│ ├─ LM Studio (RTX 3060, port 1234)    │
│ └─ Whisper Server (RTX 2060, port 8001) │
│    ├─ faster-whisper (CUDA)      │
│    └─ FastAPI wrapper            │
└─ Auto-start via Task Scheduler   │
```

### Voice Pipeline (End-to-End)
```
Browser Mic
  ↓ MediaRecorder (WebM/Opus)
  ↓ POST /api/voice/pipeline
  ↓ ffmpeg (WAV 16kHz mono)
  ↓ faster-whisper/RTX 2060 (1.5s)
  ↓ LM Studio/RTX 3060 (2s)
  ↓ Piper TTS (2.5s)
  ↓ Audio response (WAV)
  ↓ Browser AudioContext
```

---

## ⚙️ Configuration

### `.env` (required)
```env
# LM Studio (Windows PC via Tailscale)
OPENAI_API_BASE=http://100.112.73.46:1234/v1
LM_STUDIO_MODEL=openhermes-2.5-neural-chat-7b-v3-2-7b

# Whisper GPU Server (Windows PC)
WHISPER_URL=http://100.112.73.46:8001

# Obsidian Knowledge Base
GIT_REPO=https://github.com/YOUR_USERNAME/jarvis-brain.git
GIT_BRANCH=master

# Server
PORT=3000
```

### Windows GPU Setup
1. **Install faster-whisper:**
```bash
pip install faster-whisper
```

2. **Create whisper_server.py:**
```python
from fastapi import FastAPI, File, UploadFile
from faster_whisper import WhisperModel
import time

app = FastAPI()
model = WhisperModel("medium", device="cuda", device_index=1)  # RTX 2060

@app.post("/transcribe")
async def transcribe(audio: UploadFile):
    start = time.time()
    segments, _ = model.transcribe(audio.file, language="pt")
    text = " ".join([s.text for s in segments])
    elapsed = int((time.time() - start) * 1000)
    return {"text": text, "elapsed_ms": elapsed}
```

3. **Run FastAPI server:**
```bash
uvicorn whisper_server:app --host 0.0.0.0 --port 8001
```

4. **Auto-start via Task Scheduler:**
- Create batch file: `D:\jarvis\start-jarvis.bat`
- Add Task Scheduler job to run at startup
- Service runs as SYSTEM with Tailscale access

---

## 📁 Project Structure
```
jarvis-v2/
├── public/                    # Frontend (HUD, chat, voice UI)
│   ├── index.html
│   ├── script.js             # Chat + Voice handlers
│   └── styles.css
├── agents/                    # 15 AI Agent definitions (.md)
│   ├── orion.md
│   ├── aria.md
│   └── ...
├── data/
│   ├── obsidian-vault/       # Synced Obsidian notes
│   └── logs/
├── server.js                 # Express backend + Voice endpoints
├── docker-compose.yml        # Multi-service orchestration
├── .env.example              # Config template
└── README.md
```

---

## 🎤 Voice Endpoints

### `/api/voice/stt` - Speech to Text
```bash
curl -X POST -F "audio=@audio.wav" http://localhost:3000/api/voice/stt
# Response: { text, source, elapsed_ms }
```

### `/api/voice/tts` - Text to Speech
```bash
curl -X POST -d '{"text":"Hello"}' http://localhost:3000/api/voice/tts \
  --output response.wav
```

### `/api/voice/pipeline` - Full Pipeline (STT → Chat → TTS)
```bash
curl -X POST -F "audio=@audio.wav" http://localhost:3000/api/voice/pipeline \
  --output response.wav
# Returns: WAV audio with headers: X-Timing-Stt, X-Timing-Chat, X-Timing-Tts
```

---

## 🧠 AI Agents (15 Active)

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

**Conclave (3 specialized):**
- Crítico, Advogado, Sintetizador

---

## ✅ Implemented Features

- [x] Chat with local LLM (LM Studio)
- [x] 15 Agent system with role-based prompts
- [x] Obsidian vault syncing (GitHub + local)
- [x] Voice STT (Whisper GPU on Windows RTX 2060)
- [x] Voice TTS (Piper local)
- [x] Full voice pipeline (6-7s end-to-end)
- [x] Docker containerization
- [x] Nginx + SSL (Let's Encrypt)
- [x] Tailscale remote access
- [x] Iron Man HUD interface
- [x] 3D brain visualization

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JS, Three.js
- **Backend:** Node.js 20, Express
- **LLM:** LM Studio (OpenHermes 7B)
- **STT:** faster-whisper (CUDA)
- **TTS:** Piper (local)
- **Knowledge:** Obsidian + Git sync
- **Deployment:** Docker, Docker Compose, Nginx
- **Networking:** Tailscale VPN

---

## 📊 Performance Benchmarks

### Voice Pipeline (Phase 6)
```
STT (Whisper GPU):    1.5s  (was 110s on CPU)
Chat (LM Studio):     ~2s
TTS (Piper):          ~2.5s
──────────────────────────
Total:                ~6s   (was 115s)
Speedup:              73x ⚡
```

---

## 🐛 Known Issues & Roadmap

- [ ] Screen analysis (Claude Computer Use style)
- [ ] Advanced RAG (semantic search on vault)
- [ ] Web browsing integration
- [ ] Persistent memory/long-term context
- [ ] Multi-user support

---

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repo
2. Create a feature branch
3. Commit with clear messages
4. Submit a pull request

---

## 📄 License

MIT License - see LICENSE file

---

## 🙏 Credits

- LLM: [LM Studio](https://lmstudio.ai)
- STT: [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- TTS: [Piper](https://github.com/rhasspy/piper)
- Networking: [Tailscale](https://tailscale.com)
- Knowledge: [Obsidian](https://obsidian.md)

---

**Built with ❤️ + GPU ⚡ by Mael Siqueira**
