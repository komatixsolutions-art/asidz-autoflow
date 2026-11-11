/**
 * AsidZ AutoFlow — Side Panel UI Controller
 * Manages 6 Generation Modes, Image Asset Auto-Matching, Voice & @Character Sync,
 * Multiline Prompt Parsing (#tag support), CDP Execution Queue, Settings, and Live Logs.
 */

const MODE_DESCRIPTIONS = {
  'text-to-video': 'Generate cinematic videos consecutively from your batch prompt script.',
  'frame-to-video': 'Animate start-frame and end-frame image sequences into smooth transitions.',
  'ingredients-to-video': 'Use images as ingredients (characters, objects, places) inside the video.',
  'text-to-image': 'Generate high-resolution images from text using Nano Banana 2.1.',
  'image-to-image': 'Transform or chain-edit existing reference images with each prompt.',
  'agent-automation': 'Autonomous multi-output iterative generation agent inside Google Flow.'
};

const state = {
  activeTab: 'control',
  mode: 'text-to-video',
  connectedTabId: null,
  isFlowConnected: false,
  uploadedImages: [], // [{ id, name, baseName, dataUrl, mimeType }]
  scannedCharacters: [], // Populated ONLY when scanned from Google Flow
  syncedVoices: ['None', 'Aoede', 'Alnilam', 'Puck', 'Charon', 'Kore', 'Fenrir'],
  parsedPrompts: [],
  queue: {
    status: 'Idle', // Idle | Queued | Running | Stopping... | Stopped | Completed
    currentIndex: 0,
    totalToRun: 0,
    currentPromptText: 'Ready to start batch automation on Google Flow.',
    stepPercent: 0
  },
  logs: [],
  license: {
    tier: 'FREE',
    usedToday: 0,
    dailyLimit: 10,
    licenseKey: ''
  },
  settings: {
    aspectRatio: '16:9',
    outputsPerPrompt: '1',
    model: 'omni-flash',
    chainOrDuration: '10s',
    maxImagesPerPrompt: 2,
    autoPickImages: true,
    autoVoice: true,
    defaultVoice: 'None',
    autoCharacter: true,
    concurrency: 1,
    agentOutputs: 2,
    delayMin: 0,
    delayMax: 20,
    maxRetries: 1,
    zoomOutFlow: true,
    videoQuality: '720p',
    imageQuality: '1K',
    saveFolder: 'asidz-flow',
    autoRename: true,
    fileNaming: 'tag-timecode',
    saasApiUrl: 'http://localhost:5050',
    customSelectors: {
      promptTextarea: "textarea, [contenteditable='true'], [role='textbox'], input[placeholder*='create' i]",
      submitButton: "button[type='submit'], button[aria-label*='Generate' i], button[aria-label*='Create' i], button[aria-label*='Submit' i]",
      fileInput: "input[type='file']",
      characterChips: "[data-character-name], .character-chip, [aria-label*='@']"
    }
  }
};

