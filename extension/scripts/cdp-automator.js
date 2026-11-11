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

  function snapshotExistingMedia() {
    document.querySelectorAll('img[src], video[src], video source[src]').forEach((el) => {
      const src = el.src || el.currentSrc;
      if (src) baselineMediaUrls.add(src);
    });
  }

  snapshotExistingMedia();

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
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  });

  /**
   * Deep-scans characters from Google Flow:
   * 1. Inspects active canvas chips and data attributes.
   * 2. Inspects the Characters drawer / sidebar.
   * 3. Temporarily types '@' into the prompt bar to read Flow's autocomplete list.
   */
  async function deepScanCharacters() {
    const found = new Set();

    // 1. Scan any rendered character elements or pills in canvas / sidebars
    document.querySelectorAll('[data-character-name], [data-testid*="character"], .character-card, .character-item').forEach((el) => {
      const name = el.getAttribute('data-character-name') || el.textContent;
      if (name) {
        const clean = name.trim().replace(/^@/, '');
        if (clean && clean.length <= 25) found.add(`@${clean}`);
      }
    });

    // 2. Scan text nodes containing @Name
    document.querySelectorAll('span, p, div, button').forEach((el) => {
      if (el.children.length === 0) {
        const txt = (el.textContent || '').trim();
        const matches = txt.match(/@[A-Za-z0-9_]{2,24}/g);
        if (matches) {
          matches.forEach((m) => found.add(m));
        }
      }
    });

    // 3. Inspect the left sidebar Characters tab
    const sidebarButtons = Array.from(document.querySelectorAll('button, div[role="button"], a, span'));
    const charTabBtn = sidebarButtons.find((el) => {
      const t = (el.textContent || '').trim().toLowerCase();
      const rect = el.getBoundingClientRect();
      return (t === 'characters' || t.includes('character')) && rect.left < 260 && rect.top < 380;
    });

    if (charTabBtn && found.size === 0) {
      // Temporarily open Characters panel to read names
      charTabBtn.click();
      await new Promise((r) => setTimeout(r, 400));
      document.querySelectorAll('h3, h4, span, div').forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.left < 360 && rect.width > 20 && rect.height > 12) {
          const t = (el.textContent || '').trim();
          if (t && /^[A-Za-z0-9_-]{2,20}$/.test(t) && !['characters', 'scenes', 'library', 'tools', 'media', 'create', 'all'].includes(t.toLowerCase())) {
            found.add(`@${t}`);
          }
        }
      });
    }

    // 4. Try @-mention autocomplete in prompt bar if still empty
    if (found.size === 0) {
      const input = findFlowBottomPromptInput();
      if (input) {
        input.focus();
        setReactControlledValue(input, '@');
        await new Promise((r) => setTimeout(r, 450));
        document.querySelectorAll('[role="listbox"] [role="option"], [role="menu"] [role="menuitem"], .mention-item').forEach((opt) => {
          const t = (opt.textContent || '').trim().replace(/^@/, '');
          if (t) found.add(`@${t}`);
        });
        setReactControlledValue(input, '');
      }
    }

    return Array.from(found);
  }

  /**
   * Prepares the Google Flow canvas for prompt generation:
   * 1. Takes a fresh snapshot of existing media.
   * 2. Locates the bottom prompt dock (strictly y > window.innerHeight * 0.65).
   * 3. Sets target model (Nano Banana 2.1 for image, Veo for video).
   * 4. Injects reference assets.
   * 5. Sets prompt text via React prototype setters.
   * 6. Returns exact coordinates of bottom dock arrow button.
   */
  async function preparePromptStep({ mode, promptItem, settings }) {
    snapshotExistingMedia();

    const inputEl = findFlowBottomPromptInput();
    if (!inputEl) {
      return {
        ok: false,
        error: 'Google Flow prompt bar not found at the bottom of the screen. Make sure you are inside an active Flow project canvas.'
      };
    }

    // Apply model setting in bottom dock
    await applyModelSettingInBottomDock(mode, settings);

    // Attach reference images if present
    if (Array.isArray(promptItem.matchedImages) && promptItem.matchedImages.length > 0) {
      await attachReferenceImages(promptItem.matchedImages);
    }

    // Focus bottom prompt input
    inputEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    inputEl.focus();

    let composedPrompt = promptItem.cleanPrompt;
    if (promptItem.matchedVoices?.length > 0 && !composedPrompt.toLowerCase().includes('voice')) {
      composedPrompt += ` [Voice: ${promptItem.matchedVoices.join(', ')}]`;
    }

    // Set React controlled value
    setReactControlledValue(inputEl, composedPrompt);

    const inputRect = inputEl.getBoundingClientRect();
    const inputCoords = {
      x: inputRect.left + inputRect.width / 2,
      y: inputRect.top + inputRect.height / 2
    };

    // Locate the Submit Arrow Button strictly inside the bottom creation dock
    const submitBtn = findFlowBottomSubmitButton(inputEl);
    let submitCoords = null;

    if (submitBtn) {
      const submitRect = submitBtn.getBoundingClientRect();
      submitCoords = {
        x: submitRect.left + submitRect.width / 2,
        y: submitRect.top + submitRect.height / 2
      };

      // In-page click backup
      setTimeout(() => {
        try {
          submitBtn.click();
        } catch (_) {}
      }, 300);
    } else {
      // Fallback coordinate: right end of bottom prompt bar
      submitCoords = {
        x: inputRect.right - 24,
        y: inputRect.top + inputRect.height / 2
      };
    }

    return {
      ok: true,
      matchedSelector: getSelectorForElement(inputEl),
      composedPrompt,
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
   * Applies model setting (Nano Banana 2.1 vs Veo) in Google Flow's bottom creation dock.
   */
  async function applyModelSettingInBottomDock(mode, settings) {
    const isImageMode = mode === 'text-to-image' || mode === 'image-to-image';
    const targetModelKeyword = isImageMode ? 'Nano Banana' : 'Veo';
    const minTop = window.innerHeight * 0.6;

    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.top >= minTop;
    });

    const modelPill = buttons.find((b) => {
      const text = (b.textContent || '').trim();
      return text.includes('Nano Banana') || text.includes('Veo') || text.includes('Omni') || text.includes('Flash');
    });

    if (modelPill) {
      const currentText = (modelPill.textContent || '').trim();
      if (!currentText.includes(targetModelKeyword)) {
        modelPill.click();
        await new Promise((r) => setTimeout(r, 220));

        const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], li, button'));
        const match = menuItems.find((item) => (item.textContent || '').includes(targetModelKeyword));
        if (match) {
          match.click();
          await new Promise((r) => setTimeout(r, 150));
        }
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
  function pollForNewMedia({ mode, promptTag, timeoutMs = 28000 }) {
    const isImageMode = mode === 'text-to-image' || mode === 'image-to-image';
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const selector = isImageMode ? 'img[src]' : 'video[src], video source[src]';
        const elements = Array.from(document.querySelectorAll(selector));

        for (const el of elements) {
          const src = el.src || el.currentSrc;
          if (!src || baselineMediaUrls.has(src)) continue;

          // Filter out UI assets, avatars, small icons, Google brand images
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

          // In image mode, skip low-res UI thumbnails
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
})();
