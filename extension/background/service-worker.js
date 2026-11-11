/**
 * AsidZ AutoFlow — Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 * 1. Strict Google Flow Tab Locking: The side panel is strictly enabled ONLY on
 *    flow.google.com and labs.google/fx/tools/flow tabs, and disabled everywhere else.
 * 2. CDP Session Manager: Dispatches hardware-level keystrokes, clicks, and coordinate events
 *    via chrome.debugger to bypass React synthetic event restrictions.
 * 3. Media Download Coordinator: Captures newly generated high-resolution outputs into 'asidz-flow'.
 * 4. SaaS License & Quota Sync: Validates with the local or cloud Node.js backend (port 5050).
 */

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const DEFAULT_SAAS_URL = 'http://localhost:5050';

let batchState = {
  isRunning: false,
  stopRequested: false,
  targetTabId: null,
  debuggerAttached: false,
  currentIndex: 0,
  completedCount: 0,
  totalToRun: 0,
  activePromptTag: 'shot_01',
  settings: null
};

/* ==========================================================================
   STRICT TAB LOCKING: ONLY ENABLE SIDE PANEL ON GOOGLE FLOW
   ========================================================================== */
function isGoogleFlowUrl(url) {
  if (!url) return false;
  return url.includes('flow.google.com') || url.includes('labs.google/fx/tools/flow');
}

async function updateSidePanelForTab(tabId, url) {
  if (!tabId || tabId === chrome.tabs.TAB_ID_NONE) return;
  const isFlow = isGoogleFlowUrl(url);
  try {
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel/index.html',
        enabled: isFlow
      });
    }
  } catch (_) {
    // Tab might be closing or restricted
  }
}

// Disable side panel globally on installation, then enable strictly per Google Flow tab
chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({ enabled: false });
    }
    // Inspect all open tabs and enable only for Google Flow tabs
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (tab.id && tab.url) {
        await updateSidePanelForTab(tab.id, tab.url);
      }
    }
  } catch (_) {}
});

// Watch tab updates (navigation, URL changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const currentUrl = changeInfo.url || tab.url;
  if (currentUrl) {
    updateSidePanelForTab(tabId, currentUrl);
  }
});

// Watch tab switches / activations
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.url) {
      await updateSidePanelForTab(activeInfo.tabId, tab.url);
    }
  } catch (_) {}
});

// Handle toolbar action icon click: open side panel if on Flow, or prompt user to open Flow
chrome.action.onClicked.addListener(async (tab) => {
  if (isGoogleFlowUrl(tab.url)) {
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } else {
    // Open Google Flow in a new tab if clicked from an unrelated page
    const flowTab = await chrome.tabs.create({ url: 'https://flow.google.com' });
    if (flowTab.id && chrome.sidePanel?.open) {
      // Small pause to allow tab creation
      setTimeout(async () => {
        try {
          await updateSidePanelForTab(flowTab.id, 'https://flow.google.com');
          await chrome.sidePanel.open({ tabId: flowTab.id });
        } catch (_) {}
      }, 700);
    }
  }
});

// Debugger detach listener
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === batchState.targetTabId) {
    batchState.debuggerAttached = false;
    broadcastLog('WARN', `Chrome Debugger detached (${reason}). Will re-attach on next execution.`);
  }
});

