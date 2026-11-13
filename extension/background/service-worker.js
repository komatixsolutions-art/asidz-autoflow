/**
 * AsidZ AutoFlow — Background Service Worker (Manifest V3)
 * Official Platform: https://asidz.com
 *
 * Responsibilities:
 * 1. CDP 1.3 Debugger Input Engine: Dispatches trusted mouse and keyboard events.
 * 2. Strict Flow-Only Download Coordinator: Directs ONLY Google Flow downloads to 'asidz-flow/'
 *    and leaves all other websites' downloads untouched in the default Chrome Downloads folder.
 * 3. Flow Tab Management & Side Panel Behavior: Keeps side panel open for Google Flow.
 */
'use strict';

const FLOW_PATTERNS = ['*://flow.google.com/*', '*://labs.google/fx/*'];
const FLOW_URL = 'https://flow.google.com/';
const SETTINGS_KEY = 'asidz_settings';
const FORM_KEY = 'asidz_form';
const CHARS_KEY = 'asidz_scanned_characters';

const DEFAULTS = {
  mode: 'textToVideo',
  agentType: 'agentAutomationToImage',
  aspectRatio: '16:9',
  outputCount: 1,
  agentOutputCount: 2,
  concurrentPrompts: 1,
  promptDelaySecondsMin: 0,
  promptDelaySecondsMax: 5,
  model: 'Veo 3.1 - Lite',
  imageModel: 'Nano Banana 2.1',
  defaultVideoOption: '8s',
  defaultImageOption: 'new-image',
  imageToVideoMaxImagesPerPrompt: 1,
  componentsToVideoMaxImagesPerPrompt: 3,
  imageToImageMaxImagesPerPrompt: 3,
  agentMaxImagesPerPrompt: 3,
  maxRetries: 1,
  autoDownloadVideoQuality: '720',
  autoDownloadImageQuality: '1k',
  autoAddCharacterImages: false,
  autoAddVoiceBySpeaker: false,
  defaultSpeaker: 'none',
  enableCharacterControl: true,
  defaultCharacters: [],
  autoChangeFileName: true,
  fileNamingSystem: 'prompt_tag',
  folderName: 'asidz-flow',
  zoomOutWhileRunning: true
};

/* ---------------- Download naming state ---------------- */
let folderPrefix = 'asidz-flow/'; // default folder
let namePrefix = '';              // tag prefix for files Flow downloads itself (upscaled)
let upscaleSessionUntil = 0;      // timestamp until which Flow native upscale downloads are intercepted
let autoRename = true;
let renameOffTimer = null;
const plannedNames = new Map();   // url -> "folder/file.ext"
let handledDownloads = 0;
let recentDownloadedFiles = [];   // tracks recent downloaded files for AI Agent Bridge reporting

const cleanSlashes = (s) => String(s || '').trim().replace(/^[/\\]+|[/\\]+$/g, '');

function isStrictFlowHost(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    return (
      u.hostname === 'flow.google.com' ||
      (u.hostname === 'labs.google' && u.pathname.startsWith('/fx'))
    );
  } catch (_) {
    return urlStr.includes('flow.google.com') || urlStr.includes('labs.google/fx');
  }
}

