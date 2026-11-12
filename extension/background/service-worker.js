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

chrome.runtime.onInstalled.addListener(async (details) => {
  await setupPanel();
  if (details.reason === 'install') {
    try {
      const tabs = await chrome.tabs.query({ url: FLOW_PATTERNS });
      for (const t of tabs) if (t.id) chrome.tabs.reload(t.id).catch(() => {});
    } catch (_) {}
  }
});

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

async function findOrOpenFlowTab() {
  let tabs = await chrome.tabs.query({ url: FLOW_PATTERNS });
  if (tabs && tabs.length) {
    return tabs.find((t) => t.active) || tabs[0];
  }
  const created = await chrome.tabs.create({ url: FLOW_URL, active: true });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await chrome.tabs.sendMessage(created.id, { type: 'PING' });
      if (res && res.ok) return created;
    } catch (_) {}
  }
  return created;
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

    if (job.action === 'stop') {
      const tab = await findOrOpenFlowTab();
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
      'fileNamingSystem', 'folderName', 'zoomOutWhileRunning'
    ];
    for (const k of allowedKeys) {
      if (incomingSettings[k] !== undefined && incomingSettings[k] !== null) {
        updatedSettings[k] = incomingSettings[k];
      }
    }

    let promptList = [];
    if (Array.isArray(job.prompts)) {
      promptList = job.prompts.map((p) => String(p || '').trim()).filter(Boolean);
    } else if (typeof job.promptsText === 'string' || typeof job.prompts === 'string') {
      const raw = String(job.promptsText || job.prompts || '');
      promptList = raw.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    }

    const isVideo =
      updatedSettings.mode === 'agentAutomation'
        ? updatedSettings.agentType === 'agentAutomationToVideo'
        : ['textToVideo', 'imageToVideo', 'componentsToVideo'].includes(updatedSettings.mode);

    if (isVideo && /\bveo\b/i.test(updatedSettings.model || '') && !incomingSettings.forceVeo) {
      const multiChar = promptList.some((p) => {
        const ch = resolveCharactersForPrompt(
          p,
          scannedChars,
          updatedSettings.enableCharacterControl,
          updatedSettings.defaultCharacters
        );
        return (ch && ch.length >= 2) || updatedSettings.mode === 'componentsToVideo';
      });
      if (multiChar) {
        updatedSettings.model = 'Omni 1.1 Flash';
        reportBridgeEvent({
          type: 'ACTION_LOG',
          level: 'warn',
          message: 'Auto-switched model from Veo to "Omni 1.1 Flash" because multi-character/ingredient scenes exceed Veo 3.1 limits.'
        });
      }
    }

    const formattedPromptsText = promptList.join('\n\n');
    const toStore = {
      [SETTINGS_KEY]: updatedSettings,
      aws_settings: updatedSettings
    };
    if (promptList.length > 0) {
      toStore[FORM_KEY] = { prompts: formattedPromptsText };
      toStore.aws_form = { prompts: formattedPromptsText };
    }
    await chrome.storage.local.set(toStore);

    chrome.runtime.sendMessage({
      type: 'AGENT_BRIDGE_SYNC',
      data: {
        settings: updatedSettings,
        promptsText: promptList.length > 0 ? formattedPromptsText : undefined,
        autoStart: job.autoStart !== false
      }
    }).catch(() => {});

    reportBridgeEvent({
      type: 'JOB_CONFIGURED',
      status: job.autoStart === false ? 'populated' : 'starting',
      promptCount: promptList.length,
      settings: updatedSettings
    });

    if (job.autoStart === false || !promptList.length) {
      return;
    }

    const tab = await findOrOpenFlowTab();
    if (!tab || !tab.id) {
      throw new Error('Could not find or open Google Flow tab');
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

    const total = promptList.length;
    const defOpt = isVideo ? updatedSettings.defaultVideoOption : updatedSettings.defaultImageOption;
    const promptOption = (i) => {
      if (total > 0 && i === total - 1 && String(defOpt).includes('-concat')) {
        return String(defOpt).split('-concat')[0];
      }
      return defOpt;
    };
    const isConcat = (i) => String(promptOption(i)).includes('concat');
    const anyConcat = promptList.some((_, i) => isConcat(i));
    const mode = updatedSettings.mode === 'agentAutomation' ? updatedSettings.agentType : updatedSettings.mode;
    const outputCount = anyConcat
      ? 1
      : Number(updatedSettings.mode === 'agentAutomation' ? updatedSettings.agentOutputCount : updatedSettings.outputCount) || 1;
    const concurrent =
      anyConcat || updatedSettings.mode === 'agentAutomation' ? 1 : Number(updatedSettings.concurrentPrompts) || 1;

    const payloads = promptList.map((p, i) => ({
      prompt: p,
      mode,
      images: [],
      speaker: updatedSettings.defaultSpeaker && updatedSettings.defaultSpeaker !== 'none' ? updatedSettings.defaultSpeaker : null,
      characters: resolveCharactersForPrompt(
        p,
        scannedChars,
        updatedSettings.enableCharacterControl,
        updatedSettings.defaultCharacters
      ),
      aspectRatio: updatedSettings.aspectRatio || '16:9',
      outputCount,
      model: isVideo ? updatedSettings.model : updatedSettings.imageModel,
      videoOption: isVideo ? promptOption(i) : undefined,
      promptIndex: i + 1,
      autoDownloadResourceQuality: isVideo
        ? updatedSettings.autoDownloadVideoQuality
        : updatedSettings.autoDownloadImageQuality,
      isConcat: isConcat(i),
      maxRetries: Number(updatedSettings.maxRetries ?? 1),
      autoChangeFileName: updatedSettings.autoChangeFileName !== false,
      fileNamingSystem: updatedSettings.fileNamingSystem || 'prompt_tag',
      folderName: updatedSettings.folderName || 'asidz-flow'
    }));

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