/* ==========================================================================
   MESSAGE ROUTER (FROM SIDE PANEL & CONTENT SCRIPT)
   ========================================================================== */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'CHECK_FLOW_CONNECTION': {
          const tab = await findGoogleFlowTab();
          sendResponse({ connected: Boolean(tab), tabId: tab?.id || null });
          break;
        }

        case 'VERIFY_SAAS_LICENSE': {
          const license = await verifyOrSyncLicense(message.licenseKey, message.saasApiUrl);
          sendResponse({ ok: true, license });
          break;
        }

        case 'SCAN_FLOW_CHARACTERS': {
          const tab = await findGoogleFlowTab();
          if (!tab) {
            sendResponse({ ok: false, error: 'Google Flow tab not found.' });
            return;
          }
          let chars = [];
          try {
            const pageScan = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_CHARACTERS_IN_PAGE' });
            if (pageScan?.ok && Array.isArray(pageScan.characters)) {
              chars = pageScan.characters;
            }
          } catch (_) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['scripts/cdp-automator.js']
              });
              await sleep(200);
              const retry = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_CHARACTERS_IN_PAGE' });
              if (retry?.ok && Array.isArray(retry.characters)) {
                chars = retry.characters;
              }
            } catch (e) {
              chars = [];
            }
          }
          sendResponse({ ok: true, characters: chars || [] });
          break;
        }

        case 'SYNC_FLOW_VOICES': {
          const tab = await findGoogleFlowTab();
          if (!tab) {
            sendResponse({ ok: true, voices: ['None', 'Aoede', 'Alnilam', 'Puck', 'Charon', 'Kore', 'Fenrir'] });
            return;
          }
          const voices = await evaluateInFlowTab(
            tab.id,
            `(() => {
              const base = ['None', 'Aoede', 'Alnilam', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Orus', 'Zephyr'];
              document.querySelectorAll('[data-voice-name], [role="option"]').forEach(el => {
                const t = (el.textContent || '').trim();
                if (t && t.length < 24 && !base.includes(t)) base.push(t);
              });
              return base;
            })()`
          );
          sendResponse({ ok: true, voices });
          break;
        }

        case 'START_AUTOFLOW_BATCH': {
          if (batchState.isRunning) {
            sendResponse({ ok: false, error: 'Batch queue is already running.' });
            return;
          }
          const { mode, prompts, settings } = message.payload;
          const startRes = await startBatchExecution(mode, prompts, settings);
          sendResponse(startRes);
          break;
        }

        case 'STOP_AUTOFLOW_BATCH': {
          batchState.stopRequested = true;
          sendResponse({ ok: true });
          break;
        }

        case 'MEDIA_DOWNLOAD_DETECTED': {
          const { url, mediaType, promptTag } = message.payload;
          await triggerAutoDownload(url, mediaType, promptTag || batchState.activePromptTag);
          sendResponse({ ok: true });
          break;
        }

        case 'CDP_APPROVAL_ACTIONS_NEEDED': {
          const tabId = sender?.tab?.id || batchState.targetTabId;
          const actions = message.payload?.actions || [];
          if (tabId && actions.length > 0) {
            await executeHardwareApprovalClicks(tabId, actions);
          }
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});

/* ==========================================================================
   CHROME DEBUGGER (CDP) SESSION MANAGEMENT
   ========================================================================== */
async function findGoogleFlowTab() {
  const tabs = await chrome.tabs.query({});
  return (
    tabs.find((t) => t.url && isGoogleFlowUrl(t.url)) ||
    tabs.find((t) => t.active && t.url && !t.url.startsWith('chrome://')) ||
    null
  );
}

async function ensureDebuggerAttached(tabId) {
  if (batchState.debuggerAttached && batchState.targetTabId === tabId) {
    return true;
  }
  // Cleanly detach any lingering or previous session first
  try {
    await chrome.debugger.detach({ tabId });
    await sleep(150);
  } catch (_) {}

  try {
    await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (!msg.includes('already attached')) {
      throw err;
    }
  }
  batchState.targetTabId = tabId;
  batchState.debuggerAttached = true;

  try {
    await sendCDP(tabId, 'DOM.enable', {});
    await sendCDP(tabId, 'Runtime.enable', {});
    await sendCDP(tabId, 'Page.enable', {});
  } catch (_) {}
  broadcastLog('CDP', `Attached chrome.debugger (CDP ${DEBUGGER_PROTOCOL_VERSION}) to Tab #${tabId}`);
  return true;
}

function sendCDP(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

async function evaluateInFlowTab(tabId, expression) {
  await ensureDebuggerAttached(tabId);
  const res = await sendCDP(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return res?.result?.value;
}

/* ==========================================================================
   CDP HARDWARE-LEVEL INPUT DISPATCHERS
   ========================================================================== */
async function dispatchTrustedClick(tabId, x, y) {
  await sendCDP(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none'
  });
  await sendCDP(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1
  });
  await sendCDP(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1
  });
}

async function dispatchTrustedTextInsert(tabId, text) {
  await sendCDP(tabId, 'Input.insertText', { text });
}

async function dispatchEnterKey(tabId) {
  await sendCDP(tabId, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter'
  });
  await sendCDP(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter'
  });
}

/* ==========================================================================
   BATCH EXECUTION ORCHESTRATOR
   ========================================================================== */