function onDeterminingFilename(item, suggest) {
  if (!autoRename) return;
  const url = item.url || '';
  const ref = item.referrer || '';
  const finalUrl = item.finalUrl || '';

  // Case 1: Explicitly requested by our extension via DOWNLOAD_RESOURCE (plannedNames)
  if (plannedNames.has(url)) {
    const dest = plannedNames.get(url).replace(/^[/\\]+/, '');
    plannedNames.delete(url);
    handledDownloads++;
    if (typeof recordDownloadedFile === 'function') recordDownloadedFile(dest);
    suggest({ filename: dest, conflictAction: 'uniquify' });
    return;
  }

  // Case 2: Triggered by our extension directly without plannedNames map entry
  const initiatedByOurExtension = item.byExtensionId === chrome.runtime.id;

  // Case 3: Native upscale download initiated by Google Flow page itself
  // MUST have a strict Flow referrer/URL OR be inside an active upscale request window
  const initiatedByFlowPage =
    !item.byExtensionId &&
    (isStrictFlowHost(ref) ||
      isStrictFlowHost(url) ||
      isStrictFlowHost(finalUrl) ||
      (Date.now() < upscaleSessionUntil &&
        (url.includes('googleusercontent.com') ||
          url.includes('storage.googleapis.com') ||
          url.startsWith('blob:') ||
          url.startsWith('data:'))));

  // Strictly ignore downloads from any other website or extension!
  if (!initiatedByOurExtension && !initiatedByFlowPage) {
    return;
  }

  const nameOrUrl = item.filename || url;
  const isVideo = /\.(mp4|webm|mov)$/i.test(nameOrUrl) || (item.mime || '').startsWith('video/');
  const isImage =
    /\.(jpg|jpeg|png|gif|webp|bmp|jfif)$/i.test(nameOrUrl) ||
    (item.mime || '').startsWith('image/') ||
    url.startsWith('data:image');
  if (!isVideo && !isImage) return;

  handledDownloads++;

  const original = item.filename || '';
  const base = original.split(/[/\\]/).pop() || original;
  const ext = base.includes('.') ? '.' + base.split('.').pop() : isVideo ? '.mp4' : '.png';
  let fn;
  if (namePrefix && namePrefix.trim()) {
    fn = folderPrefix + namePrefix.trim().replace(/_+$/, '') + ext;
  } else {
    fn = folderPrefix + (base || 'asidz_download' + ext);
  }
  const dest = fn.replace(/^[/\\]+/, '');
  if (typeof recordDownloadedFile === 'function') recordDownloadedFile(dest);
  suggest({ filename: dest, conflictAction: 'uniquify' });
}

function enableRename(on) {
  const has = chrome.downloads.onDeterminingFilename.hasListener(onDeterminingFilename);
  if (on && !has) chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);
  if (!on && has) chrome.downloads.onDeterminingFilename.removeListener(onDeterminingFilename);
}
enableRename(true);

/* ---------------- Side panel ---------------- */
async function setupPanel() {
  try {
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({ path: 'sidepanel/index.html', enabled: true });
    }
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (_) {}
}
setupPanel();

if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'open-side-panel' || command === '_execute_action') {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (tab && tab.windowId) {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        }
      } catch (err) {
        console.warn('[AutoFlow] Failed to open side panel on command:', err);
      }
    }
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await setupPanel();
  if (details.reason === 'install') {
    try {
      const tabs = await chrome.tabs.query({ url: FLOW_PATTERNS });
      for (const t of tabs) if (t.id) chrome.tabs.reload(t.id).catch(() => {});
    } catch (_) {}
  }
});

/* ---------------- Anti-Throttling Keep-Alive Alarm ---------------- */
try {
  if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'asidz_keepalive') {
        if (activeAgentJobId) {
          reportBridgeEvent({ type: 'ACTION_LOG', level: 'debug', message: 'Heartbeat keep-alive active' });
        }
      }
    });
    chrome.alarms.create('asidz_keepalive', { periodInMinutes: 0.5 });
  }
} catch (_) {}

/* ---------------- Debugger (CDP 1.3 trusted inputs) ---------------- */
const attached = new Set();
chrome.tabs.onRemoved.addListener((id) => attached.delete(id));
chrome.debugger.onDetach.addListener((src) => {
  if (src.tabId !== undefined) attached.delete(src.tabId);
});

async function ensureAttached(tabId) {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (!/already attached/i.test(msg)) throw e;
  }
  attached.add(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {});
    await chrome.debugger.sendCommand({ tabId }, 'Network.setCacheDisabled', { cacheDisabled: true });
    // Anti-throttling CDP Focus Emulation:
    // Forces Chrome rendering engine to treat Google Flow tab as permanently focused and visible,
    // preventing JavaScript timer throttling down to 1Hz or background pausing when minimized!
    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
  } catch (_) {}
}

const cdp = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params || {});

async function mouseMove(tabId, x, y) {
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers: 0 });
}
async function mouseClick(tabId, x, y) {
  await mouseMove(tabId, x, y);
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 });
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers: 0 });
}
async function keyPress(tabId, m) {
  const base = { key: m.key, code: m.code, windowsVirtualKeyCode: m.keyCode, nativeVirtualKeyCode: m.keyCode };
  if (m.text !== undefined) { base.text = m.text; base.unmodifiedText = m.text; }
  if (m.modifiers !== undefined) base.modifiers = m.modifiers;
  if (m.keyType) return cdp(tabId, 'Input.dispatchKeyEvent', { type: m.keyType, ...base });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: m.text !== undefined ? 'keyDown' : 'rawKeyDown', ...base });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/* =====================================================================
 * Local AI Agent Bridge (Claude Desktop / Antigravity / Cursor / CLI)
 * ===================================================================== */
