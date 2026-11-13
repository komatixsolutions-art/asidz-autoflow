#!/usr/bin/env python3
"""
AsidZ AutoFlow — Local AI Agent Bridge CLI & MCP Server
Official Platform: https://asidz.com

Zero-dependency Python 3 bridge that lets Claude Desktop, Antigravity, Cursor,
Windsurf, or any local AI coding agent control the AsidZ AutoFlow Chrome extension:
1. Populates B-roll scene prompts into the extension's prompt box.
2. Applies generation settings (mode, aspectRatio, model, duration, outputCount, folderName).
3. Automatically starts the AutoFlow queue on Google Flow (or populates only).
4. Streams live progress and returns downloaded B-roll file paths.
"""

import argparse
import base64
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

BRIDGE_PORT = 45788
BRIDGE_HOST = "127.0.0.1"
STATE_LOCK = threading.Lock()

BRIDGE_STATE = {
    "pending_job": None,
    "active_job": None,
    "status": "idle",
    "group_status": None,
    "progress": {},
    "downloaded_files": [],
    "logs": [],
    "error": None,
    "updated_at": time.time(),
}


def build_job_payload(
    prompts=None,
    scenes=None,
    mode="textToVideo",
    aspect_ratio="16:9",
    model=None,
    image_model=None,
    duration="8s",
    output_count=1,
    folder_name="asidz-flow",
    video_quality="720",
    image_quality="1k",
    auto_start=True,
    delay_min=0,
    delay_max=5,
    max_retries=1,
    project_url=None,
    project_name=None,
):
    normalized_prompts = []
    normalized_scenes = []

    if scenes and isinstance(scenes, list):
        for idx, sc in enumerate(scenes, start=1):
            if isinstance(sc, dict):
                p_text = str(sc.get("prompt", "")).strip()
                if not p_text.lower().startswith("scene ") and not p_text.startswith("#"):
                    p_text = f"Scene {idx} — {p_text}"
                sc_copy = dict(sc)
                sc_copy["prompt"] = p_text
                normalized_scenes.append(sc_copy)
                normalized_prompts.append(p_text)
            else:
                s_str = str(sc).strip()
                if not s_str.lower().startswith("scene ") and not s_str.startswith("#"):
                    s_str = f"Scene {idx} — {s_str}"
                normalized_prompts.append(s_str)
                normalized_scenes.append({"prompt": s_str})
    elif prompts is not None:
        if isinstance(prompts, str):
            prompt_list = [p.strip() for p in prompts.split("\n\n") if p.strip()]
        else:
            prompt_list = [str(p).strip() for p in (prompts or []) if str(p).strip()]

        for idx, p in enumerate(prompt_list, start=1):
            if not p.lower().startswith("scene ") and not p.startswith("#"):
                p_str = f"Scene {idx} — {p}"
            else:
                p_str = p
            normalized_prompts.append(p_str)
            normalized_scenes.append({"prompt": p_str})

    is_video = mode in ("textToVideo", "imageToVideo", "componentsToVideo", "agentAutomationToVideo")
    default_v_model = model or "Veo 3.1 - Lite"
    default_i_model = image_model or (model if not is_video and model else "Nano Banana 2.1")

    settings = {
        "mode": mode,
        "aspectRatio": aspect_ratio,
        "outputCount": int(output_count),
        "model": default_v_model,
        "imageModel": default_i_model,
        "defaultVideoOption": duration,
        "folderName": folder_name,
        "autoDownloadVideoQuality": str(video_quality),
        "autoDownloadImageQuality": str(image_quality),
        "promptDelaySecondsMin": int(delay_min),
        "promptDelaySecondsMax": int(delay_max),
        "maxRetries": int(max_retries),
        "enableCharacterControl": True,
        "autoChangeFileName": True,
        "fileNamingSystem": "prompt_tag",
        "projectUrl": project_url,
        "projectName": project_name,
    }

    return {
        "id": f"job-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}",
        "action": "run" if auto_start else "populate",
        "autoStart": bool(auto_start),
        "projectName": project_name,
        "prompts": normalized_prompts,
        "promptsText": "\n\n".join(normalized_prompts),
        "scenes": normalized_scenes if normalized_scenes else None,
        "settings": settings,
        "createdAt": int(time.time() * 1000),
    }