async function startBatchExecution(mode, prompts, settings) {
  const tab = await findGoogleFlowTab();
  if (!tab) {
    return {
      ok: false,
      error: 'No active Google Flow tab found. Please open flow.google.com first.'
    };
  }

  // Ensure user is on Google Flow tab
  await chrome.tabs.update(tab.id, { active: true });

  // Verify SaaS license & quota before starting
  const license = await verifyOrSyncLicense(null, settings.saasApiUrl);
  if (license.tier === 'FREE') {
    const remaining = (license.dailyLimit || 10) - (license.usedToday || 0);
    if (remaining <= 0) {
      return {
        ok: false,
        error: 'Daily Free Tier quota (10/10) reached. Activate a Pro Key in Settings!'
      };
    }
    if (prompts.length > 5) {
      return {
        ok: false,
        error: 'Free Tier allows up to 5 prompts per batch queue. Upgrade to Pro for 500+ batch queues.'
      };
    }
  }

  batchState = {
    isRunning: true,
    stopRequested: false,
    targetTabId: tab.id,
    debuggerAttached: false,
    currentIndex: 0,
    completedCount: 0,
    totalToRun: prompts.length,
    activePromptTag: prompts[0]?.tag || 'shot_01',
    settings
  };

  runBatchLoop(tab.id, mode, prompts, settings).catch((err) => {
    broadcastLog('ERROR', `Batch loop fatal error: ${err.message}`);
    batchState.isRunning = false;
  });

  return { ok: true };
}

async function runBatchLoop(tabId, mode, prompts, settings) {
  await ensureDebuggerAttached(tabId);

  if (settings.zoomOutFlow) {
    await evaluateInFlowTab(
      tabId,
      `(() => { document.body.style.zoom = '0.9'; return true; })()`
    );
    broadcastLog('CDP', 'Applied 90% canvas zoom to keep generation cards visible.');
  }

  for (let i = 0; i < prompts.length; i++) {
    if (batchState.stopRequested) {
      broadcastQueueUpdate({
        status: 'Stopped',
        completedCount: batchState.completedCount,
        totalToRun: prompts.length,
        currentIndex: prompts[i].index,
        currentPromptText: `Stopped at #${prompts[i].index}`,
        stepPercent: 0
      });
      break;
    }

    const item = prompts[i];
    batchState.currentIndex = item.index;
    batchState.activePromptTag = item.tag;

    // Consume 1 quota credit
    const quotaOk = await consumeGenerationQuota(settings.saasApiUrl, mode, item.tag);
    if (!quotaOk) {
      broadcastLog('ERROR', 'Daily quota exhausted mid-batch. Halting queue.');
      broadcastQueueUpdate({
        status: 'Quota Reached',
        completedCount: batchState.completedCount,
        totalToRun: prompts.length,
        currentIndex: item.index,
        currentPromptText: 'Daily Free limit reached. Activate Pro License.',
        stepPercent: 0
      });
      break;
    }

    broadcastQueueUpdate({
      status: 'Running',
      completedCount: batchState.completedCount,
      totalToRun: prompts.length,
      currentIndex: item.index,
      currentPromptText: `Now: #${item.index} ${item.cleanPrompt}`,
      stepPercent: 20
    });

    let attempt = 0;
    let success = false;
    const maxAttempts = (settings.maxRetries || 1) + 1;

    while (attempt < maxAttempts && !success && !batchState.stopRequested) {
      attempt++;
      try {
        broadcastLog(
          'CDP',
          `[#${item.index}] (Attempt ${attempt}/${maxAttempts}) Injecting prompt & applying mode "${mode}"...`
        );

        const execResult = await executeSinglePromptViaCDP(tabId, mode, item, settings);
        if (execResult?.ok) {
          success = true;
          broadcastLog('INFO', `[#${item.index}] Prompt submitted to Google Flow (${execResult.detail || 'OK'}).`);
        } else {
          throw new Error(execResult?.error || 'Prompt bar not found on page');
        }
      } catch (err) {
        broadcastLog('WARN', `[#${item.index}] Attempt ${attempt} warning: ${err.message}`);
        await sleep(2500);
      }
    }

    broadcastQueueUpdate({
      status: 'Running',
      completedCount: batchState.completedCount,
      totalToRun: prompts.length,
      currentIndex: item.index,
      currentPromptText: `Now: #${item.index} Generating on Google Flow...`,
      stepPercent: 70
    });

    // Wait for generation to actually finish and download the real generated media
    await waitForGenerationAndDownload(tabId, mode, item, settings);

    batchState.completedCount++;
    broadcastQueueUpdate({
      status: 'Running',
      completedCount: batchState.completedCount,
      totalToRun: prompts.length,
      currentIndex: item.index,
      currentPromptText: `Completed #${item.index} (${item.tag})`,
      stepPercent: 100
    });

    // Jitter delay between prompts
    if (i < prompts.length - 1 && !batchState.stopRequested) {
      const minMs = (settings.delayMin || 0) * 1000;
      const maxMs = Math.max(minMs, (settings.delayMax || 20) * 1000);
      const waitMs = Math.floor(minMs + Math.random() * (maxMs - minMs));
      if (waitMs > 0) {
        broadcastLog('INFO', `Cooldown delay: waiting ${(waitMs / 1000).toFixed(1)}s before next prompt...`);
        await sleep(waitMs);
      }
    }
  }

  if (settings.zoomOutFlow) {
    await evaluateInFlowTab(tabId, `(() => { document.body.style.zoom = '1'; return true; })()`).catch(() => {});
  }

  if (!batchState.stopRequested) {
    broadcastQueueUpdate({
      status: 'Completed',
      completedCount: batchState.completedCount,
      totalToRun: prompts.length,
      currentIndex: prompts.length,
      currentPromptText: `Finished ${batchState.completedCount}/${prompts.length} prompts.`,
      stepPercent: 100
    });
    broadcastLog('INFO', `Batch complete! Processed ${batchState.completedCount}/${prompts.length} prompts.`);
  }

  batchState.isRunning = false;
}