const BRIDGE_PORT = 45788;
const BRIDGE_HOST = ['127', '0', '0', '1'].join('.');
const BRIDGE_BASE = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`;
let activeAgentJobId = null;
let activeAgentGroupId = null;
let bridgeBusy = false;

function recordDownloadedFile(dest) {
  if (!dest) return;
  recentDownloadedFiles.push({ filename: dest, timestamp: Date.now() });
  if (recentDownloadedFiles.length > 200) recentDownloadedFiles = recentDownloadedFiles.slice(-200);
  reportBridgeEvent({ type: 'DOWNLOAD_SAVED', filename: dest, timestamp: Date.now() });
}

function reportBridgeEvent(payload) {
  fetch(`${BRIDGE_BASE}/api/agent/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, jobId: activeAgentJobId, groupId: activeAgentGroupId })
  }).catch(() => {});
}

const escRe = (s) => String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

function resolveCharactersForPrompt(prompt, scannedChars, enableCharacterControl, defaultCharacters) {
  const found = [];
  const add = (c) => {
    if (c && !found.some((x) => x.toLowerCase() === c.toLowerCase())) found.push(c);
  };
  const byLen = (scannedChars || []).slice().sort((a, b) => b.length - a.length);
  let work = String(prompt || '');
  byLen.forEach((c) => {
    const re = new RegExp(`@${escRe(c)}(?![\\w])`, 'gi');
    if (re.test(work)) {
      add(c);
      work = work.replace(re, ' ');
    }
  });
  if (enableCharacterControl !== false) {
    byLen.forEach((c) => {
      const re = new RegExp(`(^|[^\\w@])${escRe(c)}(?![\\w])`, 'gi');
      if (re.test(work)) {
        add(c);
        work = work.replace(re, '$1 ');
      }
    });
    (String(prompt || '').match(/(^|\s)@([A-Za-z0-9_][\w-]{0,39})/g) || []).forEach((m) => {
      const w = m.trim().slice(1);
      if (!found.some((x) => w.toLowerCase().startsWith(x.toLowerCase()))) add(w);
    });
  }
  (defaultCharacters || []).forEach(add);
  return found.length ? found : null;
}

async function findOrOpenFlowTab(targetUrl) {
  const urlToOpen =
    targetUrl && typeof targetUrl === 'string' && (targetUrl.includes('flow.google.com') || targetUrl.includes('labs.google/fx'))
      ? targetUrl
      : FLOW_URL;

  let tabs = await chrome.tabs.query({ url: FLOW_PATTERNS });
  let tab;
  if (tabs && tabs.length) {
    tab = tabs.find((t) => t.active) || tabs[0];
    if (targetUrl && tab.url !== targetUrl) {
      try {
        await chrome.tabs.update(tab.id, { url: targetUrl });
        await new Promise((r) => setTimeout(r, 2000));
      } catch (_) {}
    }
  } else {
    tab = await chrome.tabs.create({ url: urlToOpen, active: true });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
        if (res && res.ok) break;
      } catch (_) {}
    }
  }

  // Active Browser Lifecycle & Side Panel Reveal:
  // 1. Unminimize and focus the window
  // 2. Activate the Flow tab
  // 3. Open the AutoFlow Side Panel visibly (with docked popup fallback if user gesture is required)
  if (tab && tab.id) {
    try {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true, state: 'normal' });
      }

      if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
        try {
          if (tab.windowId) {
            await chrome.sidePanel.open({ windowId: tab.windowId });
          } else {
            await chrome.sidePanel.open({ tabId: tab.id });
          }
        } catch (_) {
          // Native sidepanel requires user action or is already open
        }
      }
    } catch (err) {
      console.warn('[AutoFlow] Could not focus window/open sidePanel:', err);
    }
  }

  return tab;
}

async function sendTabMsg(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      const le = chrome.runtime.lastError;
      if (le) reject(new Error(le.message || 'Tab message failed'));
      else resolve(res);
    });
  });
}