// DOM Elements
const els = {
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabPanes: document.querySelectorAll('.tab-pane'),
  modeCards: document.querySelectorAll('.mode-card'),
  modeHelperText: document.getElementById('modeHelperText'),
  connDot: document.getElementById('connDot'),
  connText: document.getElementById('connText'),
  proBadge: document.getElementById('proBadge'),
  quotaText: document.getElementById('quotaText'),
  quotaBarFill: document.getElementById('quotaBarFill'),
  openLicenseModalBtn: document.getElementById('openLicenseModalBtn'),

  // Generation settings
  aspectRatioSelect: document.getElementById('aspectRatioSelect'),
  outputsPerPromptSelect: document.getElementById('outputsPerPromptSelect'),
  modelSelect: document.getElementById('modelSelect'),
  chainOrDurationSelect: document.getElementById('chainOrDurationSelect'),
  chainOrDurationLabel: document.getElementById('chainOrDurationLabel'),

  // Images block
  imagesSectionCard: document.getElementById('imagesSectionCard'),
  imageDropzone: document.getElementById('imageDropzone'),
  imageFileInput: document.getElementById('imageFileInput'),
  thumbnailStrip: document.getElementById('thumbnailStrip'),
  maxImagesPerPrompt: document.getElementById('maxImagesPerPrompt'),
  autoPickImagesToggle: document.getElementById('autoPickImagesToggle'),
  removeAllImagesBtn: document.getElementById('removeAllImagesBtn'),

  // Voice block
  voiceSectionCard: document.getElementById('voiceSectionCard'),
  autoVoiceToggle: document.getElementById('autoVoiceToggle'),
  defaultVoiceSelect: document.getElementById('defaultVoiceSelect'),
  syncVoicesBtn: document.getElementById('syncVoicesBtn'),

  // Characters block
  autoCharacterToggle: document.getElementById('autoCharacterToggle'),
  scanCharactersBtn: document.getElementById('scanCharactersBtn'),
  characterPillsContainer: document.getElementById('characterPillsContainer'),
  manualCharInput: document.getElementById('manualCharInput'),
  addManualCharBtn: document.getElementById('addManualCharBtn'),

  // Prompts block
  promptTotalCount: document.getElementById('promptTotalCount'),
  promptsTextarea: document.getElementById('promptsTextarea'),
  importTxtInput: document.getElementById('importTxtInput'),
  importTxtBtn: document.getElementById('importTxtBtn'),
  runFromInput: document.getElementById('runFromInput'),
  runToInput: document.getElementById('runToInput'),
  parsedPromptsList: document.getElementById('parsedPromptsList'),

  // Execution & Queue
  startAutoFlowBtn: document.getElementById('startAutoFlowBtn'),
  stopAutoFlowBtn: document.getElementById('stopAutoFlowBtn'),
  clearPromptsBtn: document.getElementById('clearPromptsBtn'),
  queueStateText: document.getElementById('queueStateText'),
  queueFractionText: document.getElementById('queueFractionText'),
  queueProgressFill: document.getElementById('queueProgressFill'),
  queueCurrentPromptText: document.getElementById('queueCurrentPromptText'),
  queueStepPercentText: document.getElementById('queueStepPercentText'),

  // Settings tab
  concurrencySelect: document.getElementById('concurrencySelect'),
  agentOutputsSelect: document.getElementById('agentOutputsSelect'),
  delayMinInput: document.getElementById('delayMinInput'),
  delayMaxInput: document.getElementById('delayMaxInput'),
  maxRetriesInput: document.getElementById('maxRetriesInput'),
  zoomOutFlowToggle: document.getElementById('zoomOutFlowToggle'),
  videoQualitySelect: document.getElementById('videoQualitySelect'),
  imageQualitySelect: document.getElementById('imageQualitySelect'),
  saveFolderInput: document.getElementById('saveFolderInput'),
  autoRenameToggle: document.getElementById('autoRenameToggle'),
  fileNamingSelect: document.getElementById('fileNamingSelect'),
  openDownloadSettingsBtn: document.getElementById('openDownloadSettingsBtn'),
  saasApiUrlInput: document.getElementById('saasApiUrlInput'),
  licenseKeyInput: document.getElementById('licenseKeyInput'),
  verifyLicenseBtn: document.getElementById('verifyLicenseBtn'),
  licenseStatusNote: document.getElementById('licenseStatusNote'),
  customSelectorsTextarea: document.getElementById('customSelectorsTextarea'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),

  // Logs tab
  logCountBadge: document.getElementById('logCountBadge'),
  logsTableBody: document.getElementById('logsTableBody'),
  exportLogsBtn: document.getElementById('exportLogsBtn'),
  clearLogsBtn: document.getElementById('clearLogsBtn'),

  // Toast & Links
  toastPopup: document.getElementById('toastPopup'),
  asidzHomeBtn: document.getElementById('asidzHomeBtn'),
  asidzSupportBtn: document.getElementById('asidzSupportBtn'),
  footerAsidzBtn: document.getElementById('footerAsidzBtn'),
  footerSaasBtn: document.getElementById('footerSaasBtn')
};

/* ==========================================================================
   INITIALIZATION & STORAGE SYNC
   ========================================================================== */
async function init() {
  await loadSavedState();
  bindEvents();
  renderCharacterPills();
  renderThumbnails();
  updateModeUI(state.mode);
  parseAndRenderPrompts();
  checkGoogleFlowTabConnection();
  syncLicenseStatus();
  addLog('INFO', 'AsidZ AutoFlow Side Panel initialized.');

  // Load clean creative prompts if textarea is empty (No hardcoded sample characters)
  if (!els.promptsTextarea.value.trim()) {
    els.promptsTextarea.value = [
      '#shot_01 Cinematic aerial view of a futuristic neon city skyline at dusk, ultra-detailed 4K HDR in 16:9 widescreen.',
      '#shot_02 Close-up macro portrait with dramatic cinematic lighting, photorealistic textures and shallow depth of field.',
      '#shot_03 Extreme wide shot of an ancient mountain temple enveloped in volumetric golden mist at sunrise.'
    ].join('\n\n');
    parseAndRenderPrompts();
  }
}

