/**
 * AsidZ AutoFlow — Google Flow Content & CDP Helper Script (`cdp-automator.js`)
 * Injected into https://flow.google.com/* and https://labs.google/fx/tools/flow*
 *
 * Responsibilities:
 * 1. Accurately identifies Google Flow's active canvas prompt dock at the bottom of the screen.
 * 2. Injects batch prompts bypassing React synthetic event barriers using native prototype setters.
 * 3. Applies generation options (Model: Nano Banana / Veo, Aspect Ratio, Outputs).
 * 4. Dispatches hardware clicks & keystrokes on the generate arrow button.
 * 5. Watches for newly created generation cards on the canvas and triggers downloads
 *    strictly for high-resolution project outputs (filtering out UI icons, avatars, and old media).
 */

(() => {
  if (window.__ASIDZ_CDP_AUTOMATOR_LOADED__) return;
  window.__ASIDZ_CDP_AUTOMATOR_LOADED__ = true;

  // Snapshot of pre-existing media to ensure we only download newly generated project files
  const baselineMediaUrls = new Set();

  function snapshotExistingMedia() {
    document.querySelectorAll('img[src], video[src], video source[src]').forEach((el) => {
      const src = el.src || el.currentSrc;
      if (src) baselineMediaUrls.add(src);
    });
  }

  // Initial snapshot on load
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
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  });

  /**
   * Prepares the Google Flow canvas for prompt generation:
   * 1. Takes a fresh snapshot of all existing media before clicking generate.
   * 2. Locates the bottom prompt input bar ("What do you want to create?").
   * 3. Selects the target model (Nano Banana / Veo) in Flow's bottom bar.
   * 4. Injects reference assets & characters.
   * 5. Sets the prompt text into React controlled state.
   * 6. Returns exact coordinates for CDP hardware-level click & enter dispatch.
   */
  async function preparePromptStep({ mode, promptItem, settings }) {
    // 1. Snapshot existing media right before submitting
    snapshotExistingMedia();

    // 2. Locate the prompt input element in Google Flow
    const inputEl = findFlowPromptInput();
    if (!inputEl) {
      return {
        ok: false,
        error: 'Google Flow prompt bar not found. Make sure you have opened a project canvas on flow.google.com.'
      };
    }

    // 3. Ensure target model (Nano Banana for Text-to-Image vs Veo for Video) is selected in Flow
    await applyModelSettingInFlow(mode, settings);

    // 4. Attach reference images if present
    if (Array.isArray(promptItem.matchedImages) && promptItem.matchedImages.length > 0) {
      await attachReferenceImages(promptItem.matchedImages);
    }

    // 5. Select @character chips if present in prompt
    if (Array.isArray(promptItem.matchedCharacters) && promptItem.matchedCharacters.length > 0) {
      activateCharacterChips(promptItem.matchedCharacters);
    }

    // 6. Focus and compose prompt text
    inputEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    inputEl.focus();

    let composedPrompt = promptItem.cleanPrompt;
    if (promptItem.matchedVoices?.length > 0 && !composedPrompt.toLowerCase().includes('voice')) {
      composedPrompt += ` [Voice: ${promptItem.matchedVoices.join(', ')}]`;
    }

    // Set React controlled value so Google Flow detects the change
    setReactControlledValue(inputEl, composedPrompt);

    const inputRect = inputEl.getBoundingClientRect();
    const inputCoords = {
      x: inputRect.left + inputRect.width / 2,
      y: inputRect.top + inputRect.height / 2
    };

    // 7. Find the right-arrow submit button inside the prompt bar
    const submitBtn = findFlowSubmitButton(inputEl);
    let submitCoords = null;
    if (submitBtn) {
      submitBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
      const submitRect = submitBtn.getBoundingClientRect();
      submitCoords = {
        x: submitRect.left + submitRect.width / 2,
        y: submitRect.top + submitRect.height / 2
      };

      // Also trigger in-page click as immediate backup
      setTimeout(() => {
        try {
          submitBtn.click();
        } catch (_) {}
      }, 350);
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
   * Robust locator for Google Flow's prompt input element.
   * Matches Flow's bottom creation dock across different UI versions.
   */
  function findFlowPromptInput() {
    // 1. Check for inputs with "create" or "prompt" in placeholder
    const placeholderCandidates = Array.from(
      document.querySelectorAll(
        "textarea, input[placeholder*='create' i], input[placeholder*='prompt' i], [contenteditable='true'], [role='textbox']"
      )
    );

    const visibleInput = placeholderCandidates.find((el) => {
      const rect = el.getBoundingClientRect();
      return (
        rect.width > 50 &&
        rect.height > 20 &&
        window.getComputedStyle(el).visibility !== 'hidden' &&
        window.getComputedStyle(el).display !== 'none'
      );
    });

    if (visibleInput) return visibleInput;

    // 2. Check for bottom dock / form container
    const bottomDock = document.querySelector("form, [role='region'], div[class*='prompt'], footer");
    if (bottomDock) {
      const dockInput = bottomDock.querySelector('textarea, input, [contenteditable="true"]');
      if (dockInput) return dockInput;
    }

    return null;
  }

  /**
   * Locates Google Flow's Submit / Generate button (the circular arrow button on the right).
   */
  function findFlowSubmitButton(inputEl) {
    // Search within the input's parent container
    const container = inputEl.closest('form, div[class*="prompt"], [role="region"], div[style*="fixed"], div');
    if (container) {
      // Find button with SVG arrow icon or generate aria-label
      const buttons = Array.from(container.querySelectorAll('button'));
      const arrowBtn = buttons.find((btn) => {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const hasSvg = btn.querySelector('svg') !== null;
        return (
          aria.includes('generate') ||
          aria.includes('submit') ||
          aria.includes('create') ||
          aria.includes('send') ||
          hasSvg
        );
      });
      if (arrowBtn) return arrowBtn;
      if (buttons.length > 0) return buttons[buttons.length - 1];
    }

    // Fallback: global search for generate buttons
    const globalBtns = Array.from(
      document.querySelectorAll(
        "button[aria-label*='generate' i], button[aria-label*='create' i], button[type='submit']"
      )
    );
    return globalBtns.find((b) => !b.disabled && b.getBoundingClientRect().width > 16) || null;
  }

  /**
   * Selects target model (e.g. Nano Banana 2.1 for image, Veo for video) in Flow's bottom bar.
   */
  async function applyModelSettingInFlow(mode, settings) {
    const isImageMode = mode === 'text-to-image' || mode === 'image-to-image';
    const targetModelKeyword = isImageMode ? 'Nano Banana' : 'Veo';

    // Find model pill button in Google Flow's prompt bar
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const modelPill = buttons.find((b) => {
      const text = (b.textContent || '').trim();
      return text.includes('Nano Banana') || text.includes('Veo') || text.includes('Omni') || text.includes('Flash');
    });

    if (modelPill) {
      const currentText = (modelPill.textContent || '').trim();
      if (!currentText.includes(targetModelKeyword)) {
        modelPill.click();
        await new Promise((r) => setTimeout(r, 200));

        // In dropdown menu, click the matching model option
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

  function activateCharacterChips(charTags) {
    const candidates = Array.from(document.querySelectorAll('[data-character-name], .character-chip, button, span'));
    for (const tag of charTags) {
      const match = candidates.find((el) => (el.textContent || '').trim().toLowerCase() === tag.toLowerCase());
      if (match) match.click();
    }
  }

  /**
   * Polls Google Flow's canvas for the newly generated output media.
   * Filters out all avatars, UI icons, Google logos, and files that were in the baseline snapshot.
   */
  function pollForNewMedia({ mode, promptTag, timeoutMs = 25000 }) {
    const isImageMode = mode === 'text-to-image' || mode === 'image-to-image';
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        // Look for videos or images on the Google Flow canvas
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
            src.startsWith('data:image/svg')
          ) {
            continue;
          }

          // In image mode, skip low-res UI thumbnails
          if (isImageMode && el.naturalWidth && el.naturalWidth < 256) {
            continue;
          }

          // Found a legitimate newly generated output!
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