function parseSceneConfig(item, updatedSettings, scannedChars, total, i) {
  let promptText = typeof item === 'string' ? item : (item && item.prompt ? item.prompt : '');
  let overrides = typeof item === 'object' && item ? { ...item } : {};

  // Extract inline bracket tags: [mode:textToImage], [duration:4s], [ratio:16:9], [model:Omni 1.1 Flash], [outputs:2]
  const tagRe = /\[(mode|duration|len|length|ratio|aspect|aspectRatio|model|imageModel|outputs|quality):\s*([^\]]+)\]/gi;
  let match;
  while ((match = tagRe.exec(promptText)) !== null) {
    const k = match[1].toLowerCase();
    const v = match[2].trim();
    if (k === 'mode') overrides.mode = v;
    else if (k === 'duration' || k === 'len' || k === 'length') overrides.duration = v;
    else if (k === 'ratio' || k === 'aspect' || k === 'aspectratio') overrides.aspectRatio = v;
    else if (k === 'model') overrides.model = v;
    else if (k === 'imagemodel') overrides.imageModel = v;
    else if (k === 'outputs') overrides.outputCount = parseInt(v, 10) || 1;
    else if (k === 'quality') overrides.quality = v;
  }
  const cleanPrompt = promptText.replace(tagRe, '').replace(/\s{2,}/g, ' ').trim();

  // Mode
  const effectiveMode = overrides.mode || (updatedSettings.mode === 'agentAutomation' ? updatedSettings.agentType : updatedSettings.mode) || 'textToVideo';
  const isVideo = ['textToVideo', 'imageToVideo', 'componentsToVideo', 'agentAutomationToVideo'].includes(effectiveMode);

  // Characters
  const characters = resolveCharactersForPrompt(
    cleanPrompt,
    scannedChars,
    updatedSettings.enableCharacterControl,
    updatedSettings.defaultCharacters
  );

  // Model
  let effectiveModel = overrides.model;
  if (!effectiveModel) {
    effectiveModel = isVideo ? updatedSettings.model : (overrides.imageModel || updatedSettings.imageModel);
  }
  if (isVideo && /\bveo\b/i.test(effectiveModel || '') && characters && characters.length >= 2) {
    effectiveModel = 'Omni 1.1 Flash';
  }

  // Duration
  let defOpt = isVideo ? updatedSettings.defaultVideoOption : updatedSettings.defaultImageOption;
  let effectiveDuration = overrides.duration || overrides.videoOption || defOpt || '8s';
  if (total > 0 && i === total - 1 && String(effectiveDuration).includes('-concat')) {
    effectiveDuration = String(effectiveDuration).split('-concat')[0];
  }
  const isConcat = String(effectiveDuration).includes('concat');

  // Aspect ratio
  const effectiveRatio = overrides.aspectRatio || overrides.ratio || updatedSettings.aspectRatio || '16:9';

  // Output count
  const effectiveOutputs = isConcat ? 1 : Number(overrides.outputCount || overrides.outputs || updatedSettings.outputCount) || 1;

  // Quality
  const autoDownloadResourceQuality = overrides.quality || (isVideo ? updatedSettings.autoDownloadVideoQuality : updatedSettings.autoDownloadImageQuality);

  return {
    prompt: cleanPrompt,
    mode: effectiveMode,
    images: overrides.images || [],
    speaker: updatedSettings.defaultSpeaker && updatedSettings.defaultSpeaker !== 'none' ? updatedSettings.defaultSpeaker : null,
    characters,
    aspectRatio: effectiveRatio,
    outputCount: effectiveOutputs,
    model: effectiveModel,
    videoOption: isVideo ? effectiveDuration : undefined,
    promptIndex: i + 1,
    autoDownloadResourceQuality,
    isConcat,
    maxRetries: Number(overrides.maxRetries ?? updatedSettings.maxRetries ?? 1),
    autoChangeFileName: updatedSettings.autoChangeFileName !== false,
    fileNamingSystem: updatedSettings.fileNamingSystem || 'prompt_tag',
    folderName: updatedSettings.folderName || 'asidz-flow',
    projectUrl: updatedSettings.projectUrl || null,
    projectName: updatedSettings.projectName || null
  };
}

