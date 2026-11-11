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

1. Open Google Chrome on your Mac.
2. Navigate to:
   ```text
   chrome://extensions
   ```
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click **Load unpacked** in the top-left corner.
5. Select the extension directory:
   ```text
   /Users/sid/Desktop/google-flow-autoflow/extension
   ```
6. **AsidZ AutoFlow** will now appear in your active extensions list.

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

## 📁 Repository Structure

```text
google-flow-autoflow/
├── extension/
│   ├── manifest.json              # Chrome Manifest V3 configuration
│   ├── background/
│   │   └── service-worker.js      # Tab locking, CDP debugger session, downloads
│   ├── scripts/
│   │   └── cdp-automator.js       # Google Flow DOM injector and media detector
│   ├── sidepanel/
│   │   ├── index.html             # Glassmorphic Side Panel UI
│   │   ├── styles.css             # Dark burgundy aesthetic styling
│   │   ├── app.js                 # Queue controller and asset matcher
│   │   └── asidz-logo.png         # AsidZ brand avatar
│   └── icons/                     # Resized 16px, 48px, 128px extension icons
└── saas-backend/
    ├── server.js                  # Node.js + node:sqlite REST API & Auth
    ├── package.json               # Backend dependencies and scripts
    ├── Dockerfile                 # Container image for cloud deployment
    └── public/
        └── index.html             # AsidZ AutoFlow Pro SaaS portal & dashboard
```