async function loadSavedState() {
  if (!chrome?.storage?.local) return;
  const data = await chrome.storage.local.get(['autoflowSettings', 'autoflowLicense', 'autoflowImages', 'autoflowCharacters']);
  if (data.autoflowSettings) {
    Object.assign(state.settings, data.autoflowSettings);
  }
  if (data.autoflowLicense) {
    Object.assign(state.license, data.autoflowLicense);
  }
  if (Array.isArray(data.autoflowImages)) {
    state.uploadedImages = data.autoflowImages;
  }
  if (Array.isArray(data.autoflowCharacters)) {
    state.scannedCharacters = data.autoflowCharacters;
  }
  applySettingsToDOM();
  renderQuotaUI();
}

function applySettingsToDOM() {
  const s = state.settings;
  els.aspectRatioSelect.value = s.aspectRatio;
  els.outputsPerPromptSelect.value = s.outputsPerPrompt;
  els.modelSelect.value = s.model;
  els.chainOrDurationSelect.value = s.chainOrDuration;
  els.maxImagesPerPrompt.value = String(s.maxImagesPerPrompt);
  els.autoPickImagesToggle.checked = Boolean(s.autoPickImages);
  els.autoVoiceToggle.checked = Boolean(s.autoVoice);
  els.defaultVoiceSelect.value = s.defaultVoice;
  els.autoCharacterToggle.checked = Boolean(s.autoCharacter);
  els.concurrencySelect.value = String(s.concurrency);
  els.agentOutputsSelect.value = String(s.agentOutputs);
  els.delayMinInput.value = s.delayMin;
  els.delayMaxInput.value = s.delayMax;
  els.maxRetriesInput.value = s.maxRetries;
  els.zoomOutFlowToggle.checked = Boolean(s.zoomOutFlow);
  els.videoQualitySelect.value = s.videoQuality;
  els.imageQualitySelect.value = s.imageQuality;
  els.saveFolderInput.value = s.saveFolder || 'asidz-flow';
  els.autoRenameToggle.checked = Boolean(s.autoRename);
  els.fileNamingSelect.value = s.fileNaming;
  els.saasApiUrlInput.value = s.saasApiUrl || 'http://localhost:5050';
  els.licenseKeyInput.value = state.license.licenseKey || '';
  if (s.customSelectors) {
    els.customSelectorsTextarea.value = JSON.stringify(s.customSelectors, null, 2);
  }
}

async function persistSettings() {
  let parsedSelectors = state.settings.customSelectors;
  try {
    parsedSelectors = JSON.parse(els.customSelectorsTextarea.value);
  } catch (e) {
    addLog('WARN', 'Invalid JSON in Custom Selectors; keeping previous selectors.');
  }

  state.settings = {
    aspectRatio: els.aspectRatioSelect.value,
    outputsPerPrompt: els.outputsPerPromptSelect.value,
    model: els.modelSelect.value,
    chainOrDuration: els.chainOrDurationSelect.value,
    maxImagesPerPrompt: parseInt(els.maxImagesPerPrompt.value, 10) || 2,
    autoPickImages: els.autoPickImagesToggle.checked,
    autoVoice: els.autoVoiceToggle.checked,
    defaultVoice: els.defaultVoiceSelect.value,
    autoCharacter: els.autoCharacterToggle.checked,
    concurrency: parseInt(els.concurrencySelect.value, 10) || 1,
    agentOutputs: parseInt(els.agentOutputsSelect.value, 10) || 2,
    delayMin: Math.max(0, parseInt(els.delayMinInput.value, 10) || 0),
    delayMax: Math.max(1, parseInt(els.delayMaxInput.value, 10) || 20),
    maxRetries: Math.max(0, parseInt(els.maxRetriesInput.value, 10) || 1),
    zoomOutFlow: els.zoomOutFlowToggle.checked,
    videoQuality: els.videoQualitySelect.value,
    imageQuality: els.imageQualitySelect.value,
    saveFolder: els.saveFolderInput.value.trim() || 'asidz-flow',
    autoRename: els.autoRenameToggle.checked,
    fileNaming: els.fileNamingSelect.value,
    saasApiUrl: els.saasApiUrlInput.value.trim() || 'http://localhost:5050',
    customSelectors: parsedSelectors
  };

  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ autoflowSettings: state.settings });
  }
}