async function uploadFilesViaCdp(tabId, filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { success: false, error: 'No files provided for upload' };
  }
  await ensureAttached(tabId);
  try { await cdp(tabId, 'DOM.enable', {}); } catch (_) {}

  // 1. Ensure media dialog is open
  await cdp(tabId, 'Runtime.evaluate', {
    expression: `(async () => {
      let sideBtn = document.querySelector('.sidebar-upload-btn');
      if (sideBtn) return 'ready';

      const addProjBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const t = (b.innerText || '').toLowerCase();
        return t.includes('add from project') || t.includes('upload');
      });
      if (addProjBtn) {
        addProjBtn.click();
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 150));
          if (document.querySelector('.sidebar-upload-btn')) return 'ready';
        }
      }

      // If not on character edit view, open left panel Characters and click + New character
      const charNavBtn = Array.from(document.querySelectorAll('button, a')).find(b => (b.innerText || '').includes('Characters'));
      if (charNavBtn) charNavBtn.click();
      await new Promise(r => setTimeout(r, 1000));

      const newCharTile = Array.from(document.querySelectorAll('button, flow-tile-container')).find(b => {
        return (b.innerText || '').toLowerCase().includes('new character');
      });
      if (newCharTile) {
        newCharTile.click();
        await new Promise(r => setTimeout(r, 1500));
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          const t = (b.innerText || '').toLowerCase();
          return t.includes('add from project') || t.includes('upload');
        });
        if (btn) {
          btn.click();
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 150));
            if (document.querySelector('.sidebar-upload-btn')) return 'ready';
          }
        }
      }

      return 'could not open media picker dialog';
    })()`,
    awaitPromise: true
  });

  // 2. Click .sidebar-upload-btn and capture the dynamic file input created by Google Flow
  const captureRes = await cdp(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      let capturedInput = null;
      const orig = document.createElement;
      document.createElement = function(tag) {
        const el = orig.apply(this, arguments);
        if (tag && tag.toLowerCase() === 'input') {
          el.setAttribute('data-asidz-upload-input', 'true');
          capturedInput = el;
        }
        return el;
      };

      const sideBtn = document.querySelector('.sidebar-upload-btn');
      if (sideBtn) sideBtn.click();
      document.createElement = orig;

      return capturedInput;
    })()`
  });

  if (!captureRes || !captureRes.result || !captureRes.result.objectId) {
    throw new Error('Could not capture Flow file input element');
  }

  // 3. Set real native OS files on the input via Chrome CDP
  await cdp(tabId, 'DOM.setFileInputFiles', {
    objectId: captureRes.result.objectId,
    files: filePaths
  });

  // 4. Dispatch change event to trigger Flow's native upload RPC
  await cdp(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      const inp = document.querySelector('input[data-asidz-upload-input="true"]') || document.querySelector('input[type="file"]');
      if (inp) {
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return 'dispatched change with ' + (inp.files ? inp.files.length : 0) + ' files';
      }
      return 'input not found for dispatch';
    })()`
  });

  // 5. Allow Google Flow time to process and commit native upload RPC
  await new Promise((r) => setTimeout(r, 8000));

  // 6. Close the media picker dialog
  await cdp(tabId, 'Runtime.evaluate', {
    expression: `(() => {
      const closeBtn = document.querySelector('flow-media-picker-dialog button[aria-label*="close" i], button.close-button');
      if (closeBtn) closeBtn.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    })()`
  });
  await new Promise((r) => setTimeout(r, 1000));

  return { success: true, count: filePaths.length };
}