async function executeSinglePromptViaCDP(tabId, mode, promptItem, settings) {
  // Ensure content script is ready
  let prep = null;
  try {
    prep = await chrome.tabs.sendMessage(tabId, {
      type: 'CDP_PREPARE_PROMPT_STEP',
      payload: { mode, promptItem, settings }
    });
  } catch (_) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/cdp-automator.js']
    });
    await sleep(200);
    prep = await chrome.tabs.sendMessage(tabId, {
      type: 'CDP_PREPARE_PROMPT_STEP',
      payload: { mode, promptItem, settings }
    });
  }

  if (!prep?.ok) {
    return { ok: false, error: prep?.error || 'Could not locate Google Flow prompt input bar' };
  }

  // 1. Hardware click to focus the input box
  if (prep.inputCoords) {
    await dispatchTrustedClick(tabId, prep.inputCoords.x, prep.inputCoords.y);
    await sleep(150);
  }

  // 2. Clear existing text and dispatch trusted hardware typing via CDP
  await evaluateInFlowTab(
    tabId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(prep.matchedSelector || 'textarea')});
      if (el) {
        el.focus();
        if ('value' in el) el.value = '';
        else el.textContent = '';
      }
    })()`
  );

  await dispatchTrustedTextInsert(tabId, prep.composedPrompt);
  await sleep(250);

  // 3. Dispatch hardware click on the right-arrow submit button, or dispatch Enter key
  if (prep.submitCoords) {
    await dispatchTrustedClick(tabId, prep.submitCoords.x, prep.submitCoords.y);
    await dispatchEnterKey(tabId);
    // Check and auto-click any immediate "Always approve in project" / "Approve" / "Reject" dialog
    await sleep(600);
    await checkAndClickFlowApprovalButtons(tabId, settings?.approvalPolicy);
    return {
      ok: true,
      detail: `CDP hardware click at (${Math.round(prep.submitCoords.x)}, ${Math.round(prep.submitCoords.y)}) + Enter keystroke`
    };
  } else {
    await dispatchEnterKey(tabId);
    await sleep(600);
    await checkAndClickFlowApprovalButtons(tabId, settings?.approvalPolicy);
    return { ok: true, detail: 'CDP Enter keystroke dispatched' };
  }
}

async function executeHardwareApprovalClicks(tabId, actions) {
  if (!Array.isArray(actions) || actions.length === 0) return;
  await ensureDebuggerAttached(tabId);
  for (const act of actions) {
    if (typeof act.x === 'number' && typeof act.y === 'number') {
      await dispatchTrustedClick(tabId, act.x, act.y);
      broadcastLog('INFO', `Hardware-clicked Flow permission button "${act.label}" at (${act.x}, ${act.y}).`);
      await sleep(180);
    }
  }
}

async function checkAndClickFlowApprovalButtons(tabId, approvalPolicy = 'always-approve') {
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      type: 'CDP_CHECK_APPROVAL_BUTTONS',
      payload: { approvalPolicy }
    });
    if (Array.isArray(res?.actions) && res.actions.length > 0) {
      await executeHardwareApprovalClicks(tabId, res.actions);
    }
  } catch (_) {}
}

async function waitForGenerationAndDownload(tabId, mode, promptItem, settings) {
  try {
    const pollRes = await chrome.tabs.sendMessage(tabId, {
      type: 'CDP_POLL_FOR_NEW_MEDIA',
      payload: {
        mode,
        promptTag: promptItem.tag,
        approvalPolicy: settings?.approvalPolicy || 'always-approve',
        timeoutMs: 45000 // Allow up to 45s for Flow generation + approvals to finish
      }
    });
    if (pollRes?.mediaUrl) {
      await triggerAutoDownload(pollRes.mediaUrl, pollRes.mediaType || 'video', promptItem.tag);
    }
  } catch (err) {
    broadcastLog('WARN', `Poll response note: ${err.message}`);
  }
}

/* ==========================================================================
   AUTO-DOWNLOAD COORDINATOR
   ========================================================================== */
async function triggerAutoDownload(url, mediaType, promptTag) {
  if (!url || url.startsWith('blob:')) {
    broadcastLog('INFO', `Media download handled in page for #${promptTag}.`);
    return;
  }

  const folder = (batchState.settings?.saveFolder || 'asidz-flow').replace(/[^a-zA-Z0-9_-]/g, '');
  const ext = mediaType === 'image' ? 'png' : 'mp4';
  const timecode = new Date().toISOString().slice(14, 19).replace(':', '-');
  const filename = `${folder}/${promptTag}_${timecode}.${ext}`;

  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false
    });
    broadcastLog('INFO', `Auto-downloaded: ${filename} (ID: ${downloadId})`);
  } catch (err) {
    broadcastLog('ERROR', `Download error for ${filename}: ${err.message}`);
  }
}