/* ==========================================================================
   PROMPT PARSER & AUTO-ASSET MATCHING (#tag, IMAGES, @CHARACTERS, VOICES)
   ========================================================================= */
function parseAndRenderPrompts() {
  const raw = els.promptsTextarea.value || '';
  const blocks = raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const maxImgs = parseInt(els.maxImagesPerPrompt.value, 10) || 2;
  const autoPickImg = els.autoPickImagesToggle.checked;
  const autoChar = els.autoCharacterToggle.checked;
  const autoVoice = els.autoVoiceToggle.checked;

  state.parsedPrompts = blocks.map((block, idx) => {
    let customTag = null;
    let cleanPrompt = block;

    const tagMatch = block.match(/^#([A-Za-z0-9_-]+)\s+([\s\S]+)$/);
    if (tagMatch) {
      customTag = tagMatch[1];
      cleanPrompt = tagMatch[2].trim();
    }

    const matchedImages = [];
    if (autoPickImg && state.uploadedImages.length > 0) {
      for (const img of state.uploadedImages) {
        if (matchedImages.length >= maxImgs) break;
        const normalizedPrompt = cleanPrompt.toLowerCase();
        const stem = img.baseName.toLowerCase();
        if (stem && normalizedPrompt.includes(stem)) {
          matchedImages.push(img);
        }
      }
    }

    const matchedCharacters = [];
    if (autoChar && state.scannedCharacters.length > 0) {
      for (const charTag of state.scannedCharacters) {
        const bareName = charTag.replace(/^@/, '');
        const regex = new RegExp(`(@?\\b${bareName}\\b)`, 'i');
        if (regex.test(cleanPrompt)) {
          matchedCharacters.push(charTag);
        }
      }
    }

    const matchedVoices = [];
    if (autoVoice) {
      for (const voice of state.syncedVoices) {
        if (voice === 'None') continue;
        const vRegex = new RegExp(`\\b${voice}\\b`, 'i');
        if (vRegex.test(cleanPrompt)) {
          matchedVoices.push(voice);
        }
      }
      if (matchedVoices.length === 0 && els.defaultVoiceSelect.value !== 'None') {
        matchedVoices.push(els.defaultVoiceSelect.value);
      }
    }

    return {
      index: idx + 1,
      tag: customTag || `prompt_${String(idx + 1).padStart(2, '0')}`,
      rawText: block,
      cleanPrompt,
      matchedImages,
      matchedCharacters,
      matchedVoices
    };
  });

  const count = state.parsedPrompts.length;
  els.promptTotalCount.textContent = String(count);
  els.runToInput.max = String(Math.max(1, count));
  if (parseInt(els.runToInput.value, 10) <= 1 || parseInt(els.runToInput.value, 10) > count) {
    els.runToInput.value = String(Math.max(1, count));
  }

  renderParsedPromptCards();
}

function renderParsedPromptCards() {
  els.parsedPromptsList.innerHTML = '';
  state.parsedPrompts.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'parsed-prompt-card';
    if (state.queue.status === 'Running' && state.queue.currentIndex === item.index) {
      card.classList.add('running');
    }

    const top = document.createElement('div');
    top.className = 'parsed-prompt-top';

    const badge = document.createElement('span');
    badge.className = 'prompt-num-badge';
    badge.textContent = String(item.index);

    const preview = document.createElement('span');
    preview.className = 'prompt-preview-text';
    preview.textContent = item.cleanPrompt;

    top.appendChild(badge);
    top.appendChild(preview);
    card.appendChild(top);

    const tagsRow = document.createElement('div');
    tagsRow.className = 'parsed-prompt-tags';

    if (item.rawText.startsWith('#')) {
      const tChip = document.createElement('span');
      tChip.className = 'asset-chip';
      tChip.textContent = `#${item.tag}`;
      tagsRow.appendChild(tChip);
    }

    if (item.matchedImages.length > 0) {
      const imgChip = document.createElement('span');
      imgChip.className = 'asset-chip';
      const names = item.matchedImages.map((i) => i.baseName).join(', ');
      imgChip.textContent = `${item.matchedImages.length} img: ${names}`;
      tagsRow.appendChild(imgChip);
    }

    if (item.matchedCharacters.length > 0) {
      const charChip = document.createElement('span');
      charChip.className = 'asset-chip';
      charChip.textContent = item.matchedCharacters.join(', ');
      tagsRow.appendChild(charChip);
    }

    if (item.matchedVoices.length > 0) {
      const voiceChip = document.createElement('span');
      voiceChip.className = 'asset-chip';
      voiceChip.textContent = `🔊 ${item.matchedVoices.join(', ')}`;
      tagsRow.appendChild(voiceChip);
    }

    if (tagsRow.children.length > 0) {
      card.appendChild(tagsRow);
    }

    els.parsedPromptsList.appendChild(card);
  });
}

