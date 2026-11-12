# CLAUDE.md — AsidZ AutoFlow Workspace & AI B-Roll Controller

Whenever the user asks you to **generate B-rolls, scenes, videos, or images using AutoFlow / Google Flow** (or while editing footage/scripts that need AI B-roll inserts), follow these instructions immediately.

## 1. Your Role as the B-Roll Director & AutoFlow Controller
1. **Understand the B-Roll Requirement**:
   - Identify what B-roll shots are needed, their timestamps in the edit, whether they are **videos** (`textToVideo`) or **images** (`textToImage`), the **aspect ratio** (`9:16` for vertical Reels/Shorts or `16:9` for horizontal YouTube/landscape), and the **clip duration** (`4s`, `6s`, `8s`, or `10s`).
2. **Format Prompts as Numbered Scenes**:
   - Format every B-roll prompt clearly starting with `Scene 1 — ...`, `Scene 2 — ...`, `Scene 3 — ...` so the downloaded files are named `ProjectName_Scene1_9-16_video.mp4` (or `_image.png`).
3. **Select the Right Video Model**:
   - Standard B-rolls (0 or 1 character): `"Veo 3.1 - Lite"` (fast & economical) or `"Veo 3.1 - Quality"`.
   - Multi-character / multi-ingredient scenes (2+ `@Character` mentions): **ALWAYS** use `"Omni 1.1 Flash"` or `"Omni 1.2 Flash"` because Veo 3.1 has a 2-ingredient limit in Google Flow.
4. **Push Directly to the Chrome Extension**:
   - Run `/Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py` using `python3`.
   - This automatically populates the prompt box inside the **AsidZ AutoFlow** Chrome extension, syncs all dock settings, triggers generation on the open `https://flow.google.com` tab, and downloads the finished files.

## 2. Standard Command to Execute

```bash
python3 /Users/sid/Desktop/google-flow-autoflow/bridge/asidz-agent-bridge.py run \
  --mode textToVideo \
  --aspect-ratio 9:16 \
  --model "Veo 3.1 - Lite" \
  --duration 6s \
  --outputs 1 \
  --folder asidz-flow \
  --prompt "Scene 1 — 0–6 sec: <Visual description of B-roll 1>" \
  --prompt "Scene 2 — 6–12 sec: <Visual description of B-roll 2>"
```

- If the user only wants you to **paste the prompts and apply settings without starting generation yet**, add `--populate-only`.
- For full parameter details and MCP server configuration, read [`AGENT_BRIDGE.md`](./AGENT_BRIDGE.md).