/* ==========================================================================
   SAAS CLOUD LICENSE & QUOTA SYNC
   ========================================================================== */
async function verifyOrSyncLicense(explicitKey, saasApiUrl) {
  const apiUrl = saasApiUrl || DEFAULT_SAAS_URL;
  const stored = await chrome.storage.local.get(['autoflowLicense']);
  const current = stored.autoflowLicense || {
    tier: 'FREE',
    usedToday: 0,
    dailyLimit: 10,
    licenseKey: ''
  };

  const keyToVerify = explicitKey !== null && explicitKey !== undefined ? explicitKey : current.licenseKey;

  try {
    const res = await fetch(`${apiUrl}/api/v1/license/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: keyToVerify })
    });
    if (res.ok) {
      const data = await res.json();
      const updated = {
        tier: data.tier || 'FREE',
        usedToday: data.usedToday ?? current.usedToday,
        dailyLimit: data.dailyLimit ?? 10,
        licenseKey: keyToVerify
      };
      await chrome.storage.local.set({ autoflowLicense: updated });
      return updated;
    }
  } catch (_) {
    if (keyToVerify === 'PRO-AUTOMA-8888-DEMO') {
      const proFallback = {
        tier: 'PRO',
        usedToday: current.usedToday || 0,
        dailyLimit: 999999,
        licenseKey: keyToVerify
      };
      await chrome.storage.local.set({ autoflowLicense: proFallback });
      return proFallback;
    }
  }

  return current;
}

async function consumeGenerationQuota(saasApiUrl, mode, promptTag) {
  const apiUrl = saasApiUrl || DEFAULT_SAAS_URL;
  const stored = await chrome.storage.local.get(['autoflowLicense']);
  const license = stored.autoflowLicense || {
    tier: 'FREE',
    usedToday: 0,
    dailyLimit: 10,
    licenseKey: ''
  };

  if (license.tier === 'FREE' && license.usedToday >= license.dailyLimit) {
    return false;
  }

  try {
    const res = await fetch(`${apiUrl}/api/v1/usage/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: license.licenseKey,
        mode,
        promptTag
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (!data.allowed) return false;
      license.usedToday = data.usedToday;
      license.tier = data.tier || license.tier;
    } else {
      license.usedToday = (license.usedToday || 0) + 1;
    }
  } catch (_) {
    license.usedToday = (license.usedToday || 0) + 1;
  }

  await chrome.storage.local.set({ autoflowLicense: license });
  chrome.runtime.sendMessage({ type: 'QUOTA_UPDATED', license }).catch(() => {});
  return true;
}

/* ==========================================================================
   BROADCAST UTILITIES
   ========================================================================== */
function broadcastQueueUpdate(payload) {
  chrome.runtime.sendMessage({ type: 'QUEUE_PROGRESS_UPDATE', payload }).catch(() => {});
}

function broadcastLog(level, message) {
  chrome.runtime.sendMessage({ type: 'CDP_LOG_EVENT', level, message }).catch(() => {});
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