def ensure_chrome_flow_focused(target_url=None):
    """
    Ensures Google Chrome is launched, brought to the front, unminimized,
    and navigated or focused to the Google Flow tab or specific project URL.
    """
    flow_url = target_url or "https://flow.google.com/"
    search_pattern = target_url if target_url else "flow.google.com"

    if sys.platform == "darwin":
        apple_script = f"""
        tell application "Google Chrome"
            activate
            set flowFound to false
            if (count of windows) > 0 then
                repeat with w in windows
                    repeat with t in tabs of w
                        if URL of t contains "{search_pattern}" or (URL of t contains "flow.google.com" and "{target_url or ''}" is "") then
                            set active tab index of w to (index of t)
                            set index of w to 1
                            set flowFound to true
                            exit repeat
                        end if
                    end repeat
                    if flowFound then exit repeat
                end repeat
            end if
            if not flowFound then
                open location "{flow_url}"
            end if
        end tell
        delay 0.3
        tell application "System Events"
            keystroke "u" using {{command down, shift down}}
        end tell
        """
        try:
            subprocess.run(["osascript", "-e", apple_script], capture_output=True, timeout=5)
        except Exception:
            pass
    elif sys.platform.startswith("win"):
        try:
            subprocess.run(["cmd", "/c", "start", "chrome", flow_url], capture_output=True, timeout=5)
        except Exception:
            pass


def ensure_side_panel_visible():
    """
    Triggers the Chrome extension side panel shortcut (Command+Shift+U on macOS)
    so the side panel is visibly displayed during generation.
    """
    if sys.platform == "darwin":
        apple_script = """
        tell application "Google Chrome" to activate
        delay 0.2
        tell application "System Events"
            keystroke "u" using {command down, shift down}
        end tell
        """
        try:
            subprocess.run(["osascript", "-e", apple_script], capture_output=True, timeout=3)
        except Exception:
            pass


