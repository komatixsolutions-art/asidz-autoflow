# CLAUDE.md — AsidZ AutoFlow Workspace & AI B-Roll Controller

Whenever the user asks you to **generate B-rolls, video scenes, or story sequences using Google Flow / AutoFlow**, follow this guide. All browser automation, Flow navigation, side panel management, and file handling are built into the bridge and extension.

---

## 1. How It Works (Zero Additional Setup Needed)

All execution is handled by the **AsidZ AutoFlow Bridge**:
- **Bridge CLI Path:** `/Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py`
- When you run this Python script, it automatically:
  1. Activates Google Chrome and focuses the Google Flow tab (or opens the target project URL).
  2. Automatically reveals the docked Chrome side panel via `Cmd+Shift+U`.
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

### Case A: Continuing an Existing Story / Project (e.g., "The Missing Shoe")
Use this when characters already exist in a Google Flow project:

```bash
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run \
  --prompts-file "/Users/sid/Desktop/AsidzAutoFlow_Projects/<ProjectName>/prompts.txt" \
  --project-url "https://flow.google.com/project/<project-id>" \
  --project-name "<ProjectName>" \
  --project-dir "/Users/sid/Desktop/AsidzAutoFlow_Projects/<ProjectName>" \
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
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run \
  --project-name "MyStory" \
  --project-dir "/Users/sid/Desktop/AsidzAutoFlow_Projects/MyStory" \
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
