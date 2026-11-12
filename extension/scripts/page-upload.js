/**
 * AsidZ AutoFlow — In-Page File Upload Interceptor (MAIN World)
 * Official Platform: https://asidz.com
 *
 * Runs at document_start in the MAIN world execution context.
 * Captures programmatic and user clicks on hidden <input type="file"> elements in Google Flow
 * and transparently injects user reference images/videos via DataTransfer API.
 */
(function () {
  'use strict';
  if (window.__asidzUploadHook) return;
  window.__asidzUploadHook = true;

  const ACTIVE_ATTR = 'data-asidz-upload-active';
  const LEGACY_ATTR = 'data-aws-upload-active';
  let pendingInput = null;

  function isUploadActive() {
    return (
      document.documentElement.getAttribute(ACTIVE_ATTR) === 'true' ||
      document.documentElement.getAttribute(LEGACY_ATTR) === 'true'
    );
  }

  const nativeClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function (...args) {
    if (this.type !== 'file' || !isUploadActive()) {
      return nativeClick.apply(this, args);
    }
    pendingInput = this;
    document.dispatchEvent(new CustomEvent('ASIDZ_FILE_INPUT_CAPTURED'));
    document.dispatchEvent(new CustomEvent('AWS_FILE_INPUT_CAPTURED'));
  };

  if (HTMLInputElement.prototype.showPicker) {
    const nativePicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function (...args) {
      if (this.type !== 'file' || !isUploadActive()) {
        return nativePicker.apply(this, args);
      }
      pendingInput = this;
      document.dispatchEvent(new CustomEvent('ASIDZ_FILE_INPUT_CAPTURED'));
      document.dispatchEvent(new CustomEvent('AWS_FILE_INPUT_CAPTURED'));
    };
  }

  function handleUploadEvent(ev) {
    let data = ev.detail;
    try {
      if (typeof data === 'string') data = JSON.parse(data);
    } catch (_) {
      data = null;
    }
    const input = pendingInput || document.querySelector('input[type="file"]');
    if (!data || !input) return;

    try {
      let b64 = data.base64 || '';
      if (b64.includes(',')) b64 = b64.split(',')[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], data.filename || 'upload.jpg', {
        type: data.mimeType || 'image/jpeg'
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      document.dispatchEvent(new CustomEvent('ASIDZ_UPLOAD_DONE'));
      document.dispatchEvent(new CustomEvent('AWS_UPLOAD_DONE'));
    } catch (e) {
      document.dispatchEvent(new CustomEvent('ASIDZ_UPLOAD_ERROR', { detail: String(e) }));
      document.dispatchEvent(new CustomEvent('AWS_UPLOAD_ERROR', { detail: String(e) }));
    } finally {
      pendingInput = null;
    }
  }

  document.addEventListener('ASIDZ_UPLOAD_FILE_DATA', handleUploadEvent);
  document.addEventListener('AWS_UPLOAD_FILE_DATA', handleUploadEvent);
})();