/* ==========================================================================
   IMAGE DROPZONE & THUMBNAIL MANAGEMENT
   ========================================================================== */
function handleImageFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;

  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      state.uploadedImages.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        baseName,
        mimeType: file.type,
        dataUrl: e.target.result
      });
      if (chrome?.storage?.local) {
        await chrome.storage.local.set({ autoflowImages: state.uploadedImages });
      }
      renderThumbnails();
      parseAndRenderPrompts();
      addLog('INFO', `Loaded reference image: ${file.name} (token: "${baseName}")`);
    };
    reader.readAsDataURL(file);
  });
}

function renderThumbnails() {
  els.thumbnailStrip.innerHTML = '';
  state.uploadedImages.forEach((img) => {
    const item = document.createElement('div');
    item.className = 'thumb-item';

    const thumb = document.createElement('img');
    thumb.src = img.dataUrl;
    thumb.alt = img.name;

    const label = document.createElement('span');
    label.textContent = img.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'thumb-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove image';
    removeBtn.addEventListener('click', async () => {
      state.uploadedImages = state.uploadedImages.filter((i) => i.id !== img.id);
      if (chrome?.storage?.local) {
        await chrome.storage.local.set({ autoflowImages: state.uploadedImages });
      }
      renderThumbnails();
      parseAndRenderPrompts();
    });

    item.appendChild(thumb);
    item.appendChild(label);
    item.appendChild(removeBtn);
    els.thumbnailStrip.appendChild(item);
  });
}

/* ==========================================================================
   CHARACTER PILLS & FLOW SYNC (NO HARDCODED CHARACTERS)
   ========================================================================== */
function renderCharacterPills() {
  els.characterPillsContainer.innerHTML = '';
  if (!state.scannedCharacters || state.scannedCharacters.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'helper-note';
    hint.id = 'noCharHint';
    hint.textContent = 'No characters added or scanned yet. Type a name above or click "Scan characters from Flow".';
    els.characterPillsContainer.appendChild(hint);
    return;
  }

  state.scannedCharacters.forEach((charTag) => {
    const pill = document.createElement('span');
    pill.className = 'char-pill';
    pill.dataset.char = charTag;
    pill.title = 'Auto mode: added when its name is in the prompt. Click to insert.';

    const textSpan = document.createElement('span');
    textSpan.textContent = charTag;
    textSpan.addEventListener('click', () => {
      const start = els.promptsTextarea.selectionStart || els.promptsTextarea.value.length;
      const before = els.promptsTextarea.value.slice(0, start);
      const after = els.promptsTextarea.value.slice(start);
      els.promptsTextarea.value = `${before}${charTag} ${after}`;
      parseAndRenderPrompts();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'char-pill-del';
    delBtn.textContent = '×';
    delBtn.title = `Remove ${charTag}`;
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      state.scannedCharacters = state.scannedCharacters.filter((c) => c !== charTag);
      if (chrome?.storage?.local) {
        await chrome.storage.local.set({ autoflowCharacters: state.scannedCharacters });
      }
      renderCharacterPills();
      parseAndRenderPrompts();
      addLog('INFO', `Removed character: ${charTag}`);
    });

    pill.appendChild(textSpan);
    pill.appendChild(delBtn);
    els.characterPillsContainer.appendChild(pill);
  });
}

function handleAddManualCharacter() {
  const val = (els.manualCharInput?.value || '').trim();
  if (!val) return;
  const cleanName = val.replace(/^@+/, '').replace(/\s+/g, '_');
  if (!cleanName) return;
  const tag = `@${cleanName}`;
  if (!state.scannedCharacters.includes(tag)) {
    state.scannedCharacters.push(tag);
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ autoflowCharacters: state.scannedCharacters });
    }
    renderCharacterPills();
    parseAndRenderPrompts();
    showToast(`Added character ${tag}`);
    addLog('INFO', `Added character: ${tag}`);
  }
  if (els.manualCharInput) els.manualCharInput.value = '';
}

