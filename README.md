# AsidZ AutoFlow Pro — High-Performance Automation & Cloud SaaS for Google Flow

**AsidZ AutoFlow Pro** is a commercial Chrome extension and cloud SaaS platform engineered to automate batch image and video generation workflows on **Google Flow** (`flow.google.com`).

By combining Chrome DevTools Protocol (`chrome.debugger`) hardware-level keystrokes and clicks with a dark glassmorphic side panel, AutoFlow bypasses React virtual DOM state barriers to execute hundreds of creative prompts, manage character and ingredient assets, and auto-download finished high-resolution media on autopilot.

---

## 🚀 Key Features

* **Chrome DevTools Protocol (CDP) Automation**: Dispatches trusted hardware mouse events and character inputs, eliminating synthetic event mismatches and UI latency.
* **Native Side Panel Interface**: Cleanly docks directly into Chrome via the `sidePanel` API, locked strictly to active Google Flow canvases.
* **6 Generation Modes**:
  1. `Text to Video` — Consecutive cinematic video generation.
  2. `Frame to Video` — Animate start/end frame image sequences.
  3. `Ingredients to Video` — Multi-image character, object, and environment composition.
  4. `Text to Image` — High-resolution still generation using Nano Banana 2.1.
  5. `Image to Image` — Transformative editing and chained reference iterations.
  6. `Agent Automation` — Iterative autonomous generation workflows.
* **Automatic Reference Asset & Token Matching**: Drag and drop reference images to automatically match corresponding keywords in prompts.
* **Flow Character & Voice Sync**: Dynamically reads characters and voice libraries directly from your Google Flow project.
* **Automated High-Resolution Media Downloader**: Captures finished outputs directly into organized subfolders (`asidz-flow/`) with custom `#tag` timecodes.
* **Commercial SaaS Architecture**:
  * **Free Tier**: 10 generations per day with 5-prompt batch queue limit.
  * **Pro Tier**: Unlimited generations, 500+ prompt queue capacity, parallel CDP execution, and priority retry logic.

---

## 🛠️ Step 1: Install the Chrome Extension

1. Open Google Chrome on your Mac or PC.
2. Navigate to:
   ```text
   chrome://extensions
   ```
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click **Load unpacked** in the top-left corner.
5. Select the `extension/` directory inside this repository.
6. **AsidZ AutoFlow** will now appear in your active extensions list. Click the puzzle icon in Chrome's toolbar and pin it.

---

## ⚡ Step 2: System Preflight (Doctor Check)

Run the built-in diagnostic doctor to verify that Python, Chrome, and the extension bundle are ready:
```bash
python3 bridge/asidz-agent-bridge.py doctor
```
* **Zero External Dependencies**: The bridge runs 100% on the standard Python 3 library (`urllib`, `http.server`, etc.). No `pip install` or virtual environment required!

---

## ⚡ Step 2: Use AutoFlow on Google Flow

1. Open **Google Flow** at:
   ```text
   https://flow.google.com
   ```
2. Log into your Google account and open a project canvas.
3. Click the **AsidZ AutoFlow** icon in your Chrome toolbar to open the dark glassmorphic Side Panel:
   * **Control Tab**: Select your generation mode, paste multiline prompts (one per paragraph with optional `#tag`), set aspect ratios and models, and click **Start AutoFlow**.
   * **Settings Tab**: Configure delay jitter, concurrency, retries, download paths, or activate your Pro License Key (`PRO-AUTOMA-8888-DEMO`).
   * **Logs Tab**: Live real-time CDP execution table and debugging telemetry.

---

## ☁️ Step 3: Run the Cloud SaaS Platform

The backend provides license key issuance, daily usage quota tracking, and subscription management.

### Running Locally on macOS:
```bash
cd /Users/sid/Desktop/google-flow-autoflow/saas-backend
node server.js
```
* **Dashboard & Portal**: [http://localhost:5050](http://localhost:5050)
* **Pre-activated Demo Pro Key**: `PRO-AUTOMA-8888-DEMO`

### Containerized Deployment (Docker / Cloud Run / VPS):
```bash
docker build -t asidz-autoflow-saas ./saas-backend
docker run -p 5050:5050 asidz-autoflow-saas
```

---

## 🤖 Step 4: Control AutoFlow from Claude Desktop / Antigravity / Cursor (AI Agent Bridge)

**AsidZ AutoFlow** includes a built-in, 100% free Local AI Agent Bridge (`bridge/asidz-agent-bridge.py`) so any local coding or video-editing AI agent can populate B-roll scene prompts, configure Flow dock settings, start batch generation, and collect downloaded files in `~/Downloads/asidz-flow/`.

- **Agent Operating Manual**: See [`AGENT_BRIDGE.md`](./AGENT_BRIDGE.md) and [`CLAUDE.md`](./CLAUDE.md).
- **One-Command B-Roll Run**:
  ```bash
  python3 bridge/asidz-agent-bridge.py run \
    --mode textToVideo \
    --aspect-ratio 9:16 \
    --model "Veo 3.1 - Lite" \
    --duration 6s \
    --prompt "Scene 1 — 0–6 sec: Cinematic slow-motion close-up of rain hitting a neon street..." \
    --prompt "Scene 2 — 6–12 sec: Aerial drone shot over a misty forest at sunrise..."
  ```

---

## 📁 Repository Structure

```text
google-flow-autoflow/
├── CLAUDE.md                      # Auto-loaded instructions for Claude / Antigravity
├── AGENT_BRIDGE.md                # Full AI Agent Bridge & B-Roll operating manual
├── bridge/
│   └── asidz-agent-bridge.py      # Zero-dependency Python 3 CLI & stdio MCP server
├── extension/
│   ├── manifest.json              # Chrome Manifest V3 configuration (v2.6.0)
│   ├── background/
│   │   └── service-worker.js      # CDP debugger, downloads & Local Agent Bridge poller
│   ├── scripts/
│   │   ├── page-upload.js         # Main-world file input interceptor
│   │   ├── selectors.js           # Angular/Material DOM selector map
│   │   ├── helpers.js             # Sizzle query engine & CDP input helpers
│   │   ├── flow.js                # Google Flow dock, character, & download automation
│   │   └── queue.js               # Dual-worker prompt & concurrent download queue
│   ├── sidepanel/
│   │   ├── index.html             # Side Panel UI
│   │   ├── style.css              # Dark burgundy aesthetic styling
│   │   └── app.js                 # Side panel state, model warning & live agent sync
│   └── icons/                     # Extension icons
└── saas-backend/
    ├── server.js                  # Node.js + node:sqlite REST API & Auth
    ├── package.json               # Backend dependencies and scripts
    ├── Dockerfile                 # Container image for cloud deployment
    └── public/
        └── index.html             # AsidZ AutoFlow Pro SaaS portal & dashboard
```
