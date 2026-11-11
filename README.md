# AutoFlow Pro - Google Flow Automation Chrome Extension & Cloud SaaS

A complete replica and commercial enhancement of the **AutoFlow** Chrome extension featured in the YouTube tutorial *"I Automated Google Flow Completely — Images & Videos on Autopilot"*.

This repository includes:
1. **`extension/`**: Production-ready Chrome Extension (Manifest V3) with floating glassmorphic overlay, batch prompt queuing, React DOM state injection, auto-download pipeline, and quota management.
2. **`saas-backend/`**: Cloud SaaS platform built with Node.js and SQLite, featuring User Authentication, Tier Management (Free vs Pro), License Key Verification, Usage Metering, and a Web Portal.

---

## 🚀 Key Features

* **Batch Prompt Processing**: Paste hundreds of prompts or import `.txt`/`.csv` files.
* **Smart DOM Automation**: Directly bypasses React virtual DOM state using prototype value setters and synthetic events.
* **Dynamic Modifiers**: Style prefixes, camera suffixes, and character tags automatically appended.
* **Automated Downloading**: Saves finished videos/images into organized subfolders (`AutoFlow_Generations/flow_001_prompt.mp4`).
* **Intelligent Error Recovery**: Detects rate limits, quota issues, or safety filters with configurable pacing and retries.
* **Commercial SaaS Architecture**:
  * **Free Tier**: 10 generations per day, 5-prompt batch queue limit.
  * **Pro Tier**: Unlimited generations, 500+ batch queue, priority retry, license key validation.

---

## 🛠️ Step 1: Install Extension on Chrome (macOS)

1. Open Google Chrome on your Mac.
2. Navigate to:
   ```text
   chrome://extensions
   ```
3. In the top right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top left.
5. Select the extension directory:
   ```text
   /Users/sid/.gemini/antigravity/scratch/google-flow-autoflow/extension
   ```
6. **AutoFlow Pro** will now appear in your active extensions list!

---

## ⚡ Step 2: Use AutoFlow on Google Flow

1. Go to **Google Flow** at:
   ```text
   https://flow.google.com
   ```
   *(or `https://labs.google/fx/tools/flow`)*
2. Log into your Google account and open a project canvas.
3. The **AutoFlow Pro** floating dark glassmorphic panel will automatically dock in the top-right corner:
   * **Queue Tab**: Paste your prompts (1 per line), set your desired style prefix/suffix, choose delay pacing (default: 12 seconds).
   * **Activity Tab**: Click **⚡ Start Batch Automation**. Watch real-time progress bars and status indicators.
   * **Settings Tab**: Enter your SaaS License Key or configure auto-download folders.

---

## ☁️ Step 3: Run the SaaS Cloud Platform

The backend provides license verification, user signup, and tier enforcement.

### Running Locally on macOS:
```bash
cd /Users/sid/.gemini/antigravity/scratch/google-flow-autoflow/saas-backend
node server.js
```
* **Landing Page & Web Dashboard**: Open [http://localhost:4000](http://localhost:4000)
* **Pre-configured Demo Pro Key**: `PRO-AUTOMA-8888-DEMO`

### Cloud Deployment (Render / Railway / AWS / Cloud Run):
The backend is completely containerized with a lightweight `Dockerfile`:
```bash
docker build -t autoflow-saas .
docker run -p 4000:4000 autoflow-saas
```

---

## 📁 Repository Structure

```text
google-flow-autoflow/
├── extension/
│   ├── manifest.json              # Manifest V3 configuration
│   ├── background/
│   │   └── service-worker.js      # Downloads, quota tracking, cloud sync
│   ├── content/
│   │   ├── dom-automator.js       # Google Flow React DOM interaction engine
│   │   ├── sidebar-ui.js          # Draggable overlay and queue controller
│   │   └── sidebar.css            # Glassmorphic dark styling
│   ├── popup/
│   │   ├── popup.html             # Toolbar quick status widget
│   │   ├── popup.css
│   │   └── popup.js
│   ├── options/
│   │   ├── options.html           # Settings & API URL configuration
│   │   └── options.js
│   └── icons/                     # Generated 16px, 48px, 128px PNG icons
└── saas-backend/
    ├── server.js                  # Node.js + node:sqlite REST API & Auth
    ├── Dockerfile                 # Container image for 1-click cloud deploy
    └── public/
        └── index.html             # SaaS landing page & license management portal
```