async function executeAgentJob(job) {
  if (!job || !job.id) return;
  activeAgentJobId = job.id;

  try {
    const st = await chrome.storage.local.get([SETTINGS_KEY, FORM_KEY, CHARS_KEY, 'aws_settings', 'autoflowCharacters']);
    const currentSettings = {
      ...DEFAULTS,
      ...(st[SETTINGS_KEY] || st.aws_settings || {})
    };
    const scannedChars = Array.isArray(st[CHARS_KEY] || st.autoflowCharacters)
      ? st[CHARS_KEY] || st.autoflowCharacters
      : [];

    if (job.action === 'upload_files') {
      const targetProjectUrl = (job.settings && job.settings.projectUrl) || null;
      const tab = await findOrOpenFlowTab(targetProjectUrl);
      if (!tab || !tab.id) throw new Error('Flow tab not available for file upload');
      let uploadErr = null;
      let uploadRes = null;
      try {
        uploadRes = await uploadFilesViaCdp(tab.id, job.files || []);
      } catch (err) {
        uploadErr = String(err && err.message ? err.message : err);
      }
      reportBridgeEvent({
        type: 'FILES_UPLOADED',
        success: !!(uploadRes && uploadRes.success),
        count: uploadRes ? uploadRes.count : 0,
        error: uploadErr
      });
      return;
    }

    if (job.action === 'eval') {
      const tab = await findOrOpenFlowTab(job.targetUrl || null);
      if (!tab || !tab.id) throw new Error('No Flow tab available for eval');
      await ensureAttached(tab.id);
      const evalRes = await cdp(tab.id, 'Runtime.evaluate', {
        expression: job.expression,
        returnByValue: true,
        awaitPromise: true
      });
      reportBridgeEvent({
        type: 'EVAL_RESULT',
        evalResult: evalRes && evalRes.result ? evalRes.result.value : null,
        evalError: evalRes && evalRes.exceptionDetails ? JSON.stringify(evalRes.exceptionDetails) : null
      });
      return;
    }

    if (job.action === 'register_characters') {
      const targetProjectUrl = (job.settings && job.settings.projectUrl) || null;
      const tab = await findOrOpenFlowTab(targetProjectUrl);
      if (!tab || !tab.id) throw new Error('Flow tab not available for character registration');

      // 1. Gather all local file paths from characters payload
      const allPaths = [];
      for (const c of (job.characters || [])) {
        for (const img of (c.images || [])) {
          if (img.path && !allPaths.includes(img.path)) {
            allPaths.push(img.path);
          }
        }
      }

      // 2. Upload character sheets natively via CDP if provided
      if (allPaths.length > 0) {
        try {
          await uploadFilesViaCdp(tab.id, allPaths);
        } catch (upErr) {
          console.warn('[AutoFlow] Native upload warning:', upErr);
        }
      }

      const res = await sendTabMsg(tab.id, {
        type: 'REGISTER_CHARACTERS',
        projectName: job.projectName || null,
        characters: job.characters || []
      });
      if (res && res.scannedCharacters) {
        await chrome.storage.local.set({
          [CHARS_KEY]: res.scannedCharacters,
          autoflowCharacters: res.scannedCharacters
        });
      }
      reportBridgeEvent({
        type: 'CHARACTERS_REGISTERED',
        success: !!(res && res.success),
        results: (res && res.results) || [],
        scannedCharacters: (res && res.scannedCharacters) || [],
        missing: (res && res.missing) || [],
        error: (res && res.error) || null
      });
      return;
    }

    if (job.action === 'stop') {
      const targetProjectUrl = updatedSettings.projectUrl || incomingSettings.projectUrl || null;
    const tab = await findOrOpenFlowTab(targetProjectUrl);
      if (tab && tab.id && (job.groupId || activeAgentGroupId)) {
        await sendTabMsg(tab.id, {
          type: 'CANCEL_PROMPT_GROUP',
          groupId: job.groupId || activeAgentGroupId
        }).catch(() => {});
      }
      reportBridgeEvent({ type: 'JOB_STOPPED', status: 'cancelled' });
      return;
    }

    const incomingSettings = job.settings || {};
    const updatedSettings = { ...currentSettings };
    const allowedKeys = [
      'mode', 'agentType', 'aspectRatio', 'outputCount', 'agentOutputCount',
      'concurrentPrompts', 'promptDelaySecondsMin', 'promptDelaySecondsMax',
      'model', 'imageModel', 'defaultVideoOption', 'defaultImageOption',
      'maxRetries', 'autoDownloadVideoQuality', 'autoDownloadImageQuality',
      'enableCharacterControl', 'defaultSpeaker', 'autoChangeFileName',
      'fileNamingSystem', 'folderName', 'zoomOutWhileRunning', 'projectUrl', 'projectName'
    ];
    for (const k of allowedKeys) {
      if (incomingSettings[k] !== undefined && incomingSettings[k] !== null) {
        updatedSettings[k] = incomingSettings[k];
      }
    }
    if (job.projectName && !updatedSettings.projectName) {
      updatedSettings.projectName = job.projectName;
    }

    let rawScenes = [];
    if (Array.isArray(job.scenes) && job.scenes.length) {
      rawScenes = job.scenes;
    } else if (Array.isArray(job.prompts)) {
      rawScenes = job.prompts.map((p) => String(p || '').trim()).filter(Boolean);
    } else if (typeof job.promptsText === 'string' || typeof job.prompts === 'string') {
      const raw = String(job.promptsText || job.prompts || '');
      rawScenes = raw.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    }

    const total = rawScenes.length;
    const payloads = rawScenes.map((item, i) =>
      parseSceneConfig(item, updatedSettings, scannedChars, total, i)
    );

    const formattedPromptsText = payloads.map((p) => p.prompt).join('\n\n');
    const toStore = {
      [SETTINGS_KEY]: updatedSettings,
      aws_settings: updatedSettings
    };
    if (payloads.length > 0) {
      toStore[FORM_KEY] = { prompts: formattedPromptsText };
      toStore.aws_form = { prompts: formattedPromptsText };
    }
    await chrome.storage.local.set(toStore);

    chrome.runtime.sendMessage({
      type: 'AGENT_BRIDGE_SYNC',
      data: {
        settings: updatedSettings,
        promptsText: payloads.length > 0 ? formattedPromptsText : undefined,
        autoStart: job.autoStart !== false
      }
    }).catch(() => {});

    reportBridgeEvent({
      type: 'JOB_CONFIGURED',
      status: job.autoStart === false ? 'populated' : 'starting',
      promptCount: payloads.length,
      settings: updatedSettings
    });

    const targetProjectUrl = updatedSettings.projectUrl || incomingSettings.projectUrl || null;
    const tab = await findOrOpenFlowTab(targetProjectUrl);
    if (!tab || !tab.id) {
      throw new Error('Could not find or open Google Flow tab');
    }

    if (job.autoStart === false || !payloads.length) {
      return;
    }

    try {
      await sendTabMsg(tab.id, { type: 'PING' });
    } catch (_) {
      await chrome.tabs.reload(tab.id);
      for (let w = 0; w < 20; w++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const pong = await sendTabMsg(tab.id, { type: 'PING' });
          if (pong && pong.ok) break;
        } catch (_) {}
      }
    }

    const anyConcat = payloads.some((p) => p.isConcat);
    const concurrent =
      anyConcat || updatedSettings.mode === 'agentAutomation' ? 1 : Number(updatedSettings.concurrentPrompts) || 1;

    const groupId = `agent-group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    activeAgentGroupId = groupId;
    recentDownloadedFiles = [];

    const res = await sendTabMsg(tab.id, {
      type: 'AUTO_FILL_FLOW',
      payloads,
      groupId,
      concurrentPrompts: concurrent,
      promptDelaySecondsMin: Number(updatedSettings.promptDelaySecondsMin || 0),
      promptDelaySecondsMax: Number(updatedSettings.promptDelaySecondsMax || 5)
    });

    if (!res || !res.success) {
      throw new Error((res && res.error) || 'Failed to enqueue prompts in Flow content script');
    }

    reportBridgeEvent({
      type: 'JOB_STARTED',
      status: 'running',
      groupId: res.groupId || groupId,
      totalCount: payloads.length
    });
  } catch (e) {
    reportBridgeEvent({
      type: 'JOB_ERROR',
      status: 'error',
      error: e && e.message ? e.message : String(e)
    });
  }
}

async function pollAgentBridge() {
  if (bridgeBusy) return;
  bridgeBusy = true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${BRIDGE_BASE}/api/agent/poll`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res && res.ok) {
      const data = await res.json();
      if (data && data.job && data.job.id) {
        await executeAgentJob(data.job);
      }
    }
  } catch (_) {
  } finally {
    bridgeBusy = false;
  }
}

