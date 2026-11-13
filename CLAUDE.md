# CLAUDE.md — AsidZ AutoFlow Workspace & AI B-Roll Controller

Whenever the user asks you to **generate B-rolls, video scenes, or story sequences using Google Flow / AutoFlow**, follow this guide. All browser automation, Flow navigation, side panel management, and file handling are built into the bridge and extension.

---

## 0. Zero-Config Environment & Requirements (For Any New PC or Mac)

Before running B-rolls or video batches on a new machine, you can run the diagnostic check:

```bash
# From repository root:
python3 bridge/asidz-agent-bridge.py doctor

# Or from an adjacent workspace (e.g. AsidzAutoFlow_Projects):
python3 ../google-flow-autoflow/bridge/asidz-agent-bridge.py doctor
```

### Essential Requirements (Only 2 things needed):
1. **Google Chrome (v116+):** Required for Google Flow and Chrome's native `sidePanel` and `debugger` (CDP) APIs.
2. **Python 3 (v3.8+):** Uses 100% Python Standard Library (`urllib`, `http.server`, etc.). **Zero pip packages or virtualenvs required!**
3. **Google Account:** User must be logged in to [https://flow.google.com](https://flow.google.com) in Chrome.
4. **AsidZ AutoFlow Extension (One-time 2-minute setup):**
   - Open Chrome to `chrome://extensions`.
   - Enable **Developer mode** (top-right toggle).
   - Click **Load unpacked** (top-left) and select the `extension/` folder.
   - Pin **AsidZ AutoFlow** to the Chrome toolbar.

---

## 1. How It Works (Zero Additional Setup Needed)

All execution is handled by the **AsidZ AutoFlow Bridge**:
- When you run the Python bridge script, it automatically:
  1. Activates Google Chrome and focuses the Google Flow tab (or opens the target project URL).
  2. Automatically reveals the docked Chrome side panel via `Cmd+Shift+U` (Mac) / `Ctrl+Shift+U` (Windows).
  3. Configures Flow dock settings (mode, ratio, model, duration, outputs).
  4. Scans and injects Google Flow character chips (e.g., `@Aarav`, `@Bruno`).
  5. Monitors generation progress (0% → 100%) and retries automatically if Flow stalls.
  6. Downloads 1080p MP4 videos to disk with clean sanitized names (`Project_SceneX_16-9_video.mp4`).
  7. Copies all finished video files into the target project folder and outputs a verified report.

You do **NOT** need to write browser automation code. You simply execute the bridge command via `python3`.

---

## 2. Mandatory Pre-Execution Step: Settings Questionnaire

Before running the bridge, always ask the user to confirm generation settings (presenting recommended options first):
1. **Generation Mode:** `textToVideo` (recommended) or `textToImage`
2. **Aspect Ratio:** `16:9` (widescreen) or `9:16` (vertical Reels/Shorts)
3. **AI Video Model:**
   - 2+ Characters / multi-object scenes: **Always use `Omni 1.1 Flash`** (Veo 3.1 is limited to 2 ingredients).
   - 0-1 Characters / single focus: `Veo 3.1 - Lite` or `Veo 3.1 - Quality`.
4. **Scene Duration:** `6s` (recommended), `4s`, or `8s`.
5. **Project Target:**
   - Fresh story: Creates new project folder.
   - Existing story: Use `--project-url <url>` and `--skip-character-registration` to lock into the existing Flow project canvas.

---

## 3. Standard Execution Commands

### Locate the Bridge Script Dynamically
Find `asidz-agent-bridge.py` relative to your workspace:
- Inside repo: `BRIDGE="bridge/asidz-agent-bridge.py"`
- Inside projects workspace: `BRIDGE="../google-flow-autoflow/bridge/asidz-agent-bridge.py"` (or search with `find . -name asidz-agent-bridge.py` or use its absolute path on the current machine).

### Case A: Continuing an Existing Story / Project (e.g., "The Missing Shoe")
Use this when characters already exist in a Google Flow project:

```bash
python3 "$BRIDGE" run \
  --prompts-file "<path_to>/prompts.txt" \
  --project-url "https://flow.google.com/project/<project-id>" \
  --project-name "<ProjectName>" \
  --project-dir "<project_dir>" \
  --mode textToVideo \
  --aspect-ratio 16:9 \
  --model "Omni 1.1 Flash" \
  --duration 6s \
  --outputs 1 \
  --video-quality 1080 \
  --skip-character-registration
```

### Case B: Running Directly via Prompt Arguments
```bash
python3 "$BRIDGE" run \
  --project-name "MyStory" \
  --project-dir "<destination_dir>/MyStory" \
  --mode textToVideo \
  --aspect-ratio 16:9 \
  --model "Omni 1.1 Flash" \
  --duration 6s \
  --outputs 1 \
  --video-quality 1080 \
  --prompt "Scene 1 — [duration:6s] [model:Omni 1.1 Flash] [ratio:16:9] Cinematic photorealistic video: ..." \
  --prompt "Scene 2 — [duration:6s] [model:Omni 1.1 Flash] [ratio:16:9] Cinematic photorealistic video: ..."
```

---

## 4. Prompt Formatting Rules
1. Always start scene prompts with `Scene 1 — ...`, `Scene 2 — ...` so the extension generates clean file names like `<ProjectName>_Scene1_16-9_video.mp4`.
2. Include inline parameter tags: `[duration:6s] [model:Omni 1.1 Flash] [ratio:16:9]`.
3. Include character mentions with `@` (e.g. `@Aarav`, `@Bruno`).

For complete architecture details and MCP options, see [`AGENT_BRIDGE.md`](./AGENT_BRIDGE.md).
