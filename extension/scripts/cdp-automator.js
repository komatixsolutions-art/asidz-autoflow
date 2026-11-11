/**
 * AsidZ AutoFlow — Google Flow Content & CDP Helper Script (`cdp-automator.js`)
 * Injected into https://flow.google.com/* and https://labs.google/fx/tools/flow*
 *
 * Responsibilities:
 * 1. Accurately identifies Google Flow's bottom creation dock (strictly y > window.innerHeight * 0.65).
 * 2. Injects batch prompts bypassing React synthetic event barriers using native prototype setters.
 * 3. Applies generation options (Model: Nano Banana 2.1 for images, Veo for videos).
 * 4. Dispatches hardware clicks & keystrokes on the bottom generate arrow button (NEVER sidebar/header).
 * 5. Deep-scans characters from Google Flow's Characters sidebar, drawer, and @-mention popup.
 * 6. Watches for newly created generation cards on the canvas and triggers downloads
 *    strictly for high-resolution project outputs (filtering out UI icons, avatars, and old media).
 */

(() => {
  if (window.__ASIDZ_CDP_AUTOMATOR_LOADED__) return;
  window.__ASIDZ_CDP_AUTOMATOR_LOADED__ = true;

  const baselineMediaUrls = new Set();

  // Strict blocklist of email domains & UI labels that must NEVER be detected as character names
  const CHARACTER_BLOCKLIST = new Set([
    'gmail', 'googlemail', 'google', 'yahoo', 'hotmail', 'outlook', 'icloud', 'live', 'msn', 'aol', 'protonmail', 'zoho',
    'characters', 'character', 'scenes', 'scene', 'library', 'tools', 'media', 'all', 'all_media', 'images', 'image',
    'videos', 'video', 'uploads', 'upload', 'trash', 'collapse', 'expand', 'new', 'create', 'avatar', 'demo', 'pro',
    'free', 'settings', 'help', 'profile', 'account', 'switch', 'upgrade', 'manage', 'subscription', 'sign', 'out',
    'privacy', 'terms', 'service', 'licenses', 'agent', 'nano', 'banana', 'veo', 'omni', 'flash', 'lite', 'done',
    'history', 'show', 'add', 'prompt', 'format', 'recent', 'search', 'assets', 'edit', 'delete', 'remove', 'cancel',
    'approve', 'always', 'reject', 'allow', 'confirm', 'continue', 'submit', 'send', 'generate', 'reset', 'stop',
    'start', 'clear', 'import', 'export', 'download', 'share', 'copy', 'paste', 'undo', 'redo', 'zoom', 'in',
    'eccentric', 'professional', 'wildcard', 'familiar', 'wicked', 'fantastical', 'the', 'and', 'for', 'with'
  ]);

  let currentApprovalPolicy = 'always-approve'; // 'always-approve' | 'approve' | 'reject'

  function isValidCharacterName(rawName) {
    if (!rawName) return false;
    const clean = String(rawName).trim().replace(/^@+/, '');
    if (!clean || clean.length < 2 || clean.length > 24) return false;
    if (/[.@/:\\]/.test(clean)) return false;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(clean)) return false;
    const lower = clean.toLowerCase();
    if (CHARACTER_BLOCKLIST.has(lower)) return false;
    if (/^\d+[a-z]*$/i.test(clean)) return false;
    return true;
  }

  function snapshotExistingMedia() {
    document.querySelectorAll('img[src], video[src], video source[src]').forEach((el) => {
      const src = el.src || el.currentSrc;
      if (src) baselineMediaUrls.add(src);
    });
  }

  snapshotExistingMedia();

  function normalizeButtonLabel(rawText) {
    return String(rawText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/^(check_circle|check|close|clear|done|add|refresh|replay|arrow_forward|auto_awesome)\s*/i, '')
      .trim();
  }

  function fireFullClickSequence(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      if (typeof el.click === 'function') el.click();
    } catch (_) {
      try {
        el.click();
      } catch (__) {}
    }
  }

  /* ==========================================================================
     PRECISION AUTO-APPROVAL & PERMISSION BUTTON DETECTOR
     Strictly matches ONLY compact buttons (text <= 55 chars, height <= 68px, no child buttons)
     Never matches parent chat message cards or conversation containers!
     ========================================================================== */
  function scanAndClickApprovalButtons(policyOverride) {
    const policy = policyOverride || currentApprovalPolicy || 'always-approve';
    const actions = []; // [{ label, x, y }]

    const candidates = Array.from(
      document.querySelectorAll('button, [role="button"], a[role="button"], span[role="button"], div[role="button"]')
    );

    const compactButtons = candidates.filter((btn) => {
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
      const rawText = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!rawText || rawText.length > 55) return false;

      const childButtons = btn.querySelectorAll('button, [role="button"]');
      if (childButtons.length > 0) return false;

      const rect = btn.getBoundingClientRect();
      if (rect.width < 24 || rect.width > 360 || rect.height < 14 || rect.height > 68) return false;

      const style = window.getComputedStyle(btn);
      return style.visibility !== 'hidden' && style.display !== 'none' && parseFloat(style.opacity || '1') > 0.1;
    });

    const recordAndClick = (btn, fallbackLabel) => {
      const lastClicked = Number(btn.dataset.asidzClickedAt || 0);
      if (Date.now() - lastClicked < 2500) return false;
      btn.dataset.asidzClickedAt = String(Date.now());

      const rect = btn.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      const cleanLabel = normalizeButtonLabel(btn.textContent) || fallbackLabel;

      fireFullClickSequence(btn);
      actions.push({ label: cleanLabel, x, y });
      return true;
    };

    if (policy === 'reject') {
      for (const btn of compactButtons) {
        const clean = normalizeButtonLabel(btn.textContent);
        const aria = normalizeButtonLabel(btn.getAttribute('aria-label'));
        if (clean === 'reject' || clean === 'decline' || clean === 'deny' || aria === 'reject') {
          recordAndClick(btn, 'Reject');
        }
      }
      return actions;
    }

    // Priority 1: "Always approve in project" / "Always approve"
    if (policy === 'always-approve') {
      for (const btn of compactButtons) {
        const clean = normalizeButtonLabel(btn.textContent);
        const aria = normalizeButtonLabel(btn.getAttribute('aria-label'));
        if (
          clean === 'always approve in project' ||
          clean === 'always approve' ||
          clean === 'always allow' ||
          clean.includes('always approve in project') ||
          aria.includes('always approve')
        ) {
          recordAndClick(btn, 'Always approve in project');
        }
      }
    }

    // Priority 2: Standard "Approve" button
    for (const btn of compactButtons) {
      const clean = normalizeButtonLabel(btn.textContent);
      const aria = normalizeButtonLabel(btn.getAttribute('aria-label'));
      if (
        clean === 'approve' ||
        clean === 'approve & continue' ||
        clean === 'allow' ||
        clean === 'confirm' ||
        aria === 'approve'
      ) {
        recordAndClick(btn, 'Approve');
      }
    }

    // Priority 3: Click "Try again" if an earlier approval timed out
    if (actions.length === 0) {
      for (const btn of compactButtons) {
        const clean = normalizeButtonLabel(btn.textContent);
        if (clean === 'try again' || clean === 'retry') {
          recordAndClick(btn, 'Try again');
        }
      }
    }

    return actions;
  }

  const approvalObserver = new MutationObserver(() => {
    try {
      const actions = scanAndClickApprovalButtons();
      if (actions.length > 0) {
        chrome.runtime.sendMessage({
          type: 'CDP_APPROVAL_ACTIONS_NEEDED',
          payload: { actions }
        }).catch(() => {});
      }
    } catch (_) {}
  });

  if (document.body) {
    approvalObserver.observe(document.body, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        if (message.type === 'CDP_PREPARE_PROMPT_STEP') {
          const result = await preparePromptStep(message.payload);
          sendResponse(result);
        } else if (message.type === 'CDP_POLL_FOR_NEW_MEDIA') {
          const mediaResult = await pollForNewMedia(message.payload);
          sendResponse(mediaResult);
        } else if (message.type === 'SCAN_CHARACTERS_IN_PAGE') {
          const chars = await deepScanCharacters();
          sendResponse({ ok: true, characters: chars });
        } else if (message.type === 'CDP_CHECK_APPROVAL_BUTTONS') {
          if (message.payload?.approvalPolicy) {
            currentApprovalPolicy = message.payload.approvalPolicy;
          }
          const actions = scanAndClickApprovalButtons(currentApprovalPolicy);
          sendResponse({ ok: true, actions });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  });

  /* ==========================================================================
     DEEP CHARACTER SCANNER (GOOGLE FLOW PROJECT CHARACTERS)
     ========================================================================== */
  function collectCharactersFromVisibleDOM(foundSet) {
    document.querySelectorAll('[data-character-name], [data-testid*="character"], .character-card, .character-item').forEach((el) => {
      const raw = el.getAttribute('data-character-name') || el.textContent;
      if (isValidCharacterName(raw)) {
        foundSet.add(`@${raw.trim().replace(/^@+/, '')}`);
      }
    });

    document.querySelectorAll('div, figure, article, li, button, [role="option"], [role="listitem"]').forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.top < 55 || rect.width < 40 || rect.width > 420 || rect.height < 24 || rect.height > 420) return;

      const hasImg = card.querySelector('img, canvas, svg') !== null;
      if (!hasImg) return;

      const textLeaves = Array.from(card.querySelectorAll('span, div, p, h3, h4, label')).filter(
        (el) => el.children.length === 0 && (el.textContent || '').trim().length > 0
      );

      for (const leaf of textLeaves) {
        const txt = (leaf.textContent || '').trim();
        if (txt.includes(' ') || txt.length > 20) continue;
        if (isValidCharacterName(txt)) {
          const leafRect = leaf.getBoundingClientRect();
          if (leafRect.left > 165 && leafRect.top > 60) {
            foundSet.add(`@${txt.replace(/^@+/, '')}`);
          }
        }
      }
    });
  }

  async function deepScanCharacters() {
    const found = new Set();

    // 1. Collect any characters already visible on the current view
    collectCharactersFromVisibleDOM(found);

    // 2. Open the Left Sidebar "Characters" tab (as seen in Google Flow's left nav)
    const allNavElements = Array.from(document.querySelectorAll('a, button, div[role="button"], span, li'));
    const charNavBtn = allNavElements.find((el) => {
      const txt = (el.textContent || '').trim().toLowerCase();
      const rect = el.getBoundingClientRect();
      return txt === 'characters' && rect.left < 220 && rect.top > 60 && rect.top < 450 && rect.width > 20;
    });

    const allMediaNavBtn = allNavElements.find((el) => {
      const txt = (el.textContent || '').trim().toLowerCase();
      const rect = el.getBoundingClientRect();
      return (txt === 'all media' || txt === 'scenes' || txt === 'images') && rect.left < 220 && rect.top > 50 && rect.top < 350;
    });

    if (charNavBtn) {
      const clickTarget = charNavBtn.closest('button, a, div[role="button"], li') || charNavBtn;
      clickTarget.click();
      await sleep(550);
      collectCharactersFromVisibleDOM(found);

      document.querySelectorAll('span, div, h3, h4, p').forEach((el) => {
        if (el.children.length > 0) return;
        const txt = (el.textContent || '').trim();
        if (!txt || txt.includes(' ')) return;
        const rect = el.getBoundingClientRect();
        if (rect.left > 180 && rect.top > 70 && rect.top < window.innerHeight - 120 && rect.width > 12) {
          if (isValidCharacterName(txt)) {
            found.add(`@${txt.replace(/^@+/, '')}`);
          }
        }
      });
    }

    // 3. If still empty, check the Bottom Dock "+" Asset Picker Popover -> "Characters" tab
    if (found.size === 0) {
      const plusBtn = findBottomDockPlusButton();
      if (plusBtn) {
        plusBtn.click();
        await sleep(450);

        const popoverCharTab = Array.from(document.querySelectorAll('button, div[role="button"], span, li')).find((el) => {
          const t = (el.textContent || '').trim().toLowerCase();
          const r = el.getBoundingClientRect();
          return t === 'characters' && r.top > window.innerHeight * 0.35;
        });

        if (popoverCharTab) {
          (popoverCharTab.closest('button, div[role="button"], li') || popoverCharTab).click();
          await sleep(400);
        }

        document.querySelectorAll('span, div, p, li').forEach((el) => {
          if (el.children.length > 0) return;
          const t = (el.textContent || '').trim();
          const r = el.getBoundingClientRect();
          if (r.top > window.innerHeight * 0.35 && r.top < window.innerHeight - 90 && r.left > 180 && r.left < 700) {
            if (!t.includes(' ') && isValidCharacterName(t)) {
              found.add(`@${t.replace(/^@+/, '')}`);
            }
          }
        });

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await sleep(150);
      }
    }

    if (charNavBtn && allMediaNavBtn) {
      try {
        (allMediaNavBtn.closest('button, a, div[role="button"], li') || allMediaNavBtn).click();
      } catch (_) {}
    }

    return Array.from(found);
  }

  function findBottomDockPlusButton() {
    const minTop = window.innerHeight * 0.65;
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    return buttons.find((btn) => {
      const r = btn.getBoundingClientRect();
      if (r.top < minTop || r.left > window.innerWidth * 0.45) return false;
      const txt = (btn.textContent || '').trim();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      return txt === '+' || aria.includes('add') || aria.includes('attach') || aria.includes('ingredient');
    });
  }

  /* ==========================================================================
     ATTACH PROJECT CHARACTERS VIA FLOW'S "+" ASSET PICKER POPOVER
     ========================================================================== */
  async function attachCharactersFromFlowPicker(characterTags) {
    if (!Array.isArray(characterTags) || characterTags.length === 0) return;

    const plusBtn = findBottomDockPlusButton();
    if (!plusBtn) return;

    for (const charTag of characterTags) {
      const bareName = charTag.replace(/^@+/, '').trim();
      if (!bareName) continue;

      try {
        plusBtn.click();
        await sleep(380);

        const popoverCharTab = Array.from(document.querySelectorAll('button, div[role="button"], span, li')).find((el) => {
          const t = (el.textContent || '').trim().toLowerCase();
          const r = el.getBoundingClientRect();
          return t === 'characters' && r.top > window.innerHeight * 0.3;
        });

        if (popoverCharTab) {
          (popoverCharTab.closest('button, div[role="button"], li') || popoverCharTab).click();
          await sleep(300);
        }

        const searchInput = Array.from(document.querySelectorAll('input[type="text"], input[placeholder*="Search" i]')).find((inp) => {
          const r = inp.getBoundingClientRect();
          return r.top > window.innerHeight * 0.3 && r.width > 60;
        });

        if (searchInput) {
          setReactControlledValue(searchInput, bareName);
          await sleep(250);
        }

        const charRow = Array.from(document.querySelectorAll('div, li, button, span')).find((el) => {
          if (el.children.length > 0) return false;
          const t = (el.textContent || '').trim().toLowerCase();
          const r = el.getBoundingClientRect();
          return t === bareName.toLowerCase() && r.top > window.innerHeight * 0.3 && r.top < window.innerHeight - 80;
        });

        if (charRow) {
          const clickableRow = charRow.closest('li, button, div[role="button"], div[role="option"], div[tabindex]') || charRow;
          clickableRow.click();
          await sleep(250);

          const addToPromptBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find((b) => {
            const t = (b.textContent || '').trim().toLowerCase();
            return t.includes('add to prompt') || t === 'add' || t === 'insert';
          });
          if (addToPromptBtn) {
            addToPromptBtn.click();
            await sleep(250);
          }
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
          await sleep(150);
        }
      } catch (_) {}
    }
  }

  /* ==========================================================================
     PREPARE PROMPT STEP (TAG CHARACTERS, APPLY SETTINGS, RETURN DOCK COORDS)
     ========================================================================== */
  async function preparePromptStep({ mode, promptItem, settings }) {
    snapshotExistingMedia();

    if (settings?.approvalPolicy) {
      currentApprovalPolicy = settings.approvalPolicy;
    }

    // Click any pre-existing approval banner before injecting
    scanAndClickApprovalButtons(currentApprovalPolicy);

    // Automatically scan characters from Flow if none were synced yet and autoCharacter is on
    let activeCharacters = Array.isArray(promptItem.matchedCharacters) ? [...promptItem.matchedCharacters] : [];
    if (settings?.autoCharacter && activeCharacters.length === 0) {
      const scanned = await deepScanCharacters();
      for (const charTag of scanned) {
        const bare = charTag.replace(/^@+/, '');
        const regex = new RegExp(`(@?\\b${bare}\\b)`, 'i');
        if (regex.test(promptItem.cleanPrompt)) {
          activeCharacters.push(charTag);
        }
      }
    }

    const inputEl = findFlowBottomPromptInput();
    if (!inputEl) {
      return {
        ok: false,
        error: 'Google Flow prompt bar not found at the bottom of the screen. Make sure you are inside an active Flow project canvas.'
      };
    }

    // 1. Apply model setting in bottom dock
    await applyModelSettingInBottomDock(mode, settings);

    // 2. Attach matched characters from Flow's "+" Character Picker if present
    if (activeCharacters.length > 0) {
      await attachCharactersFromFlowPicker(activeCharacters);
    }

    // 3. Attach reference images if present
    if (Array.isArray(promptItem.matchedImages) && promptItem.matchedImages.length > 0) {
      await attachReferenceImages(promptItem.matchedImages);
    }

    // 4. Tag character names directly inside the scene prompt (e.g. "ALI" -> "@Ali")
    let composedPrompt = promptItem.cleanPrompt;
    if (activeCharacters.length > 0) {
      for (const charTag of activeCharacters) {
        const bare = charTag.replace(/^@+/, '');
        const wordRegex = new RegExp(`(?<!@)\\b${bare}\\b`, 'gi');
        if (wordRegex.test(composedPrompt)) {
          composedPrompt = composedPrompt.replace(wordRegex, `@${bare}`);
        } else if (!composedPrompt.toLowerCase().includes(`@${bare.toLowerCase()}`)) {
          composedPrompt = `@${bare} ${composedPrompt}`;
        }
      }
    }

    if (promptItem.matchedVoices?.length > 0 && !composedPrompt.toLowerCase().includes('voice')) {
      composedPrompt += ` [Voice: ${promptItem.matchedVoices.join(', ')}]`;
    }

    // Re-locate bottom input in case DOM updated after modal close
    const finalInputEl = findFlowBottomPromptInput() || inputEl;
    finalInputEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    finalInputEl.focus();

    // Set React controlled value
    setReactControlledValue(finalInputEl, composedPrompt);

    const inputRect = finalInputEl.getBoundingClientRect();
    const inputCoords = {
      x: inputRect.left + Math.min(120, inputRect.width / 3),
      y: inputRect.top + inputRect.height / 2
    };

    // Locate the Submit Arrow Button strictly inside the bottom creation dock
    const submitBtn = findFlowBottomSubmitButton(finalInputEl);
    let submitCoords = null;

    if (submitBtn) {
      const submitRect = submitBtn.getBoundingClientRect();
      submitCoords = {
        x: submitRect.left + submitRect.width / 2,
        y: submitRect.top + submitRect.height / 2
      };

      setTimeout(() => {
        try {
          submitBtn.click();
        } catch (_) {}
      }, 350);
    } else {
      submitCoords = {
        x: inputRect.right - 24,
        y: inputRect.top + inputRect.height / 2
      };
    }

    return {
      ok: true,
      matchedSelector: getSelectorForElement(finalInputEl),
      composedPrompt,
      matchedCharacters: activeCharacters,
      inputCoords,
      submitCoords
    };
  }

  /**
   * Strictly locates Google Flow's prompt input in the BOTTOM DOCK (y > window.innerHeight * 0.65).
   * Never selects header or sidebar search boxes.
   */
  function findFlowBottomPromptInput() {
    const minTop = window.innerHeight * 0.6; // Must be in the lower 40% of the screen

    // 1. Check elements with placeholder "What do you want to create?"
    const candidates = Array.from(
      document.querySelectorAll(
        "textarea, input[placeholder*='create' i], input[placeholder*='prompt' i], [contenteditable='true'], [role='textbox']"
      )
    );

    const bottomInput = candidates.find((el) => {
      const rect = el.getBoundingClientRect();
      return (
        rect.top >= minTop &&
        rect.width > 60 &&
        rect.height > 18 &&
        window.getComputedStyle(el).visibility !== 'hidden' &&
        window.getComputedStyle(el).display !== 'none'
      );
    });

    if (bottomInput) return bottomInput;

    // 2. Check for container positioned at the bottom
    const allContainers = Array.from(document.querySelectorAll('form, div, [role="region"], footer'));
    for (const cont of allContainers) {
      const r = cont.getBoundingClientRect();
      if (r.top >= minTop && r.height < 250 && r.width > 200) {
        const inp = cont.querySelector('textarea, input, [contenteditable="true"]');
        if (inp) return inp;
      }
    }

    return null;
  }

  /**
   * Strictly locates the Generate Arrow Button in the BOTTOM DOCK (y > window.innerHeight * 0.65).
   * NEVER clicks "+ Create new project" or sidebar buttons in the top half of the screen.
   */
  function findFlowBottomSubmitButton(inputEl) {
    const minTop = window.innerHeight * 0.6;

    // Search inside the prompt input's parent dock container
    const container =
      inputEl.closest('form, div[class*="prompt"], [role="region"]') ||
      inputEl.parentElement?.parentElement ||
      inputEl.parentElement;

    if (container) {
      const buttons = Array.from(container.querySelectorAll('button, div[role="button"]'));
      // Find button on the right side of the dock (x > inputRect.left + 50)
      const inputRect = inputEl.getBoundingClientRect();
      const rightBtns = buttons.filter((btn) => {
        const r = btn.getBoundingClientRect();
        return r.top >= minTop && r.left > inputRect.left + 40 && !btn.disabled;
      });

      // Prefer button with SVG arrow icon or generate aria-label
      const arrowBtn = rightBtns.find((btn) => {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const hasSvg = btn.querySelector('svg') !== null;
        return hasSvg || aria.includes('generate') || aria.includes('submit') || aria.includes('send') || aria.includes('arrow');
      });

      if (arrowBtn) return arrowBtn;
      if (rightBtns.length > 0) return rightBtns[rightBtns.length - 1];
    }

    // Global fallback ONLY in bottom region
    const bottomBtns = Array.from(document.querySelectorAll('button')).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.top >= minTop && r.left > window.innerWidth * 0.4 && !b.disabled;
    });

    const bottomArrow = bottomBtns.find((b) => b.querySelector('svg') !== null || /generate|submit|send/i.test(b.getAttribute('aria-label') || ''));
    return bottomArrow || bottomBtns[bottomBtns.length - 1] || null;
  }

  /**
   * Applies model setting (Nano Banana 2.1 vs Veo / Omni) AND ensures the "Agent" toggle
   * is OFF during direct image/video modes (so Flow generates directly without asking chat confirmation),
   * or ON when mode === 'agent-automation'.
   */
  async function applyModelSettingInBottomDock(mode, settings) {
    const isImageMode = mode === 'text-to-image' || mode === 'image-to-image';
    const targetModelKeyword = isImageMode ? 'Nano Banana' : 'Veo';
    const minTop = window.innerHeight * 0.58;

    const dockButtons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.top >= minTop && r.height <= 60;
    });

    const agentBtn = dockButtons.find((b) => normalizeButtonLabel(b.textContent) === 'agent');
    if (agentBtn) {
      const isAgentActive =
        agentBtn.getAttribute('aria-pressed') === 'true' ||
        agentBtn.getAttribute('data-state') === 'on' ||
        agentBtn.classList.contains('active') ||
        agentBtn.classList.contains('selected');

      if (mode === 'agent-automation' && !isAgentActive) {
        fireFullClickSequence(agentBtn);
        await sleep(200);
      } else if (mode !== 'agent-automation' && isAgentActive) {
        fireFullClickSequence(agentBtn);
        await sleep(200);
      }
    }

    const modelPill = dockButtons.find((b) => {
      const text = (b.textContent || '').trim();
      return (
        text.includes('Nano Banana') ||
        text.includes('Veo') ||
        text.includes('Omni') ||
        text.includes('Flash') ||
        text.includes('Video') ||
        text.includes('Image')
      );
    });

    if (modelPill) {
      const currentText = (modelPill.textContent || '').trim();
      const needsSwitch = isImageMode
        ? !currentText.includes('Nano Banana') && !currentText.includes('Image')
        : currentText.includes('Nano Banana') || currentText.includes('Image');

      if (needsSwitch) {
        fireFullClickSequence(modelPill);
        await sleep(280);

        const tabTarget = isImageMode ? 'image' : 'video';
        const modeTab = Array.from(document.querySelectorAll('button, div[role="button"], [role="tab"]')).find((el) => {
          const t = normalizeButtonLabel(el.textContent);
          const r = el.getBoundingClientRect();
          return t === tabTarget && r.top > window.innerHeight * 0.35;
        });
        if (modeTab) {
          fireFullClickSequence(modeTab);
          await sleep(200);
        }

        const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], li, button, div[role="button"]'));
        const match = menuItems.find((item) => {
          const r = item.getBoundingClientRect();
          return r.top > window.innerHeight * 0.35 && (item.textContent || '').includes(targetModelKeyword);
        });
        if (match) {
          fireFullClickSequence(match);
          await sleep(180);
        }

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await sleep(120);
      }
    }
  }

  /**
   * Sets value into React controlled inputs by calling native prototype descriptors
   * and firing synthetic input/change events.
   */
  function setReactControlledValue(element, value) {
    if (!element) return;
    if ('value' in element) {
      const proto =
        element instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(element, value);
      } else {
        element.value = value;
      }
    } else {
      element.textContent = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
  }

  function getSelectorForElement(el) {
    if (el.id) return `#${el.id}`;
    if (el.tagName.toLowerCase() === 'textarea') return 'textarea';
    if (el.getAttribute('placeholder')) return `input[placeholder="${el.getAttribute('placeholder')}"]`;
    return 'textarea, [contenteditable="true"]';
  }

  async function attachReferenceImages(images) {
    const dataTransfer = new DataTransfer();
    for (const img of images) {
      if (!img.dataUrl) continue;
      try {
        const res = await fetch(img.dataUrl);
        const blob = await res.blob();
        const file = new File([blob], img.name, { type: img.mimeType || 'image/png' });
        dataTransfer.items.add(file);
      } catch (_) {}
    }

    const fileInput = document.querySelector("input[type='file']");
    if (fileInput) {
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * Polls Google Flow's canvas for the newly generated output media.
   * Filters out all avatars, UI icons, Google logos, and files that were in the baseline snapshot.
   */
  function pollForNewMedia({ mode, promptTag, approvalPolicy, timeoutMs = 45000 }) {
    const isImageMode = mode === 'text-to-image' || mode === 'image-to-image';
    const startTime = Date.now();
    if (approvalPolicy) {
      currentApprovalPolicy = approvalPolicy;
    }

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const actions = scanAndClickApprovalButtons(currentApprovalPolicy);
        if (actions.length > 0) {
          chrome.runtime.sendMessage({
            type: 'CDP_APPROVAL_ACTIONS_NEEDED',
            payload: { actions }
          }).catch(() => {});
        }

        const selector = isImageMode ? 'img[src]' : 'video[src], video source[src]';
        const elements = Array.from(document.querySelectorAll(selector));

        for (const el of elements) {
          const src = el.src || el.currentSrc;
          if (!src || baselineMediaUrls.has(src)) continue;

          const lower = src.toLowerCase();
          if (
            lower.includes('avatar') ||
            lower.includes('icon') ||
            lower.includes('logo') ||
            lower.includes('favicon') ||
            lower.includes('asset') ||
            lower.includes('profile') ||
            src.startsWith('data:image/svg')
          ) {
            continue;
          }

          if (isImageMode && el.naturalWidth && el.naturalWidth < 256) {
            continue;
          }

          baselineMediaUrls.add(src);
          clearInterval(checkInterval);

          if (src.startsWith('blob:')) {
            triggerBlobDownload(src, isImageMode ? 'png' : 'mp4', promptTag);
          }

          resolve({
            ok: true,
            mediaUrl: src,
            mediaType: isImageMode ? 'image' : 'video'
          });
          return;
        }

        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          resolve({ ok: false, mediaUrl: null });
        }
      }, 1000);
    });
  }

  function triggerBlobDownload(blobUrl, ext, promptTag) {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${promptTag || 'asidz_flow'}_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
})();