async function scanCharactersFromFlow() {
  addLog('CDP', 'Scanning characters from active Google Flow project canvas...');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SCAN_FLOW_CHARACTERS' });
    if (resp?.ok && Array.isArray(resp.characters) && resp.characters.length > 0) {
      state.scannedCharacters = Array.from(new Set([...state.scannedCharacters, ...resp.characters]));
      if (chrome?.storage?.local) {
        await chrome.storage.local.set({ autoflowCharacters: state.scannedCharacters });
      }
      renderCharacterPills();
      parseAndRenderPrompts();
      showToast(`Scanned ${resp.characters.length} character(s) from Google Flow.`);
      addLog('INFO', `Characters synced: ${state.scannedCharacters.join(', ')}`);
    } else {
      showToast('No characters detected in current Flow project. Add characters in Flow first.');
      addLog('WARN', resp?.error || 'No character chips found in Flow canvas.');
    }
  } catch (err) {
    addLog('ERROR', `Character scan error: ${err.message}`);
  }
}

async function syncVoicesFromFlow() {
  addLog('CDP', 'Syncing voice library from Google Flow...');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SYNC_FLOW_VOICES' });
    const voices = resp?.voices?.length
      ? resp.voices
      : ['None', 'Aoede', 'Alnilam', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Orus', 'Zephyr'];
    state.syncedVoices = voices;
    els.defaultVoiceSelect.innerHTML = voices
      .map((v) => `<option value="${v}">${v}</option>`)
      .join('');
    showToast(`${voices.length - 1} voices synced from Google Flow.`);
    addLog('INFO', `Synced ${voices.length - 1} voices from Flow library.`);
    parseAndRenderPrompts();
  } catch (err) {
    addLog('ERROR', `Voice sync failed: ${err.message}`);
  }
}

/* ==========================================================================
   CONNECTION & SAAS LICENSE VERIFICATION
   ========================================================================== */
async function checkGoogleFlowTabConnection() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'CHECK_FLOW_CONNECTION' });
    state.isFlowConnected = Boolean(resp?.connected);
    state.connectedTabId = resp?.tabId || null;
    if (state.isFlowConnected) {
      els.connDot.classList.remove('disconnected');
      els.connDot.classList.add('connected');
      els.connText.textContent = 'Connected to Google Flow';
    } else {
      els.connDot.classList.remove('connected');
      els.connDot.classList.add('disconnected');
      els.connText.textContent = 'Open flow.google.com tab to connect';
    }
  } catch (_) {
    els.connDot.classList.add('disconnected');
    els.connText.textContent = 'Extension Service Worker standby';
  }
}

async function syncLicenseStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'VERIFY_SAAS_LICENSE',
      licenseKey: els.licenseKeyInput.value.trim() || state.license.licenseKey,
      saasApiUrl: state.settings.saasApiUrl
    });
    if (resp?.license) {
      state.license = resp.license;
      renderQuotaUI();
    }
  } catch (err) {
    addLog('WARN', `SaaS check offline; using cached tier (${state.license.tier}).`);
  }
}

function renderQuotaUI() {
  const isPro = state.license.tier === 'PRO';
  els.proBadge.textContent = isPro ? 'PRO' : 'FREE';
  els.proBadge.className = `tier-pill ${isPro ? 'pro' : 'free'}`;

  if (isPro) {
    els.quotaText.textContent = `PRO Unlimited (${state.license.usedToday} generated today)`;
    els.quotaBarFill.style.width = '100%';
    els.licenseStatusNote.innerHTML = `✅ Active Pro License: <code>${state.license.licenseKey || 'PRO-ACTIVE'}</code>`;
  } else {
    const used = state.license.usedToday || 0;
    const limit = state.license.dailyLimit || 10;
    const pct = Math.min(100, Math.round((used / limit) * 100));
    els.quotaText.textContent = `Quota: ${used} / ${limit} daily generations`;
    els.quotaBarFill.style.width = `${pct}%`;
  }
}

/* ==========================================================================
   BATCH EXECUTION (START / STOP / PROGRESS)
   ========================================================================== */
