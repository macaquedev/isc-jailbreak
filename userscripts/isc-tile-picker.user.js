// ==UserScript==
// @name         ISC Jailbreak
// @namespace    https://isc.ro/
// @version      1.0.0
// @description  Prompt for desired tiles and draw those from the bag instead of random
// @match        *://*.isc.ro/*
// @match        *://isc.ro/*
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at      document-start
// @author       Alex Pylypenko
// ==/UserScript==

(function () {
  'use strict';

  const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // Global desired queue (from banner input), applied to new bags
  let globalDesiredQueue = [];
  // Incremented every time user clicks Apply/Clear to force reseed for all bags
  let globalInputEpoch = 0;

  // Per-bag queues, so a given bag carries its own remaining desired tiles
  const desiredByBag = new WeakMap();
  const lastTextByBag = new WeakMap();
  const epochByBag = new WeakMap();
  const activeRefillBags = new WeakSet();

  // Per-window banner elements
  const bannerByWindow = new WeakMap();
  const STORAGE_KEY_TEXT = 'isc_tile_picker_text';

  // Normalize user input (e.g., 'AEIOU??') → array of char codes
  function parseDesired(input) {
    if (!input) return [];
    const s = String(input).toUpperCase().replace(/[^A-Z?]/g, '');
    const codes = [];
    for (let i = 0; i < s.length; i++) {
      codes.push(s.charCodeAt(i)); // '?' is 63 (blank as used by the app)
    }
    return codes;
  }

  function ensureBanner(win) {
    try {
      if (bannerByWindow.has(win)) return bannerByWindow.get(win);
      const doc = win.document;
      const root = doc.createElement('div');
      root.id = 'isc-tile-picker-banner';
      root.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;'+
        'background:rgba(0,0,0,0.8);color:#fff;font:14px/1.2 sans-serif;'+
        'display:flex;gap:8px;align-items:center;justify-content:flex-end;'+
        'padding:6px 10px;box-shadow:0 2px 6px rgba(0,0,0,0.4);';
      const label = doc.createElement('span');
      label.textContent = 'Desired tiles:';
      const input = doc.createElement('input');
      input.type = 'text';
      input.placeholder = 'e.g., RETINAS??';
      input.style.cssText = 'padding:4px 6px;border-radius:3px;border:1px solid #666;background:#111;color:#fff;min-width:220px;';
      const applyBtn = doc.createElement('button');
      applyBtn.textContent = 'Apply';
      applyBtn.style.cssText = 'padding:4px 10px;border-radius:3px;border:1px solid #888;background:#2f7;color:#000;cursor:pointer;';
      const clearBtn = doc.createElement('button');
      clearBtn.textContent = 'Clear';
      clearBtn.style.cssText = 'padding:4px 10px;border-radius:3px;border:1px solid #888;background:#f55;color:#000;cursor:pointer;';
      const hint = doc.createElement('span');
      hint.textContent = 'Next refill/exchange: short input = partial rack; missing tiles conjured';
      hint.style.cssText = 'opacity:0.7;font-size:12px;';
      root.append(label, input, applyBtn, clearBtn, hint);

      const mount = () => {
        if (!doc.body) return false;
        if (!doc.body.contains(root)) doc.body.appendChild(root);
        return true;
      };
      if (!mount()) {
        const mo = new win.MutationObserver(() => { if (mount()) mo.disconnect(); });
        mo.observe(doc.documentElement || doc, { childList: true, subtree: true });
      }

      const apply = () => {
        const text = String(input.value || '');
        const desired = parseDesired(text);
        globalDesiredQueue = desired.slice();
        try { if (typeof GM_setValue === 'function') GM_setValue(STORAGE_KEY_TEXT, text); } catch(_) {}
        // No alert; subtle visual cue
        root.style.background = 'rgba(20,80,20,0.9)';
        setTimeout(() => { root.style.background = 'rgba(0,0,0,0.8)'; }, 300);
        // Force reseed on next draw/refill in all frames
        globalInputEpoch++;
      };
      const clear = () => {
        input.value = '';
        globalDesiredQueue = [];
        try { if (typeof GM_setValue === 'function') GM_setValue(STORAGE_KEY_TEXT, ''); } catch(_) {}
        root.style.background = 'rgba(80,20,20,0.9)';
        setTimeout(() => { root.style.background = 'rgba(0,0,0,0.8)'; }, 300);
        globalInputEpoch++;
      };
      applyBtn.addEventListener('click', apply);
      clearBtn.addEventListener('click', clear);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });

      // Prefill from storage
      try {
        if (typeof GM_getValue === 'function') {
          const saved = GM_getValue(STORAGE_KEY_TEXT, '');
          if (saved && typeof saved === 'string') {
            input.value = saved;
            globalDesiredQueue = parseDesired(saved);
          }
        }
      } catch(_) {}

      const banner = { root, input, apply, clear };
      bannerByWindow.set(win, banner);
      return banner;
    } catch (e) { return null; }
  }

  function getDesiredFromBanner(win) {
    try {
      // Always use the last applied input, not live edits
      return globalDesiredQueue.slice();
    } catch (_) {
      return globalDesiredQueue.slice();
    }
  }

  function getBannerText(win) {
    try {
      const b = ensureBanner(win);
      const local = b && b.input ? String(b.input.value) : '';
      if (local && local.length > 0) return local;
      if (win !== w) {
        try {
          const tb = ensureBanner(w);
          const topLocal = tb && tb.input ? String(tb.input.value) : '';
          if (topLocal && topLocal.length > 0) return topLocal;
        } catch (_) {}
      }
      return '';
    } catch (_) { return ''; }
  }

  // Provide a menu item to change desired tiles at any time
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Focus tile banner', () => {
      const b = ensureBanner(w);
      if (b && b.input) { b.input.focus(); b.input.select(); }
    });
  }

  function derivePropsFromDraw(fn) {
    try {
      const s = Function.prototype.toString.call(fn);
      // return Wrap(bag.array[index].charProp)
      const retRe = /return\s+([A-Za-z_$][\w$]*)\(\s*([A-Za-z_$][\w$]*)\.(\w+)\s*\[\s*([A-Za-z_$][\w$]*)\s*\]\s*\.\s*([A-Za-z_$][\w$]*)\s*\)/;
      const m = s.match(retRe);
      if (!m) return null;
      const wrapperName = m[1];
      const bagVar = m[2];
      const arrayProp = m[3];
      const indexVar = m[4];
      const charProp = m[5];
      const out = { wrapperName, arrayProp, charProp };
      // Try to discover total and count props; tolerate failure
      try {
        const bagEsc = bagVar.replace(/[$]/g, '\\$&');
        const totalRe1 = new RegExp(bagEsc + "\\.(\\w+)\\s*==\\s*0");
        const totalRe2 = new RegExp("0\\s*==\\s*" + bagEsc + "\\.(\\w+)");
        const mt = s.match(totalRe1) || s.match(totalRe2);
        if (mt) out.totalProp = mt[1];
        const countRe1 = new RegExp("--\\s*" + bagEsc + "\\." + arrayProp + "\\\\[" + indexVar + "\\\\]\\.([A-Za-z_$][\\w$]*)");
        const countRe2 = new RegExp(bagEsc + "\\." + arrayProp + "\\\\[" + indexVar + "\\\\]\\.([A-Za-z_$][\\w$]*)\\s*--");
        const mc = s.match(countRe1) || s.match(countRe2);
        if (mc) out.countProp = mc[1];
      } catch (_) {}
      return out;
    } catch (e) { return null; }
  }

  // Compute a sequence of Math.random() values to force-draw desired codes
  function computeFractionsForDesired(bag, desiredCodes, props, maxDraws) {
    try {
      if (!props || !props.arrayProp || !props.countProp || !props.charProp || !props.totalProp) return [];
      const list = bag[props.arrayProp];
      // Make a shallow copy of counts and total
      const counts = list.map(e => e[props.countProp] | 0);
      let total = bag[props.totalProp] | 0;
      const codes = list.map(e => e[props.charProp]);
      const fractions = [];
      let draws = 0;
      for (let k = 0; k < desiredCodes.length; k++) {
        if (maxDraws != null && draws >= maxDraws) break;
        const code = desiredCodes[k];
        // locate entry
        let idx = -1;
        for (let i = 0; i < codes.length; i++) {
          if (codes[i] === code && counts[i] > 0) { idx = i; break; }
        }
        if (idx === -1 || total <= 0) continue;
        // cumulative up to previous index
        let cumPrev = 0;
        for (let i = 0; i < idx; i++) cumPrev += counts[i];
        const targetIndex = cumPrev; // choose first occurrence
        const frac = (targetIndex + 0.00001) / total;
        fractions.push(frac);
        // simulate removal
        counts[idx]--;
        total--;
        draws++;
      }
      return fractions;
    } catch (_) { return []; }
  }

  function withRandomSequence(win, fractions, fn) {
    if (!fractions || fractions.length === 0) return fn();
    const originalRandom = win.Math.random;
    let i = 0;
    try {
      win.Math.random = function () {
        if (i < fractions.length) return fractions[i++];
        return originalRandom();
      };
      return fn();
    } finally {
      win.Math.random = originalRandom;
    }
  }

  function hookWindow(win) {
    try {
      if (!win || typeof win !== 'object') return false;
      if (win.__ISC_TILE_PICKER_HOOKED__) return true;
      const drawRandom = win.W7;
      let takeSpecific = win.V7;
      if (typeof drawRandom !== 'function') return false;

      const origW7 = drawRandom;
      // Try to derive property names from drawRandom's source so we can take a specific tile even if V7 doesn't exist
      const props = derivePropsFromDraw(drawRandom);
      if (typeof takeSpecific !== 'function' && props && typeof win[props.wrapperName] === 'function') {
        takeSpecific = function (bag, code) {
          try {
            const list = bag[props.arrayProp];
            for (let i = 0; i < list.length; i++) {
              if (list[i][props.charProp] === code && list[i][props.countProp] > 0) {
                list[i][props.countProp]--;
                bag[props.totalProp]--;
                return win[props.wrapperName](code);
              }
            }
            return null;
          } catch (e) {
            return null;
          }
        };
      }
      win.W7 = function (bag) {
        try {
          // If we're actively refilling and have no desired tiles left, block draws by returning null
          if (activeRefillBags.has(bag)) {
            const q = desiredByBag.get(bag) || [];
            if (!q || q.length === 0) return null;
          }
          // Reseed per bag when user has applied new input
          const bagEpoch = epochByBag.get(bag) | 0;
          if (bagEpoch !== globalInputEpoch || !desiredByBag.has(bag)) {
            desiredByBag.set(bag, getDesiredFromBanner(win));
            epochByBag.set(bag, globalInputEpoch);
            lastTextByBag.set(bag, getBannerText(win));
          }
          const queue = desiredByBag.get(bag) || [];
          if (queue.length > 0) {
            // Pull one desired code for this draw
            const code = queue.shift();
            desiredByBag.set(bag, queue);

            // Preferred: use game-provided or synthesized takeSpecific that updates bag counts
            if (typeof takeSpecific === 'function') {
              const picked = takeSpecific(bag, code);
              if (picked) return picked;
            }

            // If we could not update counts via takeSpecific, conjure via wrapper if available.
            if (props && typeof win[props.wrapperName] === 'function') {
              try {
                if (props.arrayProp && props.countProp && props.charProp) {
                  const list = bag[props.arrayProp];
                  // Try to decrement only if the desired tile exists; otherwise, just conjure
                  for (let i = 0; i < list.length; i++) {
                    if (list[i][props.charProp] === code && list[i][props.countProp] > 0) {
                      list[i][props.countProp]--;
                      if (bag[props.totalProp] > 0) bag[props.totalProp]--;
                      break;
                    }
                  }
                }
                // return desired tile regardless (conjure if absent)
                return win[props.wrapperName](code);
              } catch (_) {
                // ignore and let fallback run
              }
            }

            // As a last resort, if we can't touch counts or use wrapper, fall back to original random
            return origW7(bag);
          }

          // No desired queue → random
          return origW7(bag);
        } catch (e) {
          try { return origW7(bag); } catch (_) {}
          return null;
        }
      };
      win.__ISC_TILE_PICKER_HOOKED__ = true;
      console.log('[ISC Tile Picker] Hooked W7 in window', win.location && win.location.href);

      // Hook rack-replenish: prompt every time before filling the rack (covers post-move and exchanges)
      const origR7 = win.R7;
      if (typeof origR7 === 'function' && !win.__ISC_TILE_PICKER_R7__) {
        win.R7 = function (bag /*, rack */) {
          try {
            const desired = getDesiredFromBanner(win);
            desiredByBag.set(bag, desired);
            epochByBag.set(bag, globalInputEpoch);
            lastTextByBag.set(bag, getBannerText(win));
            // If user requested empty rack, proactively clear rack object if provided
            if ((!desired || desired.length === 0) && arguments[1]) {
              try {
                const rack = arguments[1];
                const size = rack && (rack.DeckLayoutPanel | 0);
                if (size && size > 0) {
                  const codes = rack.Collections_UnmodifiableSet;
                  const flags = rack.MenuBar;
                  const idxMap = rack.d;
                  const emptyCode = (typeof win.zsb !== 'undefined') ? win.zsb : 0;
                  for (let i = 0; i < size; i++) {
                    if (codes && codes.length > i) codes[i] = emptyCode;
                    if (idxMap && idxMap.length > i) idxMap[i] = -1;
                    if (flags && flags.length > i) flags[i] = 0;
                  }
                }
              } catch (_) {}
            }
            // Guide W7 by overriding Math.random for the duration of this refill
            const fractions = computeFractionsForDesired(bag, desired, props, desired.length);
            activeRefillBags.add(bag);
            const result = withRandomSequence(win, fractions, () => origR7.apply(this, arguments));
            activeRefillBags.delete(bag);
            return result;
          } catch(_e) {}
          return origR7.apply(this, arguments);
        };
        win.__ISC_TILE_PICKER_R7__ = true;
        console.log('[ISC Tile Picker] Hooked R7 (replenish) in window');
      }

      // Hook $6 (common refill function) to prompt just-in-time as well
      const orig$6 = win.$6;
      if (typeof orig$6 === 'function' && !win.__ISC_TILE_PICKER_$6__) {
        win.$6 = function (rackCtx, bag /*, valueString, playerIndex */) {
          try {
            if (bag && typeof bag === 'object') {
              // Seed or reuse the per-bag desired queue for this epoch
              let queue = desiredByBag.get(bag);
              const bagEpoch = epochByBag.get(bag) | 0;
              if (!queue || bagEpoch !== globalInputEpoch) {
                const desired = getDesiredFromBanner(win);
                desiredByBag.set(bag, desired.slice());
                epochByBag.set(bag, globalInputEpoch);
                lastTextByBag.set(bag, getBannerText(win));
                queue = desiredByBag.get(bag) || [];
              }
              // Build explicit rack string from desired queue; empty string → empty rack
              const overrideStr = (queue && queue.length)
                ? String.fromCharCode.apply(null, queue)
                : '';
              arguments[2] = overrideStr;
              const fractions = computeFractionsForDesired(bag, queue, props, queue ? queue.length : 0);
              activeRefillBags.add(bag);
              const result = withRandomSequence(win, fractions, () => orig$6.apply(this, arguments));
              activeRefillBags.delete(bag);
              return result;
            }
          } catch(_e) {}
          return orig$6.apply(this, arguments);
        };
        win.__ISC_TILE_PICKER_$6__ = true;
        console.log('[ISC Tile Picker] Hooked $6 (refill helper) in window');
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function hookAllFrames() {
    let hooked = hookWindow(w);
    // Try to hook same-origin iframes
    const frames = document.querySelectorAll('iframe');
    frames.forEach((ifr) => {
      try {
        const cw = ifr.contentWindow;
        if (cw && cw.location && cw.location.origin === window.location.origin) {
          ensureBanner(cw);
          if (hookWindow(cw)) hooked = true;
        }
      } catch (e) {
        // cross-origin, ignore
      }
    });
    return hooked;
  }

  // Repeatedly try to hook for a while; also watch for dynamic iframes
  function startHooking() {
    // Ensure banner before first turn and focus input
    const topBanner = ensureBanner(w);
    if (topBanner && topBanner.input) {
      try { topBanner.input.focus(); topBanner.input.select(); } catch(_) {}
    }
    const start = Date.now();
    const interval = setInterval(() => {
      const ok = hookAllFrames();
      if (ok || Date.now() - start > 60000) {
        clearInterval(interval);
      }
    }, 400);

    const mo = new MutationObserver(() => hookAllFrames());
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Force re-hook', () => {
      hookAllFrames();
      alert('Attempted to re-hook draw function in all same-origin frames.');
    });
  }

  startHooking();
})();