setInterval(pollAgentBridge, 2000);

// Auto-wake listeners: Whenever Chrome is focused, tab changed, or alarm triggers, poll bridge immediately
try {
  chrome.tabs.onActivated.addListener(() => { pollAgentBridge(); });
  chrome.windows.onFocusChanged.addListener((winId) => {
    if (winId !== chrome.windows.WINDOW_ID_NONE) pollAgentBridge();
  });
  if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'asidz_keepalive') {
        pollAgentBridge();
      }
    });
  }
} catch (_) {}

/* ---------------- Message Dispatcher ---------------- */
const errText = (e) => (e && e.message ? e.message : String(e));

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab && sender.tab.id;
  const needTab = () => {
    if (!tabId) {
      reply({ success: false, error: 'No tab id' });
      return false;
    }
    return true;
  };

  switch (msg && msg.type) {
    case 'POLL_BRIDGE_NOW':
      pollAgentBridge();
      reply({ success: true });
      return true;
    case 'SET_ZOOM':
      if (!needTab()) return false;
      chrome.tabs.setZoom(tabId, msg.zoomFactor)
        .then(() => reply({ success: true }))
        .catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    case 'DOWNLOAD_RESOURCE': {
      const { url, filename, folder, autoChangeFileName } = msg;
      const opts = { url, saveAs: false, conflictAction: 'uniquify' };
      if (autoChangeFileName !== false) {
        const f = cleanSlashes(folder || 'asidz-flow');
        const n = String(filename || '').trim().replace(/^[/\\]+/, '');
        const dest = f ? `${f}/${n}` : n;
        if (dest) { plannedNames.set(url, dest); opts.filename = dest; }
      }
      chrome.downloads.download(opts, (id) => {
        const le = chrome.runtime.lastError;
        reply(!le && id ? { success: true, downloadId: id } : { success: false, error: le ? le.message : 'Download failed to start' });
      });
      return true;
    }

    case 'SET_FOLDER_NAME': {
      if (typeof msg.folderName === 'string') folderPrefix = msg.folderName.trim() ? cleanSlashes(msg.folderName) + '/' : 'asidz-flow/';
      if (typeof msg.prefix === 'string') namePrefix = msg.prefix.trim();
      if (typeof msg.autoChangeFileName === 'boolean') autoRename = msg.autoChangeFileName;
      // Mark active upscale download window (3 minutes)
      upscaleSessionUntil = Date.now() + 180000;
      if (renameOffTimer) { clearTimeout(renameOffTimer); renameOffTimer = null; }
      enableRename(autoRename);
      reply({ success: true });
      return false;
    }

    case 'DOWNLOAD_COUNTER':
      reply({ count: handledDownloads });
      return false;

    case 'OPEN_DOWNLOAD_SETTINGS':
      chrome.tabs.create({ url: 'chrome://settings/downloads' });
      reply({ success: true });
      return false;

    case 'PROMPT_GROUP_STATUS': {
      const st = msg.data && msg.data.status;
      if (msg.data) {
        reportBridgeEvent({
          type: 'PROMPT_GROUP_STATUS',
          data: {
            ...msg.data,
            downloadedFiles: recentDownloadedFiles.map((f) => f.filename)
          }
        });
      }
      if (st === 'completed' || st === 'cancelled' || st === 'error') {
        if (renameOffTimer) clearTimeout(renameOffTimer);
        renameOffTimer = setTimeout(() => {
          namePrefix = '';
          upscaleSessionUntil = 0;
          renameOffTimer = null;
        }, 120000);
      }
      return false;
    }

    case 'ACTION_LOG': {
      if (msg.data) {
        reportBridgeEvent({
          type: 'ACTION_LOG',
          level: msg.data.level || 'info',
          message: msg.data.message || '',
          timestamp: msg.data.timestamp || Date.now()
        });
      }
      return false;
    }

    case 'VIDEO_GENERATION_PROGRESS': {
      if (msg.data) {
        reportBridgeEvent({
          type: 'VIDEO_GENERATION_PROGRESS',
          data: msg.data
        });
      }
      return false;
    }

    case 'AGENT_DOM_JOB': {
      if (msg.job) {
        executeAgentJob({ id: msg.job.id || `dom-${Date.now()}`, ...msg.job });
        reply({ success: true });
      } else {
        reply({ success: false, error: 'Missing job payload' });
      }
      return false;
    }

    case 'FETCH_AS_DATAURL':
      (async () => {
        try {
          const r = await fetch(msg.url, { credentials: 'include' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const blob = await r.blob();
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
          reply({ success: true, dataUrl: `data:${blob.type || 'image/png'};base64,${btoa(bin)}` });
        } catch (e) { reply({ success: false, error: errText(e) }); }
      })();
      return true;

    case 'DBG_ATTACH':
      if (!needTab()) return false;
      ensureAttached(tabId).then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    case 'DBG_DETACH':
      if (!needTab()) return false;
      (async () => {
        try { if (attached.has(tabId)) await chrome.debugger.detach({ tabId }); } catch (_) {}
        attached.delete(tabId);
        reply({ success: true });
      })();
      return true;

    case 'DBG_INSERT_TEXT':
      if (!needTab()) return false;
      ensureAttached(tabId).then(() => cdp(tabId, 'Input.insertText', { text: msg.text }))
        .then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    case 'DBG_KEY':
      if (!needTab()) return false;
      ensureAttached(tabId).then(() => keyPress(tabId, msg))
        .then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    case 'DBG_HOVER':
      if (!needTab()) return false;
      ensureAttached(tabId).then(() => mouseMove(tabId, msg.x, msg.y))
        .then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    case 'DBG_CLICK':
      if (!needTab()) return false;
      ensureAttached(tabId).then(() => mouseClick(tabId, msg.x, msg.y))
        .then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    default:
      return false;
  }
});