def trigger_chrome_dom_fallback(job):
    if sys.platform != "darwin":
        return False
    js_payload = json.dumps({"source": "ASIDZ_AGENT_BRIDGE", "type": "RUN_JOB", "job": job})
    apple_script = f"""
    tell application "Google Chrome"
        repeat with w in windows
            repeat with t in tabs of w
                if URL of t contains "flow.google.com" or URL of t contains "labs.google/fx" then
                    execute t javascript "window.postMessage({js_payload}, '*');"
                    return "sent"
                end if
            end repeat
        end repeat
    end tell
    """
    try:
        res = subprocess.run(
            ["osascript", "-e", apple_script],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return "sent" in (res.stdout or "")
    except Exception:
        return False


class BridgeHTTPHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _send_json(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, *")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        if self.path.startswith("/api/agent/poll"):
            with STATE_LOCK:
                job = BRIDGE_STATE["pending_job"]
                BRIDGE_STATE["pending_job"] = None
                if job:
                    BRIDGE_STATE["active_job"] = job
                    BRIDGE_STATE["status"] = "dispatched"
                    BRIDGE_STATE["updated_at"] = time.time()
            self._send_json(200, {"ok": True, "job": job})
            return

        if self.path.startswith("/api/agent/status"):
            with STATE_LOCK:
                snap = dict(BRIDGE_STATE)
            self._send_json(200, {"ok": True, "state": snap})
            return

        self._send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {}

        if self.path.startswith("/api/agent/enqueue"):
            job = payload.get("job") or payload
            with STATE_LOCK:
                BRIDGE_STATE["pending_job"] = job
                BRIDGE_STATE["active_job"] = job
                BRIDGE_STATE["status"] = "queued"
                BRIDGE_STATE["group_status"] = None
                BRIDGE_STATE["progress"] = {}
                BRIDGE_STATE["downloaded_files"] = []
                BRIDGE_STATE["error"] = None
                BRIDGE_STATE["char_results"] = None
                BRIDGE_STATE["char_success"] = False
                BRIDGE_STATE["scanned_characters"] = []
                BRIDGE_STATE["missing_characters"] = []
                BRIDGE_STATE["eval_result"] = None
                BRIDGE_STATE["eval_error"] = None
                BRIDGE_STATE["upload_success"] = None
                BRIDGE_STATE["upload_count"] = 0
                BRIDGE_STATE["logs"] = []
                BRIDGE_STATE["updated_at"] = time.time()
            self._send_json(200, {"ok": True, "jobId": job.get("id")})
            return

        if self.path.startswith("/api/agent/event"):
            ev_type = payload.get("type")
            with STATE_LOCK:
                BRIDGE_STATE["updated_at"] = time.time()
                if ev_type == "ACTION_LOG":
                    BRIDGE_STATE["logs"].append(
                        {
                            "level": payload.get("level", "info"),
                            "message": payload.get("message", ""),
                            "timestamp": payload.get("timestamp", int(time.time() * 1000)),
                        }
                    )
                    BRIDGE_STATE["logs"] = BRIDGE_STATE["logs"][-200:]
                elif ev_type == "DOWNLOAD_SAVED":
                    fn = payload.get("filename")
                    if fn and fn not in BRIDGE_STATE["downloaded_files"]:
                        BRIDGE_STATE["downloaded_files"].append(fn)
                elif ev_type == "VIDEO_GENERATION_PROGRESS":
                    d = payload.get("data") or {}
                    idx = d.get("promptIndex")
                    if idx is not None:
                        BRIDGE_STATE["progress"][str(idx)] = d.get("percentage", 0)
                elif ev_type == "PROMPT_GROUP_STATUS":
                    d = payload.get("data") or {}
                    BRIDGE_STATE["group_status"] = d
                    st = d.get("status")
                    if st in ("running", "completed", "cancelled", "error"):
                        BRIDGE_STATE["status"] = st
                    for fn in d.get("downloadedFiles") or []:
                        if fn not in BRIDGE_STATE["downloaded_files"]:
                            BRIDGE_STATE["downloaded_files"].append(fn)
                elif ev_type == "JOB_CONFIGURED":
                    BRIDGE_STATE["status"] = payload.get("status", "configured")
                elif ev_type == "JOB_STARTED":
                    BRIDGE_STATE["status"] = "running"
                elif ev_type == "JOB_STOPPED":
                    BRIDGE_STATE["status"] = "cancelled"
                elif ev_type == "JOB_ERROR":
                    BRIDGE_STATE["status"] = "error"
                    BRIDGE_STATE["error"] = payload.get("error", "Unknown error")
                elif ev_type == "EVAL_RESULT":
                    BRIDGE_STATE["eval_result"] = payload.get("evalResult")
                    BRIDGE_STATE["eval_error"] = payload.get("evalError")
                    BRIDGE_STATE["status"] = "eval_done"
                elif ev_type == "FILES_UPLOADED":
                    BRIDGE_STATE["upload_success"] = payload.get("success")
                    BRIDGE_STATE["upload_count"] = payload.get("count")
                    BRIDGE_STATE["error"] = payload.get("error")
                    BRIDGE_STATE["status"] = "upload_done"
                elif ev_type == "CHARACTERS_REGISTERED":
                    BRIDGE_STATE["char_results"] = payload.get("results")
                    BRIDGE_STATE["scanned_characters"] = payload.get("scannedCharacters")
                    BRIDGE_STATE["missing_characters"] = payload.get("missing")
                    BRIDGE_STATE["char_success"] = payload.get("success")
                    BRIDGE_STATE["error"] = payload.get("error")
                    BRIDGE_STATE["status"] = "chars_done"
            self._send_json(200, {"ok": True})
            return

        self._send_json(404, {"ok": False, "error": "Not found"})


def start_local_server():
    try:
        server = ThreadingHTTPServer((BRIDGE_HOST, BRIDGE_PORT), BridgeHTTPHandler)
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        return server
    except OSError:
        return None


def http_json(method, path, data=None, timeout=5):
    url = f"http://{BRIDGE_HOST}:{BRIDGE_PORT}{path}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = Request(url, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def collect_character_payload(characters_dir):
    """
    Scans a project's characters/ directory, groups character sheets by character name,
    reads the images, encodes them as base64 data URIs, and returns a structured payload
    ready for Flow's native character creation module.
    """
    if not characters_dir or not os.path.exists(characters_dir):
        return []

    char_map = {}
    valid_exts = (".png", ".jpeg", ".jpg", ".webp")
    for f in sorted(os.listdir(characters_dir)):
        p = os.path.join(characters_dir, f)
        if not os.path.isfile(p):
            continue
        ext = os.path.splitext(f)[1].lower()
        if ext not in valid_exts:
            continue

        # Extract character name from filename (e.g. Meera_Portrait.jpeg -> Meera)
        name_part = f.split("_")[0].split("-")[0].strip()
        if not name_part or name_part.lower() in ("nov", "scene", "image", "asset"):
            continue
        char_name = name_part.capitalize()

        # Prioritize official sheets: Portrait and Turnaround_3View / Turnaround
        f_lower = f.lower()
        if not any(k in f_lower for k in ("portrait", "turnaround", "fullbody", "body", "sheet")):
            continue

        try:
            with open(p, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode("utf-8")
            mime = "image/png" if ext == ".png" else "image/jpeg"

            if char_name not in char_map:
                char_map[char_name] = []
            char_map[char_name].append({
                "filename": f,
                "path": os.path.abspath(p),
                "base64": f"data:{mime};base64,{b64}",
                "mimeType": mime,
            })
        except Exception as e:
            print(f"[AutoFlow WARN] Failed to read character image {p}: {e}", file=sys.stderr)

    result = []
    for name, imgs in char_map.items():
        # Select best portrait and best turnaround/body sheet
        portrait_img = next((img for img in imgs if "portrait" in img["filename"].lower()), None)
        turnaround_img = next((img for img in imgs if "turnaround" in img["filename"].lower()), None)
        if not turnaround_img:
            turnaround_img = next((img for img in imgs if any(k in img["filename"].lower() for k in ("body", "sheet"))), None)

        selected = []
        if portrait_img:
            selected.append(portrait_img)
        if turnaround_img and turnaround_img not in selected:
            selected.append(turnaround_img)

        # Fallback to all images if naming didn't match
        final_imgs = selected if selected else imgs[:2]
        result.append({"name": name, "images": final_imgs})

    return result


def copy_downloaded_assets_to_project(downloaded_files, project_dir=None, project_name=None, folder_name="asidz-flow"):
    """
    Locates all downloaded assets in Chrome's download folder (e.g. ~/Downloads/asidz-flow/),
    copies them into the active project directory (preserving timestamps/metadata),
    verifies file sizes, and returns structured metadata + formatted summary report.
    """
    if not downloaded_files:
        return [], "", os.path.abspath(project_dir or os.getcwd())

    # 1. Resolve final target directory in the active agent workspace
    base_dir = os.path.abspath(project_dir or os.getcwd())
    if project_name and str(project_name).strip():
        pname = str(project_name).strip()
        if os.path.basename(base_dir).lower() == pname.lower():
            final_dir = base_dir
        else:
            final_dir = os.path.join(base_dir, pname)
    else:
        final_dir = base_dir

    os.makedirs(final_dir, exist_ok=True)

    # 2. Potential Chrome download root directories
    dl_roots = [
        os.path.expanduser(f"~/Downloads/{folder_name}"),
        os.path.expanduser("~/Downloads"),
    ]

    copied_records = []
    seen_dest_paths = set()

    for item in downloaded_files:
        base_name = os.path.basename(item)
        if not base_name:
            continue
        base_stem, base_ext = os.path.splitext(base_name)

        src_path = None
        # Retry up to 8 seconds to allow Chrome to finalize writing/renaming from .crdownload
        for _attempt in range(8):
            for root in dl_roots:
                if not os.path.exists(root):
                    continue
                # Try exact filename first
                candidate = os.path.join(root, base_name)
                if os.path.exists(candidate) and os.path.getsize(candidate) > 0:
                    src_path = candidate
                    break
                # Try matching by filename stem (e.g. if extension changed between .png, .jpeg, .jpg)
                stem_matches = [
                    f for f in glob.glob(os.path.join(root, f"*{base_stem}*"))
                    if not f.endswith(".crdownload") and os.path.getsize(f) > 0
                ]
                if stem_matches:
                    src_path = stem_matches[0]
                    break

            if src_path:
                break
            time.sleep(1.0)

        if not src_path or not os.path.exists(src_path):
            continue

        real_filename = os.path.basename(src_path)
        dest_path = os.path.join(final_dir, real_filename)
        if dest_path in seen_dest_paths:
            continue

        try:
            shutil.copy2(src_path, dest_path)
            size_bytes = os.path.getsize(dest_path)
            if size_bytes >= 1024 * 1024:
                size_str = f"{size_bytes / (1024 * 1024):.1f} MB"
            else:
                size_str = f"{max(1, size_bytes // 1024)} KB"

            scene_m = re.search(r"Scene(\d+)", base_name, re.IGNORECASE)
            scene_num = scene_m.group(1) if scene_m else str(len(copied_records) + 1)

            record = {
                "sceneNumber": scene_num,
                "filename": base_name,
                "absolutePath": dest_path,
                "fileUri": f"file://{dest_path}",
                "sizeBytes": size_bytes,
                "sizeFormatted": size_str,
            }
            copied_records.append(record)
            seen_dest_paths.add(dest_path)
        except Exception as e:
            print(f"[AutoFlow WARN] Failed to copy {src_path} -> {dest_path}: {e}", file=sys.stderr)

    try:
        copied_records.sort(key=lambda r: int(r["sceneNumber"]))
    except Exception:
        pass

    # 3. Build formatted Markdown summary report
    report_lines = [
        "====================================================================",
        "🎬 ASIDZ AUTOFLOW — BATCH GENERATION & DELIVERY COMPLETE",
        "====================================================================",
        f"📁 Project Folder: {final_dir}",
        "",
        "| Scene | File | Size | Direct Preview Link |",
        "|---|---|---|---|",
    ]
    for r in copied_records:
        report_lines.append(f"| {r['sceneNumber']} | {r['filename']} | {r['sizeFormatted']} | [{r['filename']}]({r['fileUri']}) |")

    report_lines.extend([
        "",
        "====================================================================",
        f"👉 AGENT DIRECTIVE: All {len(copied_records)} assets are copied to the project directory.",
        "   Present this table with clickable links to the user and explicitly",
        "   prompt the user to review the footages before proceeding with editing!",
        "===================================================================="
    ])
    report_text = "\n".join(report_lines)

    return copied_records, report_text, final_dir


def dispatch_and_wait(job, wait_for_completion=True, timeout_seconds=1800, stream_stdout=True, project_dir=None, project_name=None, auto_copy=True):
    target_project_url = (job.get("settings") or {}).get("projectUrl")
    ensure_chrome_flow_focused(target_project_url)
    server = start_local_server()
    if server is not None:
        with STATE_LOCK:
            BRIDGE_STATE["pending_job"] = job
            BRIDGE_STATE["active_job"] = job
            BRIDGE_STATE["status"] = "queued"
            BRIDGE_STATE["group_status"] = None
            BRIDGE_STATE["progress"] = {}
            BRIDGE_STATE["downloaded_files"] = []
            BRIDGE_STATE["error"] = None
            BRIDGE_STATE["updated_at"] = time.time()
    else:
        http_json("POST", "/api/agent/enqueue", {"job": job})

    start_ts = time.time()
    dispatched = False
    last_log_idx = 0
    dom_fallback_tried = False

    while time.time() - start_ts < timeout_seconds:
        try:
            st_res = http_json("GET", "/api/agent/status")
            state = st_res.get("state") or {}
        except URLError:
            time.sleep(0.5)
            continue

        status = state.get("status", "idle")
        logs = state.get("logs") or []
        if stream_stdout and len(logs) > last_log_idx:
            for entry in logs[last_log_idx:]:
                lvl = str(entry.get("level", "info")).upper()
                msg = entry.get("message", "")
                print(f"[AutoFlow {lvl}] {msg}", file=sys.stderr, flush=True)
            last_log_idx = len(logs)

        if status != "queued":
            dispatched = True

        if not dispatched and not dom_fallback_tried and (time.time() - start_ts) > 4.0:
            dom_fallback_tried = True
            if trigger_chrome_dom_fallback(job):
                dispatched = True
                if not wait_for_completion or not job.get("autoStart", True):
                    break

        if not job.get("autoStart", True) and status in ("populated", "dispatched", "running"):
            break

        if not wait_for_completion and dispatched and status in ("dispatched", "starting", "running", "populated"):
            break

        if status in ("completed", "cancelled", "error", "eval_done", "chars_done", "upload_done"):
            break

        time.sleep(1.0)

    try:
        final_state = (http_json("GET", "/api/agent/status") or {}).get("state") or {}
    except Exception:
        final_state = dict(BRIDGE_STATE)

    downloaded_rel = final_state.get("downloaded_files") or []

    folder_name = (job.get("settings") or {}).get("folderName", "asidz-flow")
    copied_records = []
    summary_report = ""
    resolved_project_dir = os.path.abspath(project_dir or os.getcwd())

    if wait_for_completion and auto_copy and downloaded_rel:
        copied_records, summary_report, resolved_project_dir = copy_downloaded_assets_to_project(
            downloaded_files=downloaded_rel,
            project_dir=project_dir,
            project_name=project_name,
            folder_name=folder_name,
        )
        if stream_stdout and summary_report:
            print("\n" + summary_report + "\n", file=sys.stderr)

    return {
        "ok": final_state.get("status") not in ("error", "queued"),
        "jobId": job.get("id"),
        "status": final_state.get("status"),
        "promptCount": len(job.get("prompts") or []),
        "settings": job.get("settings"),
        "downloadedFiles": downloaded_rel,
        "projectDirectory": resolved_project_dir,
        "copiedFiles": copied_records,
        "summaryReport": summary_report,
        "reviewPrompt": (
            f"All {len(copied_records)} scene files have been automatically downloaded and copied to your project folder ({resolved_project_dir}). "
            "Please review the footage files above before proceeding to editing."
            if copied_records
            else None
        ),
        "evalResult": final_state.get("eval_result"),
        "evalError": final_state.get("eval_error"),
        "charSuccess": final_state.get("char_success"),
        "charResults": final_state.get("char_results"),
        "scannedCharacters": final_state.get("scanned_characters"),
        "missingCharacters": final_state.get("missing_characters"),
        "groupStatus": final_state.get("group_status"),
        "error": final_state.get("error"),
    }


MCP_TOOLS = [
    {
        "name": "autoflow_generate_brolls",
        "description": (
            "Send a batch of B-roll scene prompts and dock settings to the AsidZ AutoFlow Chrome extension "
            "on Google Flow (flow.google.com), populate the extension prompt box, and automatically generate "
            "and download the B-roll videos or images."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompts": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of scene prompts (e.g. ['Scene 1 — 0-6s: Cinematic aerial shot...', 'Scene 2 — 6-12s: Close-up...']).",
                },
                "mode": {
                    "type": "string",
                    "enum": ["textToVideo", "imageToVideo", "componentsToVideo", "textToImage", "imageToImage", "agentAutomation"],
                    "default": "textToVideo",
                },
                "aspectRatio": {
                    "type": "string",
                    "enum": ["16:9", "9:16", "square", "portrait", "landscape"],
                    "default": "16:9",
                },
                "model": {
                    "type": "string",
                    "default": "Veo 3.1 - Lite",
                    "description": "Video model ('Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality', 'Omni 1.1 Flash', 'Omni 1.2 Flash'). Use Omni 1.1/1.2 Flash when prompts reference 2+ @characters.",
                },
                "imageModel": {
                    "type": "string",
                    "default": "Nano Banana 2.1",
                },
                "duration": {
                    "type": "string",
                    "enum": ["4s", "6s", "8s", "10s", "4s-concat", "6s-concat", "8s-concat", "10s-concat"],
                    "default": "8s",
                },
                "outputCount": {
                    "type": "integer",
                    "default": 1,
                    "minimum": 1,
                    "maximum": 4,
                },
                "folderName": {
                    "type": "string",
                    "default": "asidz-flow",
                },
                "projectDir": {
                    "type": "string",
                    "description": "Destination directory in the coding agent workspace to automatically copy downloaded assets into (defaults to agent's current working directory).",
                },
                "projectName": {
                    "type": "string",
                    "description": "Optional project subfolder name to create inside the workspace directory (e.g. 'TheRedBalloon').",
                },
                "autoStart": {
                    "type": "boolean",
                    "default": True,
                },
                "waitForCompletion": {
                    "type": "boolean",
                    "default": True,
                },
            },
            "required": ["prompts"],
        },
    },
    {
        "name": "autoflow_status",
        "description": "Check the current execution progress and downloaded B-roll files from AsidZ AutoFlow.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "autoflow_stop",
        "description": "Stop the currently running AsidZ AutoFlow batch queue.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def run_mcp_stdio():
    start_local_server()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue

        req_id = req.get("id")
        method = req.get("method", "")
        params = req.get("params") or {}

        if method == "initialize":
            resp = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "asidz-autoflow-bridge", "version": "2.6.0"},
                },
            }
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        elif method == "notifications/initialized":
            continue
        elif method == "tools/list":
            resp = {"jsonrpc": "2.0", "id": req_id, "result": {"tools": MCP_TOOLS}}
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        elif method == "tools/call":
            name = params.get("name")
            args = params.get("arguments") or {}
            if name == "autoflow_generate_brolls":
                job = build_job_payload(
                    prompts=args.get("prompts") or [],
                    mode=args.get("mode", "textToVideo"),
                    aspect_ratio=args.get("aspectRatio", "16:9"),
                    model=args.get("model"),
                    image_model=args.get("imageModel"),
                    duration=args.get("duration", "8s"),
                    output_count=args.get("outputCount", 1),
                    folder_name=args.get("folderName", "asidz-flow"),
                    auto_start=args.get("autoStart", True),
                )
                wait_flag = bool(args.get("waitForCompletion", True)) and bool(args.get("autoStart", True))
                result = dispatch_and_wait(
                    job,
                    wait_for_completion=wait_flag,
                    stream_stdout=False,
                    project_dir=args.get("projectDir"),
                    project_name=args.get("projectName"),
                    auto_copy=not bool(args.get("noCopy", False)),
                )
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]},
                }
            elif name == "autoflow_status":
                try:
                    st = (http_json("GET", "/api/agent/status") or {}).get("state") or dict(BRIDGE_STATE)
                except Exception:
                    st = dict(BRIDGE_STATE)
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": json.dumps(st, indent=2)}]},
                }
            elif name == "autoflow_stop":
                stop_job = {"id": f"stop-{int(time.time() * 1000)}", "action": "stop"}
                result = dispatch_and_wait(stop_job, wait_for_completion=False, stream_stdout=False)
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]},
                }
            else:
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Unknown tool: {name}"},
                }
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        elif req_id is not None:
            resp = {"jsonrpc": "2.0", "id": req_id, "result": {}}
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()