async function startBatchAutoFlow() {
  await persistSettings();
  parseAndRenderPrompts();

  if (state.parsedPrompts.length === 0) {
    showToast('Please enter at least 1 prompt before starting.');
    return;
  }

  const fromIdx = Math.max(1, parseInt(els.runFromInput.value, 10) || 1);
  const toIdx = Math.min(state.parsedPrompts.length, parseInt(els.runToInput.value, 10) || state.parsedPrompts.length);
  const subset = state.parsedPrompts.filter((p) => p.index >= fromIdx && p.index <= toIdx);

  if (subset.length === 0) {
    showToast('Invalid Run range selected.');
    return;
  }

  els.startAutoFlowBtn.disabled = true;
  showToast(`Started ${subset.length} prompt(s). Keep Google Flow canvas open.`);
  addLog('CDP', `Starting AutoFlow queue (${subset.length} prompts) in mode "${state.mode}"...`);

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'START_AUTOFLOW_BATCH',
      payload: {
        mode: state.mode,
        prompts: subset,
        settings: state.settings
      }
    });

    if (!resp?.ok) {
      els.startAutoFlowBtn.disabled = false;
      showToast(resp?.error || 'Could not start batch.');
      addLog('ERROR', resp?.error || 'Failed to start batch.');
    }
  } catch (err) {
    els.startAutoFlowBtn.disabled = false;
    addLog('ERROR', `Start failed: ${err.message}`);
  }
}

async function stopBatchAutoFlow() {
  els.queueStateText.textContent = 'Stopping...';
  showToast('Stopping after the current step...');
  addLog('WARN', 'User requested stop. Halting queue after current CDP operation.');
  await chrome.runtime.sendMessage({ type: 'STOP_AUTOFLOW_BATCH' });
  els.startAutoFlowBtn.disabled = false;
}

/* ==========================================================================
   MODE & TAB UI UPDATES
   ========================================================================== */
function updateModeUI(selectedMode) {
  state.mode = selectedMode;
  els.modeCards.forEach((card) => {
    card.classList.toggle('active', card.dataset.mode === selectedMode);
  });
  els.modeHelperText.textContent = MODE_DESCRIPTIONS[selectedMode] || '';

  const isImageMode = selectedMode === 'text-to-image' || selectedMode === 'image-to-image';
  if (isImageMode) {
    els.modelSelect.value = 'nano-banana-2.1';
    els.chainOrDurationLabel.textContent = 'Image Option';
    els.chainOrDurationSelect.value = selectedMode === 'image-to-image' ? 'chain-edit' : 'new-image';
  } else {
    if (els.modelSelect.value === 'nano-banana-2.1') {
      els.modelSelect.value = 'omni-flash';
    }
    els.chainOrDurationLabel.textContent = 'Duration / Chain';
    if (els.chainOrDurationSelect.value.includes('image') || els.chainOrDurationSelect.value.includes('chain')) {
      els.chainOrDurationSelect.value = '10s';
    }
  }
}

function switchTab(tabId) {
  state.activeTab = tabId;
  els.tabBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
  els.tabPanes.forEach((pane) => pane.classList.toggle('active', pane.id === `tab-${tabId}`));
}

/* ==========================================================================
   LOGGING & TOAST HELPERS
   ========================================================================== */
