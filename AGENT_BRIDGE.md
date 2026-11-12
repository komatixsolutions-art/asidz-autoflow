# AsidZ AutoFlow — AI Agent Bridge & B-Roll Automation Manual (`AGENT_BRIDGE.md`)

**Official Platform:** [https://asidz.com](https://asidz.com)  
**Repository Root:** `/Users/sid/Desktop/google-flow-autoflow`  
**Bridge Script:** `/Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py`

This document provides complete instructions for **Claude Desktop**, **Antigravity**, **Cursor**, **Windsurf**, and any local AI coding agent to control the **AsidZ AutoFlow** Chrome extension on **Google Flow** (`https://flow.google.com`) to generate and download AI B-roll videos and images automatically.

## 1. How the Local Agent Bridge Works (100% Free & Zero-Setup)

When a user is editing raw footage or a script and asks you (the AI agent) to generate B-rolls using **AsidZ AutoFlow**:
1. **You analyze the video timeline or script** to determine how many B-rolls are needed, what each B-roll depicts, the target aspect ratio (`9:16` for Shorts/Reels or `16:9` for YouTube/widescreen), the clip duration (`4s`, `6s`, `8s`, `10s`), and whether each B-roll should be a **video** (`textToVideo`) or **image** (`textToImage`).
2. **You format each B-roll as a scene prompt**:
   - Format: `Scene 1 — 0–6 sec: <detailed visual prompt>`
   - Separate scenes either by passing multiple `--prompt` flags or writing a `.txt` file with one empty line (`\n\n`) between scenes.
3. **You execute `bridge/asidz-agent-bridge.py`**:
   - The bridge script immediately queues the job on `127.0.0.1:45788` (and also includes a macOS Chrome DOM `postMessage` fallback).
   - The **AsidZ AutoFlow** Chrome extension picks up the job within 1–2 seconds, populates the `#prompts` box in the Side Panel UI, applies all dock settings (`mode`, `aspectRatio`, `model`, `duration`, `outputCount`, `folderName`), and starts generating on Google Flow.
4. **Auto-Download & Naming Convention**:
   - Every completed B-roll is automatically downloaded to Chrome's Downloads folder under the subfolder `asidz-flow/` (i.e. `~/Downloads/asidz-flow/`).
   - Every file is named with 4 parts:
     ```text
     <ProjectName>_<SceneN>_<AspectRatio>_<Type>.<ext>
     ```
   - Examples:
     - `MyProject_Scene1_9-16_video.mp4`
     - `MyProject_Scene2_9-16_image.png`
     - `DocumentaryEdit_Scene3_16-9_video.mp4`

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
If you want to trigger the batch without blocking your terminal turn, pass `--no-wait`:
```bash
# 1. Start background daemon (if not already running) & queue job without waiting
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run --no-wait -p "Scene 1 — ..."

# 2. Check live status & downloaded files
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py status

# 3. Stop active queue if needed
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py stop
```

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