def main():
    if "--mcp" in sys.argv:
        run_mcp_stdio()
        return

    parser = argparse.ArgumentParser(description="AsidZ AutoFlow — Local AI Agent Bridge CLI")
    sub = parser.add_subparsers(dest="cmd")

    run_p = sub.add_parser("run", help="Populate B-roll prompts, apply settings, and run AutoFlow")
    run_p.add_argument("--prompt", "-p", action="append", default=[], help="Scene prompt (can be passed multiple times)")
    run_p.add_argument("--prompts-file", "-f", help="Path to a .txt or .json file containing scene prompts")
    run_p.add_argument("--mode", default="textToVideo", choices=["textToVideo", "imageToVideo", "componentsToVideo", "textToImage", "imageToImage", "agentAutomation"])
    run_p.add_argument("--aspect-ratio", "--ratio", default="16:9", choices=["16:9", "9:16", "square", "portrait", "landscape"])
    run_p.add_argument("--model", default="Veo 3.1 - Lite", help="Video model name (e.g. 'Veo 3.1 - Lite', 'Omni 1.1 Flash', 'Omni 1.2 Flash')")
    run_p.add_argument("--image-model", default="Nano Banana 2.1", help="Image model name (e.g. 'Nano Banana 2.1', 'Nano Banana Pro')")
    run_p.add_argument("--duration", default="8s", help="Video duration ('4s', '6s', '8s', '10s' or '*-concat')")
    run_p.add_argument("--outputs", type=int, default=1, help="Outputs per prompt (1-4)")
    run_p.add_argument("--folder", default="asidz-flow", help="Download subfolder")
    run_p.add_argument("--video-quality", default="720", choices=["no-download", "720", "1080", "4k"])
    run_p.add_argument("--image-quality", default="1k", choices=["no-download", "1k", "2k", "4k"])
    run_p.add_argument("--populate-only", action="store_true", help="Only populate prompts & settings in the extension without starting")
    run_p.add_argument("--no-wait", action="store_true", help="Return immediately after dispatching to the extension")
    run_p.add_argument("--timeout", type=int, default=1800, help="Max seconds to wait for batch completion")
    run_p.add_argument("--project-dir", "--dest", help="Destination workspace/project directory to auto-copy downloaded assets into (defaults to agent's current working directory)")
    run_p.add_argument("--project-name", help="Optional project subfolder to create inside the workspace directory (e.g. 'TheRedBalloon')")
    run_p.add_argument("--project-url", "--flow-project", help="Direct Google Flow project URL (e.g. 'https://flow.google.com/project/abc123xyz') to run the batch inside")
    run_p.add_argument("--no-copy", action="store_true", help="Disable automatic copying of downloaded assets to project folder")
    run_p.add_argument("--skip-character-registration", "--existing-characters", dest="skip_character_registration", action="store_true", help="Assume characters already exist in Flow; skip character sheet ingestion")

    sub.add_parser("status", help="Get current AutoFlow queue status and downloaded B-roll files")
    sub.add_parser("stop", help="Stop the active AutoFlow batch run")
    sub.add_parser("serve", help="Run persistent local bridge daemon")
    eval_p = sub.add_parser("eval", help="Evaluate JavaScript expression in Google Flow tab via CDP")
    eval_p.add_argument("expr", help="JavaScript expression to evaluate")
    eval_p.add_argument("--url", help="Target Flow URL")
    reg_p = sub.add_parser("register-characters", help="Upload character sheets into Google Flow character registry and verify detection")
    reg_p.add_argument("--project-dir", required=True, help="Path to project directory containing characters/")
    reg_p.add_argument("--project-url", help="Direct Google Flow project URL")
    reg_p.add_argument("--timeout", type=int, default=180, help="Max seconds to wait for character registration")

    args = parser.parse_args()

    if args.cmd == "serve":
        srv = start_local_server()
        if not srv:
            print(json.dumps({"ok": True, "message": "Bridge server already running"}))
            return
        print(json.dumps({"ok": True, "message": "AsidZ AutoFlow Agent Bridge listening"}))
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return

    if args.cmd == "status":
        try:
            res = http_json("GET", "/api/agent/status")
            print(json.dumps(res, indent=2))
        except Exception as e:
            print(json.dumps({"ok": False, "error": f"Bridge daemon not running: {e}"}))
        return

    if args.cmd == "stop":
        stop_job = {"id": f"stop-{int(time.time() * 1000)}", "action": "stop"}
        res = dispatch_and_wait(stop_job, wait_for_completion=False)
        print(json.dumps(res, indent=2))
        return

    if args.cmd == "eval":
        eval_job = {
            "id": f"eval-{int(time.time() * 1000)}",
            "action": "eval",
            "expression": args.expr,
            "targetUrl": args.url or None,
        }
        res = dispatch_and_wait(eval_job, wait_for_completion=True, timeout_seconds=30, auto_copy=False)
        print(json.dumps(res, indent=2))
        return

    if args.cmd == "register-characters":
        target_dir = args.project_dir
        chars_dir = target_dir if target_dir.rstrip("/\\").endswith("characters") else os.path.join(target_dir, "characters")
        char_payload = collect_character_payload(chars_dir)
        if not char_payload:
            print(json.dumps({"ok": False, "error": f"No character sheets found in {chars_dir}"}))
            return

        print(f"[AutoFlow INFO] Found {len(char_payload)} character(s) in {chars_dir}: {', '.join(c['name'] for c in char_payload)}", file=sys.stderr, flush=True)
        proj_name = os.path.basename(target_dir.rstrip("/\\"))
        if proj_name.lower() in ("characters", "project", "flow"):
            proj_name = os.path.basename(os.path.dirname(target_dir.rstrip("/\\")))
        reg_job = {
            "id": f"reg-chars-{int(time.time() * 1000)}",
            "action": "register_characters",
            "projectName": proj_name,
            "characters": char_payload,
            "settings": {"projectUrl": args.project_url} if args.project_url else {}
        }
        res = dispatch_and_wait(reg_job, wait_for_completion=True, timeout_seconds=args.timeout, auto_copy=False)
        print(json.dumps(res, indent=2))
        return

    if args.cmd == "run":
        prompts = list(args.prompt or [])
        scenes = []
        if args.prompts_file:
            raw = Path(args.prompts_file).read_text(encoding="utf-8")
            if args.prompts_file.endswith(".json"):
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    for item in parsed:
                        if isinstance(item, dict):
                            scenes.append(item)
                        else:
                            prompts.append(str(item))
                elif isinstance(parsed, dict):
                    if "scenes" in parsed and isinstance(parsed["scenes"], list):
                        scenes.extend(parsed["scenes"])
                    elif "prompts" in parsed:
                        prompts.extend(str(x) for x in parsed["prompts"])
            else:
                prompts.extend([p.strip() for p in raw.split("\n\n") if p.strip()])

        if not prompts and not scenes:
            print(json.dumps({"ok": False, "error": "Provide at least one --prompt or --prompts-file"}))
            sys.exit(1)

        # STRICT CHARACTER INGESTION & DETECTION GATE:
        # If prompts contain @mentions, ensure character sheets are uploaded and detected in Flow first!
        all_text = " ".join(prompts or [str(s.get("prompt", "")) for s in scenes])
        char_mentions = re.findall(r"@(\w+)", all_text)
        if char_mentions and args.project_dir and not getattr(args, "skip_character_registration", False):
            unique_mentions = list(dict.fromkeys(char_mentions))
            print(f"[AutoFlow INFO] Detected character mentions: {', '.join(unique_mentions)}", file=sys.stderr, flush=True)
            chars_dir = os.path.join(args.project_dir, "characters")
            if os.path.exists(chars_dir):
                char_payload = collect_character_payload(chars_dir)
                if char_payload:
                    print(f"[AutoFlow INFO] Auto-ingesting {len(char_payload)} character(s) into Google Flow Character module first...", file=sys.stderr, flush=True)
                    reg_job = {
                        "id": f"reg-chars-{int(time.time() * 1000)}",
                        "action": "register_characters",
                        "characters": char_payload,
                        "settings": {"projectUrl": args.project_url} if args.project_url else {}
                    }
                    reg_res = dispatch_and_wait(reg_job, wait_for_completion=True, timeout_seconds=90, auto_copy=False)
                    print(f"[AutoFlow INFO] Character verification result: {reg_res.get('status')}", file=sys.stderr, flush=True)

        proj_subfolder = args.project_name or (os.path.basename(args.project_dir.rstrip("/\\")) if args.project_dir else None)
        job = build_job_payload(
            prompts=prompts if not scenes else None,
            scenes=scenes if scenes else None,
            mode=args.mode,
            aspect_ratio=args.aspect_ratio,
            model=args.model,
            image_model=args.image_model,
            duration=args.duration,
            output_count=args.outputs,
            folder_name=args.folder,
            video_quality=args.video_quality,
            image_quality=args.image_quality,
            auto_start=not args.populate_only,
            project_url=args.project_url,
            project_name=proj_subfolder,
        )
        wait_flag = (not args.no_wait) and (not args.populate_only)
        res = dispatch_and_wait(
            job,
            wait_for_completion=wait_flag,
            timeout_seconds=args.timeout,
            project_dir=args.project_dir,
            project_name=args.project_name,
            auto_copy=not args.no_copy,
        )
        print(json.dumps(res, indent=2))
        return

    parser.print_help()


if __name__ == "__main__":
    main()
