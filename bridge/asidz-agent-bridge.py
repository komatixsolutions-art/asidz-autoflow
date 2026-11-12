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
import json
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
    prompts,
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
):
    if isinstance(prompts, str):
        prompt_list = [p.strip() for p in prompts.split("\n\n") if p.strip()]
    else:
        prompt_list = [str(p).strip() for p in (prompts or []) if str(p).strip()]

    normalized_prompts = []
    for idx, p in enumerate(prompt_list, start=1):
        if not p.lower().startswith("scene ") and not p.startswith("#"):
            normalized_prompts.append(f"Scene {idx} — {p}")
        else:
            normalized_prompts.append(p)

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
    }

    return {
        "id": f"job-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}",
        "action": "run" if auto_start else "populate",
        "autoStart": bool(auto_start),
        "prompts": normalized_prompts,
        "promptsText": "\n\n".join(normalized_prompts),
        "settings": settings,
        "createdAt": int(time.time() * 1000),
    }


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
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
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


def dispatch_and_wait(job, wait_for_completion=True, timeout_seconds=1800, stream_stdout=True):
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
                print(f"[AutoFlow {lvl}] {msg}", file=sys.stderr)
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

        if status in ("completed", "cancelled", "error"):
            break

        time.sleep(1.0)

    try:
        final_state = (http_json("GET", "/api/agent/status") or {}).get("state") or {}
    except Exception:
        final_state = dict(BRIDGE_STATE)

    downloaded_rel = final_state.get("downloaded_files") or []

    return {
        "ok": final_state.get("status") not in ("error", "queued"),
        "jobId": job.get("id"),
        "status": final_state.get("status"),
        "promptCount": len(job.get("prompts") or []),
        "settings": job.get("settings"),
        "downloadedFiles": downloaded_rel,
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
                result = dispatch_and_wait(job, wait_for_completion=wait_flag, stream_stdout=False)
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

    sub.add_parser("status", help="Get current AutoFlow queue status and downloaded B-roll files")
    sub.add_parser("stop", help="Stop the active AutoFlow batch run")
    sub.add_parser("serve", help="Run persistent local bridge daemon")

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

    if args.cmd == "run":
        prompts = list(args.prompt or [])
        if args.prompts_file:
            raw = Path(args.prompts_file).read_text(encoding="utf-8")
            if args.prompts_file.endswith(".json"):
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    prompts.extend(str(x) for x in parsed)
                elif isinstance(parsed, dict) and "prompts" in parsed:
                    prompts.extend(str(x) for x in parsed["prompts"])
            else:
                prompts.extend([p.strip() for p in raw.split("\n\n") if p.strip()])

        if not prompts:
            print(json.dumps({"ok": False, "error": "Provide at least one --prompt or --prompts-file"}))
            sys.exit(1)

        job = build_job_payload(
            prompts=prompts,
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
        )
        wait_flag = (not args.no_wait) and (not args.populate_only)
        res = dispatch_and_wait(job, wait_for_completion=wait_flag, timeout_seconds=args.timeout)
        print(json.dumps(res, indent=2))
        return

    parser.print_help()


if __name__ == "__main__":
    main()