function addLog(level, message) {
  const time = new Date().toLocaleTimeString();
  state.logs.unshift({ time, level, message });
  if (state.logs.length > 250) state.logs.pop();

  els.logCountBadge.textContent = `(${state.logs.length})`;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${time}</td>
    <td><span class="log-level ${level}">${level}</span></td>
    <td>${escapeHtml(message)}</td>
  `;
  els.logsTableBody.prepend(tr);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let toastTimer = null;
function showToast(text) {
  els.toastPopup.textContent = text;
  els.toastPopup.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toastPopup.classList.add('hidden');
  }, 3600);
}

/* ==========================================================================
   EVENT LISTENERS & RUNTIME MESSAGES
   ========================================================================== */
function bindEvents() {
  // Tabs
  els.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Modes
  els.modeCards.forEach((card) => {
    card.addEventListener('click', () => updateModeUI(card.dataset.mode));
  });

  // Image dropzone
  els.imageDropzone.addEventListener('click', () => els.imageFileInput.click());
  els.imageFileInput.addEventListener('change', (e) => handleImageFiles(e.target.files));
  els.imageDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.imageDropzone.classList.add('dragover');
  });
  els.imageDropzone.addEventListener('dragleave', () => els.imageDropzone.classList.remove('dragover'));
  els.imageDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.imageDropzone.classList.remove('dragover');
    handleImageFiles(e.dataTransfer.files);
  });

  els.removeAllImagesBtn.addEventListener('click', async () => {
    state.uploadedImages = [];
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ autoflowImages: [] });
    }
    renderThumbnails();
    parseAndRenderPrompts();
    addLog('INFO', 'Cleared all uploaded reference images.');
  });

  // Prompts live parsing
  els.promptsTextarea.addEventListener('input', parseAndRenderPrompts);
  els.maxImagesPerPrompt.addEventListener('change', parseAndRenderPrompts);
  els.autoPickImagesToggle.addEventListener('change', parseAndRenderPrompts);
  els.autoCharacterToggle.addEventListener('change', parseAndRenderPrompts);
  els.autoVoiceToggle.addEventListener('change', parseAndRenderPrompts);
  els.defaultVoiceSelect.addEventListener('change', parseAndRenderPrompts);

  // Import .txt
  els.importTxtBtn.addEventListener('click', () => els.importTxtInput.click());
  els.importTxtInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      els.promptsTextarea.value = String(ev.target.result || '');
      parseAndRenderPrompts();
      addLog('INFO', `Imported prompt script "${file.name}" (${state.parsedPrompts.length} prompts).`);
    };
    reader.readAsText(file);
  });

  // Scan characters & voices
  els.scanCharactersBtn.addEventListener('click', scanCharactersFromFlow);
  els.syncVoicesBtn.addEventListener('click', syncVoicesFromFlow);
  els.addManualCharBtn?.addEventListener('click', handleAddManualCharacter);
  els.manualCharInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddManualCharacter();
    }
  });

  // Start / Stop / Clear
  els.startAutoFlowBtn.addEventListener('click', startBatchAutoFlow);
  els.stopAutoFlowBtn.addEventListener('click', stopBatchAutoFlow);
  els.clearPromptsBtn.addEventListener('click', () => {
    els.promptsTextarea.value = '';
    parseAndRenderPrompts();
    addLog('INFO', 'Cleared prompt queue.');
  });

  // Settings & License
  els.saveSettingsBtn.addEventListener('click', async () => {
    await persistSettings();
    showToast('Settings saved.');
    addLog('INFO', 'Saved AsidZ AutoFlow settings and custom DOM selectors.');
  });

  els.openLicenseModalBtn.addEventListener('click', () => {
    switchTab('settings');
    els.licenseKeyInput.focus();
  });

  els.verifyLicenseBtn.addEventListener('click', async () => {
    await persistSettings();
    await syncLicenseStatus();
    showToast(`License active: ${state.license.tier}`);
  });

  els.openDownloadSettingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://settings/downloads' });
  });

  // Logs export & clear
  els.clearLogsBtn.addEventListener('click', () => {
    state.logs = [];
    els.logsTableBody.innerHTML = '';
    els.logCountBadge.textContent = '(0)';
  });

  els.exportLogsBtn.addEventListener('click', () => {
    const text = state.logs.map((l) => `[${l.time}] [${l.level}] ${l.message}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `asidz-autoflow-logs-${Date.now()}.txt`;
    a.click();
  });

  // Official AsidZ External Links
  const openUrl = (url) => chrome.tabs.create({ url });
  els.asidzHomeBtn?.addEventListener('click', () => openUrl('https://asidz.com'));
  els.asidzSupportBtn?.addEventListener('click', () => openUrl('https://asidz.com'));
  els.footerAsidzBtn?.addEventListener('click', () => openUrl('https://asidz.com'));
  els.footerSaasBtn?.addEventListener('click', () => openUrl(state.settings.saasApiUrl || 'http://localhost:5050'));

  // Listen for real-time updates from Service Worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'QUEUE_PROGRESS_UPDATE') {
      const q = msg.payload;
      state.queue = { ...state.queue, ...q };
      els.queueStateText.textContent = q.status;
      els.queueFractionText.textContent = `${q.completedCount}/${q.totalToRun} prompts`;
      const pct = q.totalToRun > 0 ? Math.round((q.completedCount / q.totalToRun) * 100) : 0;
      els.queueProgressFill.style.width = `${pct}%`;
      els.queueCurrentPromptText.textContent = q.currentPromptText || '';
      els.queueStepPercentText.textContent = `#${q.currentIndex || 0}: ${q.stepPercent || 0}%`;
      els.startAutoFlowBtn.disabled = q.status === 'Running';
      renderParsedPromptCards();
    } else if (msg.type === 'CDP_LOG_EVENT') {
      addLog(msg.level || 'CDP', msg.message);
    } else if (msg.type === 'QUOTA_UPDATED') {
      state.license = msg.license;
      renderQuotaUI();
    }
  });
}

init();
