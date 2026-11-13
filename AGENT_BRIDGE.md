# AsidZ AutoFlow — AI Agent Bridge & B-Roll Automation Manual (`AGENT_BRIDGE.md`)

**Official Platform:** [https://asidz.com](https://asidz.com)  
**Bridge Script:** `bridge/asidz-agent-bridge.py` (located in the `google-flow-autoflow` repository)

This document provides complete instructions for **Claude Desktop**, **Claude Code**, **Antigravity**, **Cursor**, **Windsurf**, and any local AI coding agent to control the **AsidZ AutoFlow** Chrome extension on **Google Flow** (`https://flow.google.com`) to generate and download AI B-roll videos and images automatically.

---

## 0. Zero-Config Setup & System Preflight (For Any New PC or Mac)

Before running B-rolls or video batches, any AI coding agent can verify that the system is ready by running the built-in diagnostic doctor:

```bash
python3 bridge/asidz-agent-bridge.py doctor
```

### Essential Requirements (Only 2 things needed!):
1. **Google Chrome** (v116+):
   - Required for Google Flow and Chrome's native `sidePanel` and `debugger` (CDP) APIs.
   - macOS: `/Applications/Google Chrome.app`
   - Windows: Standard Chrome install (`Program Files\Google\Chrome\Application\chrome.exe`).
2. **Python 3** (v3.8+):
   - Pre-installed on macOS; standard install on Windows (`python.org`).
   - **Zero pip packages required**: The bridge relies 100% on Python's built-in standard library (`http.server`, `urllib`, `subprocess`, `argparse`, `json`, `os`, `sys`). No `pip install` or virtual environment needed!
3. **Google Account:**
   - Logged in to [https://flow.google.com](https://flow.google.com) in Google Chrome.
4. **AsidZ AutoFlow Extension (One-time 2-minute setup):**
   - Open Chrome and navigate to `chrome://extensions`.
   - Enable the **Developer mode** toggle in the top-right corner.
   - Click **Load unpacked** (top-left).
   - Select the `extension/` folder inside the `google-flow-autoflow` repository.
   - Click the puzzle icon in Chrome's toolbar and pin **AsidZ AutoFlow** for quick access.

### Dynamic Path Resolution for AI Coding Agents:
Agents should locate `asidz-agent-bridge.py` dynamically relative to the current workspace or repository:
- Inside the repository root: `python3 bridge/asidz-agent-bridge.py run ...`
- Inside an adjacent project folder (e.g., `AsidzAutoFlow_Projects`): `python3 ../google-flow-autoflow/bridge/asidz-agent-bridge.py run ...`
- Never rely on hardcoded username paths (e.g. `/Users/sid/...`) when sharing across machines.

---

## 1. Complete End-to-End Workflow (MANDATORY — Follow Every Step)

When a user gives you a story, script, or video timeline and asks you to generate B-rolls using **AsidZ AutoFlow**, you MUST follow this exact sequence. **Do NOT skip any step.**

### Step 1 — Analyze Content & Identify Characters
Analyze the user's story/script/timeline to determine:
- Total number of scenes/B-rolls needed
- What each B-roll depicts (characters, action, setting, mood)
- **Which characters appear in the story (e.g. `@Aarav`, `@Bruno`)**
- The time range and duration for each scene

### Step 2 — Project & Character Consistency Check (MANDATORY)
In Google Flow, `@Character` mentions are strictly scoped to a **Project** in Flow. If a project does not already contain the registered characters, Flow treats `@Character` mentions as plain text, resulting in inconsistent faces and appearances across scenes!

**Before generating scenes, the agent MUST ask the user:**
1. **Fresh Story (Recommended for new stories):**
   - The agent will first create a new Flow project named after the story.
   - The agent designs dedicated **Character Sheets** (close-up portrait and full-body prompts) for each named character.
   - The bridge generates and auto-downloads the character images into `<workspace>/<projectName>/characters/`.
   - The agent presents the character image links to the user for review and approval.
   - Once approved, the agent proceeds to generate the video scenes using those approved characters.
2. **Existing Project:**
   - The user provides the Google Flow Project URL (e.g., `https://flow.google.com/project/abc123xyz`) or project name where `@characters` are already established.
   - The bridge passes `--project-url <url>` so the extension navigates directly into that project, scans the existing characters, and generates scenes with full character token recognition.

### Step 3 — Ask the User for Generation Settings (MANDATORY)
**NEVER assume or auto-select settings.** Before running the bridge, you MUST present the user with a settings selection prompt using your agent's interactive question/option tool (e.g., `ask_question` in Antigravity, or a clear options list in other agents). Present ALL of the following options and let the user choose.

**How to present options — Recommended + Custom:**
The agent MUST analyze the user's story/script first and determine the best settings based on the content. Then present each setting with a **`(Recommended)` option first**, followed by all other choices. The user can either accept the recommended option or pick a custom one.

For example, if the story has 2 characters and is a cinematic short:
- Aspect Ratio → `(Recommended) 16:9 — Widescreen` because the tone is "cinematic"
- Model → `(Recommended) Omni 1.1 Flash` because 2+ characters are detected
- Duration → `(Recommended) 6s` because the average scene is ~5–6 seconds

The agent should explain WHY it recommends each option in a brief note.

**Settings to ask:**

1. **Generation Mode**
   - `textToVideo` (Default — generate video from text prompt)
   - `textToImage` (generate still image from text prompt)
   - `imageToVideo` (animate an existing image)
   - `componentsToVideo` (compose from components)

2. **Aspect Ratio**
   - `16:9` — Widescreen (YouTube, cinematic)
   - `9:16` — Vertical (Shorts, Reels, TikTok)
   - `square` — 1:1 (Instagram feed)
   - `portrait` — 4:5 (Instagram portrait)
   - `landscape` — 21:9 (Ultra-wide cinematic)

   > **Recommendation logic:** If the user says "cinematic", "YouTube", "short film", or "widescreen" → recommend `16:9`. If they say "Reels", "Shorts", "TikTok", or "vertical" → recommend `9:16`. If they say "Instagram" without specifying → recommend `square`. If unclear, ask.

3. **Video Model** (only if mode is video)
   - `Veo 3.1 - Lite` — Fast, good quality (single character or no characters only)
   - `Veo 3.1 - Fast` — Balanced speed and quality (single character or no characters only)
   - `Veo 3.1 - Quality` — Best quality, slower (single character or no characters only)
   - `Omni 1.1 Flash` — Required for 2+ characters (auto-recommended when multi-character detected)
   - `Omni 1.2 Flash` — Alternative for 2+ characters

   > **IMPORTANT AUTO-RULE:** If 2 or more `@characters` are detected in any prompt, the agent MUST auto-select `Omni 1.1 Flash` or `Omni 1.2 Flash` regardless of user's model choice, and inform the user why. Veo models will stall at `0%` or fail with 2+ characters. Mark the Omni model as `(Recommended)` and add a note: "Required — your scenes have 2+ characters."

4. **Image Model** (only if mode is image)
   - `Nano Banana 2.1` — Default image model
   - `Nano Banana Pro` — Higher quality
   - `Nano Banana 2.1 Light` — Fastest

5. **Video Duration** (only if mode is video)
   - `4s` — 4 seconds
   - `6s` — 6 seconds
   - `8s` — 8 seconds (Default)
   - `10s` — 10 seconds
   - Any of the above with `-concat` suffix (e.g., `6s-concat`) to chain each scene from the last frame of the previous video for continuity

   > **Recommendation logic:** Calculate the average scene duration from the user's timeline. Recommend the closest available duration. If scenes have mixed durations, recommend the most common one and note that scenes will be batched by duration.

6. **Outputs Per Scene**
   - `1` — One variation per prompt (Default, fastest)
   - `2` — Two variations per prompt (pick the best)
   - `3` — Three variations per prompt
   - `4` — Four variations per prompt (most options, slowest)

   > **Recommendation logic:** For first-time generation, recommend `1` (fastest). If the user wants creative options to choose from, recommend `2`.

7. **Download Quality**
   - For video: `720` (Default, immediate), `1080` (upscaled), `4k` (upscaled, slowest)
   - For image: `1k` (Default), `2k`, `4k`

   > **Recommendation logic:** Recommend `720` for quick previews/drafts. Recommend `1080` for final production quality. Only recommend `4k` if the user explicitly mentions high-resolution or 4K output.

8. **Project Folder Name**
   - Suggest a name derived from the story title (e.g., `TheRedBalloon`, `SummerVibes`). Let the user confirm or change it. This will be used as the subfolder name inside the workspace where all generated assets are copied after download.

### Step 3 — Format Scene Prompts (With Per-Scene Overrides & Mixed Media)
Format each B-roll as a scene prompt. The Pro engine supports **per-scene overrides**, allowing mixed media (images and videos with different durations or models in a single batch!):

**Option A: Inline Bracket Overrides (Easiest)**
Attach configuration tags directly inside the scene prompt string:
- `[mode:textToImage]` or `[mode:textToVideo]`
- `[duration:4s]`, `[duration:6s]`, `[duration:8s]`, `[duration:10s]`
- `[model:Omni 1.1 Flash]`, `[model:Veo 3.1 - Fast]`, `[model:Nano Banana Pro]`
- `[ratio:16:9]`, `[ratio:9:16]`, `[ratio:1:1]`
- `[outputs:1]` or `[outputs:2]`

*Example:*
```text
Scene 1 — [mode:textToImage] [model:Nano Banana 2.1] [ratio:16:9] Dramatic cinematic establishing still of a quiet autumn street at sunset.
Scene 2 — [duration:4s] [model:Omni 1.1 Flash] Medium shot of @Aarav looking up sadly as the balloon gets caught on a branch.
Scene 3 — [duration:6s] [model:Omni 1.1 Flash] Dynamic action shot: @Bruno sprints and leaps at the tree trunk trying to reach the balloon.
```
*(The extension automatically parses these tags, configures the Google Flow dock per scene, and strips the tags so Google Flow only receives the clean visual prompt!)*

**Option B: Structured Storyboard JSON File (`storyboard.json`)**
For complex multi-scene projects, pass a `.json` file containing a `scenes` array:
```json
{
  "scenes": [
    {
      "prompt": "Cinematic establishing still of autumn street...",
      "mode": "textToImage",
      "model": "Nano Banana 2.1",
      "aspectRatio": "16:9"
    },
    {
      "prompt": "@Aarav looks up sadly as his balloon is caught...",
      "mode": "textToVideo",
      "duration": "4s",
      "model": "Omni 1.1 Flash"
    },
    {
      "prompt": "@Bruno sprints and leaps against the tree trunk...",
      "mode": "textToVideo",
      "duration": "6s",
      "model": "Omni 1.1 Flash"
    }
  ]
}
```

### Step 4 — Present Scene Prompts for Review
Before executing the bridge, show the user the formatted scene prompts and settings matrix in a clear summary table with recommended rationale:

```
📋 Intelligent Storyboard Plan:
| Scene | Type | Duration | Model | Rationale |
|---|---|---|---|---|
| 1 | Image | Still | Nano Banana 2.1 | [Recommended] Establishing shot, zero motion needed |
| 2 | Video | 4s | Omni 1.1 Flash | [Recommended] Subtle character reaction shot |
| 3 | Video | 6s | Omni 1.1 Flash | [Recommended] Action jump, multi-character |

Proceed with generation?
```

### Step 5 — Execute the Bridge (Blocking Mode with Inbuilt Auto-Copy)
Run the bridge script. **CRITICAL RULES:**
- **ALWAYS run in blocking mode** (do NOT use `--no-wait`). The blocking mode keeps the bridge daemon alive, streams live progress logs, and automatically copies completed assets directly to your project workspace!
- **Pass `--project-name`**: Provide the user's story or project name (e.g. `--project-name TheRedBalloon`). The bridge will automatically create `<current_workspace>/<project-name>` and copy all downloaded videos/images directly into it upon completion!

```bash
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run \
  --project-name "TheRedBalloon" \
  --mode textToVideo \
  --aspect-ratio 16:9 \
  --model "Omni 1.1 Flash" \
  --duration 6s \
  --outputs 1 \
  --folder asidz-flow \
  --prompt "Scene 1 — 0–6 sec: ..." \
  --prompt "Scene 2 — 6–12 sec: ..."
```

The bridge will:
1. Automatically activate Google Chrome and focus the Google Flow workspace.
2. Automatically reveal the AutoFlow Side Panel on the Flow tab.
3. Queue the job to the extension with anti-throttling keep-alive enabled.
4. Stream live generation progress logs to stderr (e.g., `[AutoFlow INFO] Generating: 45% - 0/1 ready`).
5. **AUTOMATICALLY COPY all downloaded files from Chrome's download folder directly into your project folder** (`<workspace>/<project-name>/`).
6. Print a formatted Markdown delivery table and return `copiedFiles` with absolute file paths and preview links.

### Step 6 — Inbuilt Delivery & Review Directive (Zero Manual Copying Required)
Once the batch finishes, the bridge returns a structured JSON payload:
- `projectDirectory`: Absolute path of the destination project folder in the workspace.
- `copiedFiles`: Array of `{ sceneNumber, filename, absolutePath, fileUri, sizeFormatted }`.
- `summaryReport`: Pre-formatted Markdown table with direct clickable links.
- `reviewPrompt`: Explicit directive instructing the agent to prompt the user to review the footages.

**The agent MUST:**
1. Display the `summaryReport` table with clickable file links directly to the user.
2. Explicitly ask the user to review and verify the footages before proceeding with further editing or timeline assembly!

Example output presented to the user:
```
🎬 All Scenes Generated & Copied to Project Workspace!
📁 Folder: /path/to/workspace/TheRedBalloon/

| Scene | File | Size | Direct Preview Link |
|---|---|---|---|
| 1 | AsidZ_AutoFlow_Test_Scene1_16-9_video.mp4 | 3.2 MB | [Scene 1 Video](file:///path/to/workspace/TheRedBalloon/...) |
| 2 | AsidZ_AutoFlow_Test_Scene2_16-9_video.mp4 | 802 KB | [Scene 2 Video](file:///path/to/workspace/TheRedBalloon/...) |

👉 Please review the footage files above and confirm if you are satisfied, or if any scene needs regeneration before we proceed!
```
|-------|--------|----------|--------------------------------|--------|
| 1     | 0–4s   | 4s       | ProjectName_Scene1_16-9_video.mp4 | 3.2 MB |
| 2     | 4–8s   | 4s       | ProjectName_Scene2_16-9_video.mp4 | 802 KB |
| ...   | ...    | ...      | ...                            | ...    |

📁 Project Folder: /path/to/workspace/ProjectName/
⚙️ Settings: Mode, Ratio, Model, Duration, Quality
⏱️ Total generation time: X minutes
```

Include clickable file links to each video/image in the project folder so the user can preview them directly.

---

## 2. Quick-Start CLI Commands for AI Agents

### A. Generate Video B-Rolls (Auto-Paste Prompts + Apply Settings + Start Queue)
Run this command from your shell tool to send B-roll scenes to the extension, start generation on Google Flow, and wait until all files are downloaded:

```bash
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run \
  --mode textToVideo \
  --aspect-ratio 9:16 \
  --model "Veo 3.1 - Lite" \
  --duration 6s \
  --outputs 1 \
  --folder asidz-flow \
  --prompt "Scene 1 — 0–6 sec: Cinematic slow-motion close-up of rain droplets hitting a neon-lit street puddle at night, shallow depth of field." \
  --prompt "Scene 2 — 6–12 sec: Aerial drone shot rising above a misty pine forest at golden hour sunrise." \
  --prompt "Scene 3 — 12–18 sec: Over-the-shoulder shot of a video editor working on a dual-monitor timeline in a warm studio."
```

### B. Generate Multi-Character Video B-Rolls (Important Model Rule!)
Google Flow's `Veo 3.1` models (`Veo 3.1 - Lite`, `Veo 3.1 - Fast`, `Veo 3.1 - Quality`) have a strict **2-ingredient / character limit** and will stall at `0%` or fail when a prompt references 2 or more `@characters` or ingredients.
- **Rule**: Whenever prompts include `@CharacterName` mentions for 2+ characters (or use `componentsToVideo`), ALWAYS pass `--model "Omni 1.1 Flash"` or `--model "Omni 1.2 Flash"`. (The extension bridge also auto-upgrades `Veo` to `Omni 1.1 Flash` when it detects 2+ characters.)

```bash
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run \
  --mode textToVideo \
  --aspect-ratio 16:9 \
  --model "Omni 1.1 Flash" \
  --duration 6s \
  --prompt "Scene 1 — 0–6 sec: @Aarav sits on a roadside step after school and shares a biscuit with @Bruno." \
  --prompt "Scene 2 — 6–12 sec: @Bruno wags his tail beside @Aarav as the evening street lights glow."
```

### C. Generate High-Resolution Image B-Rolls
```bash
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run \
  --mode textToImage \
  --aspect-ratio 9:16 \
  --image-model "Nano Banana 2.1" \
  --image-quality 1k \
  --prompt "Scene 1 — Minimalist 3D isometric illustration of a glowing neural network chip on a dark matte surface." \
  --prompt "Scene 2 — Dramatic macro photograph of a vintage mechanical watch movement in warm tungsten light."
```

### D. Populate Extension Prompt Box Only (Without Auto-Starting)
If the user wants you to paste the B-roll prompts and configure the extension settings so they can review them before clicking **Start AutoFlow**:
```bash
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run \
  --populate-only \
  --mode textToVideo \
  --aspect-ratio 9:16 \
  --duration 6s \
  --prompt "Scene 1 — 0–6 sec: ..." \
  --prompt "Scene 2 — 6–12 sec: ..."
```

### E. Pass Prompts from a `.txt` or `.json` File
For larger B-roll lists (5+ scenes), write the prompts to a temporary `.txt` file (with one blank line `\n\n` between each scene) and pass `--prompts-file`:
```bash
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run \
  --prompts-file /tmp/broll_scenes.txt \
  --mode textToVideo \
  --aspect-ratio 16:9 \
  --model "Veo 3.1 - Lite" \
  --duration 8s
```

### F. Fire-and-Forget Mode + Status Polling / Stop
**Only use this mode if the user explicitly asks for it.** Otherwise, always use the default blocking mode (Section 2A).

If you want to trigger the batch without blocking your terminal turn, pass `--no-wait`:
```bash
# 1. Start the bridge daemon FIRST (run as background daemon process)
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py serve

# 2. Queue job without waiting
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run --no-wait -p "Scene 1 — ..."

# 3. Poll live status & downloaded files every 2 minutes until group_status.status == "completed"
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py status

# 4. Stop active queue if needed
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py stop
```

**IMPORTANT for `--no-wait` mode:**
- You MUST start the daemon with `serve` BEFORE dispatching jobs, and keep it running throughout the entire generation process. The daemon receives live events (`DOWNLOAD_SAVED`, `VIDEO_GENERATION_PROGRESS`, `PROMPT_GROUP_STATUS`) from the Chrome extension. If the daemon is not running, these events are lost and `status` will report nothing.
- Poll `status` every 2 minutes. The response contains:
  - `state.downloaded_files` — array of all downloaded file names (e.g., `["asidz-flow/Project_Scene1_16-9_video.mp4", ...]`)
  - `state.progress` — per-scene generation percentage (e.g., `{"1": 45, "2": 100}`)
  - `state.group_status.status` — `"running"`, `"completed"`, `"cancelled"`, or `"error"`
  - `state.group_status.processedCount` / `totalCount` — how many scenes are done vs. total
- Report each new download to the user as it appears in the status response.
- Only stop polling when `group_status.status` is `"completed"`.

---

## 3. Parameter Reference Table

| CLI Flag / MCP Property | Allowed Values | Default | Description |
|---|---|---|---|
| `--mode` / `mode` | `textToVideo`, `imageToVideo`, `componentsToVideo`, `textToImage`, `imageToImage`, `agentAutomation` | `textToVideo` | Google Flow generation mode. |
| `--aspect-ratio` / `aspectRatio` | `16:9`, `9:16`, `square`, `portrait`, `landscape` | `16:9` | `16:9` (Widescreen), `9:16` (Shorts/Reels), `square` (`1-1`), `portrait` (`4-5`), `landscape` (`21-9`). |
| `--model` / `model` | `Veo 3.1 - Lite`, `Veo 3.1 - Fast`, `Veo 3.1 - Quality`, `Omni 1.1 Flash`, `Omni 1.2 Flash` | `Veo 3.1 - Lite` | Video model. Use `Omni 1.1 Flash` or `Omni 1.2 Flash` for multi-character scenes. |
| `--image-model` / `imageModel` | `Nano Banana 2.1`, `Nano Banana Pro`, `Nano Banana 2.1 Light` | `Nano Banana 2.1` | Image generation model. |
| `--duration` / `duration` | `4s`, `6s`, `8s`, `10s`, `4s-concat`, `6s-concat`, `8s-concat`, `10s-concat` | `8s` | Video duration. Append `-concat` to chain each scene from the last frame of the previous video. |
| `--outputs` / `outputCount` | `1`, `2`, `3`, `4` | `1` | Number of variations generated per scene prompt. |
| `--video-quality` | `720`, `1080`, `4k`, `no-download` | `720` | Auto-download video resolution (`720` is immediate stream download; `1080`/`4k` triggers Flow upscale). |
| `--image-quality` | `1k`, `2k`, `4k`, `no-download` | `1k` | Auto-download image resolution. |
| `--folder` / `folderName` | Any folder name | `asidz-flow` | Subfolder inside Chrome Downloads where B-rolls are saved. |

---

## 4. Optional MCP Server Configuration (Claude Desktop / Antigravity / Cursor)

In addition to direct CLI execution, `bridge/asidz-agent-bridge.py` has a built-in **Model Context Protocol (MCP)** stdio server (`--mcp`) with zero external dependencies.

Add this entry to your `claude_desktop_config.json` or Antigravity/Cursor MCP settings to expose native tools (`autoflow_generate_brolls`, `autoflow_status`, `autoflow_stop`):

```json
{
  "mcpServers": {
    "asidz-autoflow": {
      "command": "python3",
      "args": [
        "/Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py",
        "--mcp"
      ]
    }
  }
}
```

---

## 5. Critical Agent Rules — Common Mistakes to AVOID

These are mandatory rules every AI agent MUST follow. Violating any of these will result in a broken workflow.

### ❌ NEVER do these:
1. **NEVER auto-select generation settings** without asking the user first. Always present options (Step 2).
2. **NEVER use `--no-wait`** unless the user explicitly asks for fire-and-forget mode. Always use the default blocking `run` command.
3. **NEVER try to access `~/Downloads` or the `asidz-flow/` folder directly** via `ls`, `cp`, `find`, `cat`, or any shell command. macOS TCC blocks terminal access to the Downloads folder. The folder will appear empty even though files exist there.
4. **NEVER scan the filesystem to find downloaded files.** Use the bridge's JSON response (`downloadedFiles`) or the `status` API — these are the ONLY reliable sources of truth for what has been downloaded.
5. **NEVER leave downloaded files only in `asidz-flow/`.** Always copy them to the user's project folder in the workspace (Step 7).
6. **NEVER run multiple batches in parallel.** Run them sequentially — one batch finishes before the next starts.
7. **NEVER use a `Veo` model when 2+ `@characters` are in the prompts.** Auto-switch to `Omni 1.1 Flash` or `Omni 1.2 Flash`.

### ✅ ALWAYS do these:
1. **ALWAYS ask the user for settings** before generating (Step 2).
2. **ALWAYS run in blocking mode** (no `--no-wait`) so the bridge returns `downloadedFiles` in its response.
3. **ALWAYS use `osascript` (Finder)** to copy files from `asidz-flow/` to the project folder.
4. **ALWAYS report progress** to the user — per-scene, per-batch.
5. **ALWAYS deliver a final summary report** with file names, sizes, and clickable links (Step 8).
6. **ALWAYS filter files during copy** — only copy files matching the current job's scene numbers and settings. Do not copy old files from previous runs.
7. **ALWAYS create the project folder** inside the user's current workspace directory, not in `/tmp`, not on the Desktop, not in any other location.

---

## 6. Handling Scenes with Different Durations

When a story has scenes with different durations (e.g., some 4s and some 6s), the `--duration` flag applies to all scenes in a single bridge `run` command. To handle mixed durations:

1. **Group scenes by duration** (e.g., all 4s scenes together, all 6s scenes together).
2. **Run one batch per duration group**, sequentially:
   ```bash
   # Batch 1: 4s scenes
   python3 .../asidz-agent-bridge.py run --duration 4s --prompt "Scene 1 — ..." --prompt "Scene 2 — ..."
   
   # Batch 2: 6s scenes (after Batch 1 completes)
   python3 .../asidz-agent-bridge.py run --duration 6s --prompt "Scene 3 — ..." --prompt "Scene 4 — ..."
   ```
3. **Report progress after each batch** completes.
4. **Copy ALL files to the project folder only after ALL batches finish.**

---

## 7. Bridge JSON Response Reference

When the bridge runs in blocking mode (no `--no-wait`), it returns a JSON object on stdout:

```json
{
  "ok": true,
  "jobId": "job-1794509851967-c91437",
  "status": "completed",
  "promptCount": 3,
  "settings": {
    "mode": "textToVideo",
    "aspectRatio": "16:9",
    "model": "Omni 1.1 Flash",
    "defaultVideoOption": "6s",
    "outputCount": 1,
    "folderName": "asidz-flow"
  },
  "downloadedFiles": [
    "asidz-flow/ProjectName_Scene1_16-9_video.mp4",
    "asidz-flow/ProjectName_Scene2_16-9_video.mp4",
    "asidz-flow/ProjectName_Scene3_16-9_video.mp4"
  ],
  "groupStatus": {
    "status": "completed",
    "processedCount": 3,
    "totalCount": 3
  },
  "error": null
}
```

**Key fields for post-generation workflow:**
- `ok` — `true` if the batch completed without errors
- `status` — `"completed"`, `"error"`, `"cancelled"`
- `downloadedFiles` — Array of relative file paths. Use the **file names** (basename) from this list to identify which files to copy from `asidz-flow/` to the project folder via `osascript`.
- `groupStatus.processedCount` / `totalCount` — confirms all scenes were processed
- `error` — `null` on success, error message string on failure
