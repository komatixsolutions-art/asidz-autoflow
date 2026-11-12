/**
 * AsidZ AutoFlow — Core Helper Engine & CDP Input Bridge
 * Official Platform: https://asidz.com
 *
 * Provides:
 * - Robust jQuery/Sizzle selector query engine (q, isUsable, waitFor, findClickable, findItemByName)
 * - Chrome Debugger (CDP 1.3) trusted mouse and keyboard dispatchers
 * - Editor focus and caret positioning
 * - Settings cache with TTL
 * - Prompt pattern matching for character @mentions and image assets
 */
var ASIDZ = window.ASIDZ || {};
window.ASIDZ = ASIDZ;
// Backwards compatibility alias
window.AWS = ASIDZ;
var AWS = ASIDZ;

(function () {
  'use strict';
  const $ = window.jQuery;
  ASIDZ.$ = $;

  /* ---------- logging (broadcast to side panel "Logs" tab) ---------- */
  const fmt = (args) =>
    args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a)))
      .join(' ');

  const send = (level, args) => {
    const entry = { level, message: fmt(args), timestamp: Date.now() };
    try {
      chrome.runtime.sendMessage({ type: 'ACTION_LOG', data: entry }).catch(() => {});
      chrome.runtime.sendMessage({ type: 'CDP_LOG_EVENT', level: level.toUpperCase(), message: entry.message }).catch(() => {});
    } catch (_) {}
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(
      '[AsidZ AutoFlow]',
      entry.message
    );
  };

  ASIDZ.log = (...a) => send('info', a);
  ASIDZ.warn = (...a) => send('warn', a);
  ASIDZ.error = (...a) => send('error', a);

  ASIDZ.bg = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError;
          resolve(res || null);
        });
      } catch (_) {
        resolve(null);
      }
    });

  /* ---------- timing & cancellation ---------- */
  const CANCELLED = 'Cancelled';
  ASIDZ.CANCELLED = CANCELLED;
  ASIDZ.isCancelErr = (e) => String(e && e.message ? e.message : e).includes(CANCELLED);

  ASIDZ.sleep = (ms, isCancelled, jitter) => {
    const total = jitter ? ms * (0.6 + 0.8 * Math.random()) : ms;
    return new Promise((resolve, reject) => {
      if (!isCancelled) return setTimeout(resolve, total);
      const start = Date.now();
      const iv = setInterval(() => {
        if (isCancelled()) {
          clearInterval(iv);
          reject(new Error(CANCELLED));
          return;
        }
        if (Date.now() - start >= total) {
          clearInterval(iv);
          resolve();
        }
      }, 50);
    });
  };

  const checkCancel = (isCancelled) => {
    if (isCancelled && isCancelled()) throw new Error(CANCELLED);
  };
  ASIDZ.checkCancel = checkCancel;

  /* ---------- async execution mutex ---------- */
  class Mutex {
    constructor() {
      this.p = Promise.resolve();
    }
    run(fn) {
      const next = this.p.then(() => fn());
      this.p = next.catch(() => {});
      return next;
    }
  }
  ASIDZ.uiLock = new Mutex();

  /* ---------- selectors engine ---------- */
  ASIDZ.selectors = Object.assign({}, window.ASIDZ_DEFAULT_SELECTORS || window.AWS_DEFAULT_SELECTORS);

  ASIDZ.loadSelectors = async () => {
    ASIDZ.selectors = Object.assign({}, window.ASIDZ_DEFAULT_SELECTORS || window.AWS_DEFAULT_SELECTORS);
    try {
      const st = await chrome.storage.local.get(['asidz_custom_selectors', 'aws_custom_selectors']);
      const raw = st.asidz_custom_selectors || st.aws_custom_selectors;
      if (raw && String(raw).trim()) {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (obj && typeof obj === 'object') Object.assign(ASIDZ.selectors, obj);
      }
    } catch (_) {
      ASIDZ.warn('Custom selectors JSON is invalid, using defaults');
    }
    return ASIDZ.selectors;
  };

  // split comma-separated selectors respecting parentheses and quotes
  function splitTopLevel(sel) {
    const out = [];
    let depth = 0,
      quote = null,
      cur = '';
    for (const ch of String(sel)) {
      if (quote) {
        cur += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
        continue;
      }
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  ASIDZ.splitSelector = splitTopLevel;

  // Robust jQuery/Sizzle query: evaluates entire list first; falls back to testing parts if needed
  ASIDZ.q = (sel) => {
    if (!sel) return $();
    if (Array.isArray(sel)) sel = sel.join(', ');
    try {
      return $(sel);
    } catch (_) {}
    let res = $();
    for (const part of splitTopLevel(sel)) {
      try {
        res = res.add($(part));
      } catch (_) {}
    }
    return res;
  };

  /* ---------- element readiness ---------- */
  ASIDZ.isUsable = ($el) => {
    if (!$el || $el.length === 0) return false;
    const el = $el[0];
    if (!$el.is(':visible') || $el.is(':disabled')) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };

  ASIDZ.isVisibleEl = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };

  ASIDZ.firstVisible = (sel) => {
    const arr = ASIDZ.q(sel).toArray();
    return arr.find((e) => ASIDZ.isVisibleEl(e)) || null;
  };

  ASIDZ.allVisible = (sel) => ASIDZ.q(sel).toArray().filter((e) => ASIDZ.isVisibleEl(e));

  ASIDZ.waitFor = async (sel, isCancelled, timeout = 5000, interval = 100, needVisible = true) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      checkCancel(isCancelled);
      const $el = ASIDZ.q(sel);
      if (needVisible ? ASIDZ.isUsable($el) || !!ASIDZ.firstVisible(sel) : $el.length > 0) {
        await ASIDZ.sleep(200, isCancelled);
        return $el;
      }
      await ASIDZ.sleep(interval, isCancelled);
    }
    return null;
  };

  ASIDZ.waitUntil = async (fn, isCancelled, timeout = 5000, interval = 150) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      checkCancel(isCancelled);
      let v = null;
      try {
        v = fn();
      } catch (_) {
        v = null;
      }
      if (v) return v;
      await ASIDZ.sleep(interval, isCancelled);
    }
    return null;
  };

  ASIDZ.waitGone = async (sel, isCancelled, timeout = 30000, interval = 200) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      checkCancel(isCancelled);
      if (!ASIDZ.isUsable(ASIDZ.q(sel))) return true;
      await ASIDZ.sleep(interval, isCancelled);
    }
    return false;
  };

  /* ---------- Chrome Debugger (CDP trusted inputs) ---------- */
  ASIDZ.attachDebugger = () => ASIDZ.bg({ type: 'DBG_ATTACH' });
  ASIDZ.detachDebugger = () => ASIDZ.bg({ type: 'DBG_DETACH' });
  ASIDZ.typeText = async (text) => {
    if (!text) return true;
    const r = await ASIDZ.bg({ type: 'DBG_INSERT_TEXT', text });
    return !!(r && r.success);
  };

  ASIDZ.pressKey = async (key, code, keyCode, modifiers) => {
    let text;
    let mods = modifiers;
    if (key === '@') {
      text = '@';
      if (mods === undefined) mods = 8;
    }
    const r = await ASIDZ.bg({ type: 'DBG_KEY', key, code, keyCode, text, modifiers: mods });
    return !!(r && r.success);
  };

  ASIDZ.pressEscape = () => ASIDZ.pressKey('Escape', 'Escape', 27);
  ASIDZ.pressBackspace = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      await ASIDZ.pressKey('Backspace', 'Backspace', 8);
      await ASIDZ.sleep(25);
    }
  };

  async function clickAtElement(kind, el, isCancelled, xRatio) {
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (_) {}
    const r = el.getBoundingClientRect();
    const ratio = xRatio != null ? xRatio : kind === 'click' ? 0.25 : 0.5;
    const x = Math.round(r.left + r.width * ratio);
    const y = Math.round(r.top + r.height / 2);
    const res = await ASIDZ.bg({ type: kind === 'click' ? 'DBG_CLICK' : 'DBG_HOVER', x, y });
    if (!res || !res.success) {
      if (kind === 'click') {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.click();
      } else {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      }
    }
    await ASIDZ.sleep(300, isCancelled);
  }

  async function pointerAction(kind, sel, label, isCancelled, timeout = 5000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      checkCancel(isCancelled);
      await ASIDZ.sleep(interval, isCancelled);
      const $el = ASIDZ.q(sel);
      let el = null;
      if (ASIDZ.isUsable($el)) el = $el.get(0);
      else {
        const vis = $el.toArray().find((e) => ASIDZ.isVisibleEl(e) && !e.disabled);
        if (vis) el = vis;
      }
      if (el) {
        await clickAtElement(kind, el, isCancelled);
        return true;
      }
    }
    checkCancel(isCancelled);
    throw new Error(
      ASIDZ.q(sel).length === 0
        ? `${label} - element not found (${timeout}ms)`
        : `${label} - element found but not visible/ready (${timeout}ms)`
    );
  }

  ASIDZ.click = (sel, label = 'Element', isCancelled, timeout, interval) =>
    pointerAction('click', sel, label, isCancelled, timeout, interval);

  ASIDZ.hover = (sel, label = 'Element', isCancelled, timeout, interval) =>
    pointerAction('hover', sel, label, isCancelled, timeout, interval);

  ASIDZ.clickIfPresent = async (sel, label, isCancelled) => {
    if (ASIDZ.q(sel).length > 0) {
      try {
        await ASIDZ.click(sel, label, isCancelled, 2500);
        return true;
      } catch (e) {
        if (ASIDZ.isCancelErr(e)) throw e;
        ASIDZ.warn(`${label}: ${e.message}`);
        return false;
      }
    }
    return false;
  };

  ASIDZ.clickEl = async (el, label = 'Element', isCancelled, xRatio) => {
    if (!el || !ASIDZ.isVisibleEl(el)) throw new Error(`${label} - element not visible`);
    await clickAtElement('click', el, isCancelled, xRatio);
    return true;
  };

  ASIDZ.hoverEl = async (el, label = 'Element', isCancelled) => {
    if (!el || !el.isConnected) throw new Error(`${label} - element not found`);
    await clickAtElement('hover', el, isCancelled, 0.5);
    return true;
  };

  /* ---------- text / icon based component finding ---------- */
  ASIDZ.CLICKABLE =
    'button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], mat-list-item, mat-option, mat-radio-button, mat-slide-toggle, mat-chip, mat-chip-option, flow-menu-item, li, label';

  ASIDZ.norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const ICON_SEL =
    'mat-icon, i, .material-icons, .material-symbols-outlined, .material-symbols-rounded, .google-symbols, span';

  ASIDZ.iconNames = (el) => {
    const set = new Set();
    if (!el) return set;
    const nodes = [el, ...el.querySelectorAll(ICON_SEL)];
    for (const n of nodes) {
      if (n.children && n.children.length) continue;
      const t = (n.textContent || '').trim();
      if (/^[a-z][a-z0-9_]{1,40}$/.test(t)) set.add(t);
    }
    return set;
  };

  ASIDZ.elText = (el) => {
    if (!el) return '';
    const parts = [
      el.innerText || el.textContent || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.getAttribute('data-tooltip') || '',
      el.getAttribute('mattooltip') || ''
    ];
    const img = el.tagName === 'IMG' ? el : null;
    if (img && img.alt) parts.push(img.alt);
    return ASIDZ.norm(parts.join(' '));
  };

  const toRegexList = (x) =>
    (x == null ? [] : Array.isArray(x) ? x : [x]).map((r) =>
      r instanceof RegExp ? r : new RegExp(`\\b${String(r).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i')
    );

  ASIDZ.findClickable = (opts = {}) => {
    const roots = opts.within ? (Array.isArray(opts.within) ? opts.within : [opts.within]) : [document];
    const textRes = toRegexList(opts.text);
    const exRes = toRegexList(opts.exclude);
    const icons = new Set(opts.icons || []);
    const exIcons = new Set(opts.excludeIcons || []);
    const sel = opts.selector || ASIDZ.CLICKABLE;
    let best = null,
      bestScore = 0;
    const seen = new Set();
    for (const root of roots) {
      if (!root) continue;
      const list = root.querySelectorAll ? root.querySelectorAll(sel) : [];
      for (const el of list) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (!ASIDZ.isVisibleEl(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const txt = ASIDZ.elText(el);
        const ic = ASIDZ.iconNames(el);
        if (exRes.some((r) => r.test(txt))) continue;
        if ([...ic].some((n) => exIcons.has(n))) continue;
        let score = 0;
        if (textRes.length && textRes.some((r) => r.test(txt))) score += 10;
        if (icons.size && [...ic].some((n) => icons.has(n))) score += 8;
        if (!score) continue;
        score += Math.max(0, 5 - Math.floor(txt.length / 25));
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
    }
    return bestScore >= (opts.minScore || 1) ? best : null;
  };

  ASIDZ.waitClickable = (opts, isCancelled, timeout = 4000) =>
    ASIDZ.waitUntil(() => ASIDZ.findClickable(opts), isCancelled, timeout);

  /* ---------- name scoring & item matching ---------- */
  ASIDZ.nameScore = (candidate, name) => {
    const c = ASIDZ.norm(candidate).replace(/^@+/, '');
    const n = ASIDZ.norm(name).replace(/^@+/, '');
    if (!c || !n) return 0;
    if (c === n) return 100;
    const firstLine = c.split('\n')[0].trim();
    if (firstLine === n) return 90;
    if (c.startsWith(n + ' ') || firstLine.startsWith(n + ' ')) return 60;
    const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(c)) return 40;
    return 0;
  };

  ASIDZ.findItemByName = (roots, name, opts = {}) => {
    const list = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
    const clickableSel =
      opts.clickable ||
      '[role="option"], [role="menuitem"], [role="button"], button, mat-list-item, mat-option, li, flow-menu-item, [tabindex]';
    const avoidIcons = new Set(
      opts.avoidIcons || [
        'play_arrow',
        'play_circle',
        'pause',
        'volume_up',
        'more_vert',
        'close',
        'delete',
        'edit',
        'search'
      ]
    );
    let best = null,
      bestScore = 0,
      bestLen = 1e9;
    for (const root of list) {
      const nodes = root.querySelectorAll('*');
      for (const el of nodes) {
        if (!ASIDZ.isVisibleEl(el)) continue;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) continue;
        let txt = '';
        if (el.tagName === 'IMG') txt = el.alt || el.title || '';
        else {
          const own = el.children.length === 0 ? el.textContent || '' : '';
          txt = own || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        }
        const sc = ASIDZ.nameScore(txt, name);
        if (!sc) continue;
        const len = ASIDZ.norm(txt).length;
        if (sc > bestScore || (sc === bestScore && len < bestLen)) {
          best = el;
          bestScore = sc;
          bestLen = len;
        }
      }
    }
    if (!best || bestScore < (opts.minScore || 40)) return null;
    let target = best.closest(clickableSel) || best;
    if (
      target &&
      avoidIcons.size &&
      [...ASIDZ.iconNames(target)].some((n) => avoidIcons.has(n)) &&
      target.tagName === 'BUTTON'
    )
      target = best;
    return { el: target, label: best, score: bestScore };
  };

  /* ---------- prompt editor caret & text helpers ---------- */
  ASIDZ.caretToEnd = (el) => {
    if (!el) return false;
    try {
      el.focus({ preventScroll: true });
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const n = el.value.length;
        el.setSelectionRange(n, n);
        return true;
      }
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return true;
    } catch (_) {
      return false;
    }
  };

  ASIDZ.editorText = (el) =>
    (el ? (el.tagName === 'TEXTAREA' ? el.value : el.innerText || el.textContent || '') : '').replace(
      /\u00a0/g,
      ' '
    );

  /* ---------- settings cache (avoids redundant popover clicks) ---------- */
  const TTL = 300000;
  const cache = new Map();

  ASIDZ.settingsChanged = (pairs, commit = false) => {
    const changed = pairs.some(([k, v]) => {
      const c = cache.get(k);
      if (!c || Date.now() > c.exp) return true;
      if (commit) c.exp = Date.now() + TTL;
      return JSON.stringify(c.v) !== JSON.stringify(v);
    });
    if (changed && commit) pairs.forEach(([k, v]) => cache.set(k, { v, exp: Date.now() + TTL }));
    return changed;
  };

  ASIDZ.resetSettingsCache = () => cache.clear();
  ASIDZ.forgetSetting = (k) => cache.delete(k);

  /* ---------- prompt matching for @characters & images ---------- */
  const esc = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

  function findMatches(text, names, key) {
    const found = [];
    if (!text || !names || !names.length) return found;
    names.forEach((rawName, idx) => {
      const name = String(rawName || '')
        .replace(/^@+/, '')
        .trim();
      if (!name) return;
      const word = /^\w/.test(name) && /\w$/.test(name);
      const re = new RegExp(word ? `(@?)(?<![\\w])${esc(name)}(?![\\w])` : `(@?)${esc(name)}`, 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        const hasAt = m[1] === '@';
        found.push({ index: m.index, length: m[0].length, hasAt, nameLength: name.length, [key]: idx });
        if (m[0].length === 0) re.lastIndex++;
      }
    });
    found.sort((a, b) => a.index - b.index || b.length - a.length);
    const out = [];
    let end = 0;
    for (const f of found)
      if (f.index >= end) {
        out.push(f);
        end = f.index + f.length;
      }
    return out;
  }

  ASIDZ.stripExt = (n) => String(n || '').replace(/\.[^/.]+$/, '');
  ASIDZ.cleanCharName = (n) =>
    String(n || '')
      .replace(/^@+/, '')
      .trim();

  const atOnly = (list) => list.filter((m) => m.hasAt);
  ASIDZ.imageMatches = (text, images) =>
    atOnly(findMatches(text, (images || []).map((i) => ASIDZ.stripExt(i && i.name)), 'imageIndex'));
  ASIDZ.characterMatches = (text, chars) =>
    atOnly(findMatches(text, (chars || []).map(ASIDZ.cleanCharName), 'characterIndex'));

  /* ---------- video last frame extractor ---------- */
  ASIDZ.extractLastFrame = (videos) => {
    if (!videos || !videos.length) return Promise.resolve(null);
    const src = videos[videos.length - 1].currentSrc || videos[videos.length - 1].src;
    if (!src) return Promise.resolve(null);
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.preload = 'auto';
      v.muted = true;
      const done = (val) => {
        clearTimeout(t);
        resolve(val);
      };
      const t = setTimeout(() => done(null), 30000);
      v.addEventListener('loadedmetadata', () => {
        v.currentTime = Math.max(0, v.duration - 0.05);
      });
      v.addEventListener('seeked', () => {
        try {
          const c = document.createElement('canvas');
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          done(c.toDataURL('image/jpeg', 0.95));
        } catch (e) {
          ASIDZ.warn('Could not read last frame:', e);
          done(null);
        }
      });
      v.addEventListener('error', () => done(null));
      v.src = src;
      v.load();
    });
  };

  /* ---------- misc utilities ---------- */
  ASIDZ.isFlowPage = (u) => {
    const url = u || window.location.href;
    return url.includes('flow.google.com') || url.includes('labs.google/fx');
  };

  ASIDZ.blobToDataUrl = async (url) => {
    const blob = await (await fetch(url)).blob();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  };

  ASIDZ.urlToDataUrl = async (url) => {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    try {
      return await ASIDZ.blobToDataUrl(url);
    } catch (_) {}
    const r = await ASIDZ.bg({ type: 'FETCH_AS_DATAURL', url });
    return r && r.success ? r.dataUrl : null;
  };
})();
