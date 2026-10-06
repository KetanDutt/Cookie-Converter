/**
 * Gemini Cookie Converter — UI primitives.
 * ============================================================================
 * Small, dependency-free building blocks used by `app.js` to compose the
 * interface. Everything here is presentation and interaction only: no cookie
 * data ever flows through this file, and no primitive makes a network request.
 *
 * Exposed as `window.UI`:
 *
 *   UI.icon(name, className?)            → SVG element referencing the sprite
 *   UI.toast.show(message, kind, opts?)  → floating glass notification
 *   UI.popover({trigger, panel})         → anchored popover / mobile sheet
 *   UI.dialog({dialog, triggers})        → native <dialog> with animated
 *                                          enter/exit and focus return
 *   UI.tabs({container})                 → gliding-tab control (ARIA pattern)
 *   UI.reveal(selector)                  → one-shot scroll reveal
 *   UI.shine(root)                       → pointer-tracking button highlight
 *   UI.animateNumber(el, to, opts?)      → counter transitions
 *
 * Design rules honoured here:
 *   • Every animation is `transform`/`opacity` (GPU friendly) — never layout.
 *   • Core Web Vitals stay untouched: no layout thrash in scroll handlers,
 *     listeners are passive, and heavy work is deferred to rAF.
 *   • `prefers-reduced-motion` shortens or removes motion, never behaviour.
 *   • Accessible names, `aria-expanded`, roving tabindex and focus return are
 *     handled by the primitives so the app cannot forget them.
 */
(function (root) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TOAST_LIMIT = 3;
  const TOAST_EXIT_MS = 280;
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])';

  /* ------------------------------------------------------------------ *
   * Environment helpers
   * ------------------------------------------------------------------ */

  function matches(query) {
    return Boolean(root.matchMedia && root.matchMedia(query).matches);
  }

  function reducedMotion() {
    return matches('(prefers-reduced-motion: reduce)');
  }

  function hoverCapable() {
    return matches('(hover: hover) and (pointer: fine)');
  }

  function after(ms, fn) {
    return root.setTimeout(fn, ms);
  }

  function nextFrame(fn) {
    const schedule = root.requestAnimationFrame || ((callback) => after(16, callback));
    return schedule(fn);
  }

  /* ------------------------------------------------------------------ *
   * Icons
   * ------------------------------------------------------------------ */

  /**
   * Build an SVG icon from the inline sprite in `index.html`.
   * Uses `createElementNS` so no markup is ever parsed from a string.
   *
   * @param {string} name sprite symbol name without the `i-` prefix
   * @param {string} [className] extra classes (e.g. `icon-14`)
   * @returns {SVGElement}
   */
  function icon(name, className) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className ? 'icon ' + className : 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  /** Replace an element's children with a single icon. */
  function setIcon(node, name, className) {
    if (!node) return null;
    node.textContent = '';
    const svg = icon(name, className);
    node.appendChild(svg);
    return svg;
  }

  /* ------------------------------------------------------------------ *
   * Toasts
   * ------------------------------------------------------------------ */

  const toastStack = { element: null };

  function dismissToast(toast) {
    if (!toast || toast.dataset.leaving) return;
    toast.dataset.leaving = '1';
    toast.classList.add('toast-out');
    after(TOAST_EXIT_MS, () => toast.remove());
  }

  /**
   * Show a floating glass notification.
   * @param {string} message
   * @param {'ok'|'info'|'err'} [kind]
   * @param {{action?: {label: string, onAction: Function}, duration?: number,
   *          icon?: string}} [options]
   */
  function showToast(message, kind, options) {
    const stack = toastStack.element || document.getElementById('toasts');
    if (!stack) return null;
    toastStack.element = stack;

    const opts = options || {};
    const type = kind || 'info';

    // Never stack the same message twice: refresh it instead.
    const last = stack.lastElementChild;
    if (last && last.dataset.message === message) {
      last.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast glass-lg toast-' + type;
    toast.setAttribute('role', 'status');
    toast.dataset.message = message;

    const iconSlot = document.createElement('span');
    iconSlot.className = 'toast-icon';
    const glyph = icon(opts.icon || (type === 'ok' ? 'check' : type === 'err' ? 'alert' : 'info'));
    glyph.setAttribute('class', 'icon icon-14');
    iconSlot.appendChild(glyph);

    const body = document.createElement('span');
    body.className = 'toast-message';
    body.textContent = message;

    toast.appendChild(iconSlot);
    toast.appendChild(body);

    if (opts.action) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'toast-action';
      action.textContent = opts.action.label;
      action.addEventListener('click', (event) => {
        event.stopPropagation();
        dismissToast(toast);
        opts.action.onAction();
      });
      toast.appendChild(action);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.appendChild(icon('close'));
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      dismissToast(toast);
    });
    toast.appendChild(close);

    toast.addEventListener('click', () => dismissToast(toast));
    stack.appendChild(toast);

    // Overflow: drop the oldest outright — re-dismissing a toast that is
    // already animating out would never shrink the stack.
    let overflow = stack.children.length - TOAST_LIMIT;
    while (overflow-- > 0) {
      const oldest = stack.firstElementChild;
      if (!oldest) break;
      oldest.remove();
    }

    const duration = typeof opts.duration === 'number' ? opts.duration : (opts.action ? 7000 : 3600);
    let timer = after(duration, () => dismissToast(toast));
    toast.addEventListener('mouseenter', () => root.clearTimeout(timer));
    toast.addEventListener('mouseleave', () => {
      timer = after(1200, () => dismissToast(toast));
    });
    return toast;
  }

  function dismissAllToasts() {
    const stack = toastStack.element || document.getElementById('toasts');
    if (!stack) return;
    Array.prototype.slice.call(stack.children).forEach(dismissToast);
  }

  /* ------------------------------------------------------------------ *
   * Popover (anchored on desktop, bottom sheet on mobile)
   * ------------------------------------------------------------------ */

  const SHEET_QUERY = '(max-width: 720px), (max-height: 560px)';

  /**
   * @param {{trigger: HTMLElement, panel: HTMLElement, onOpen?: Function,
   *          onClose?: Function}} config
   */
  function createPopover(config) {
    const panel = config.panel;
    const triggers = (config.triggers || [config.trigger]).filter(Boolean);
    if (!triggers.length || !panel) return null;

    let isOpen = false;
    let anchor = triggers[0]; // the trigger the panel is currently attached to

    function place() {
      if (matches(SHEET_QUERY)) {
        panel.classList.add('is-sheet');
        panel.style.removeProperty('--pop-x');
        panel.style.removeProperty('--pop-y');
        return;
      }
      panel.classList.remove('is-sheet');
      const triggerRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const margin = 12;
      let left = triggerRect.right - panelRect.width;
      left = Math.max(margin, Math.min(left, root.innerWidth - panelRect.width - margin));
      let top = triggerRect.bottom + 10;
      if (top + panelRect.height > root.innerHeight - margin) {
        top = Math.max(margin, triggerRect.top - panelRect.height - 10);
        panel.classList.add('is-above');
      } else {
        panel.classList.remove('is-above');
      }
      panel.style.setProperty('--pop-x', Math.round(left) + 'px');
      panel.style.setProperty('--pop-y', Math.round(top) + 'px');
    }

    function inTrigger(node) {
      return triggers.some((item) => item.contains(node));
    }

    function setOpen(next, focusPanel, source) {
      if (next === isOpen) return;
      isOpen = next;
      if (source) anchor = source;
      for (const item of triggers) item.setAttribute('aria-expanded', String(next));
      if (next) {
        panel.hidden = false;
        panel.classList.add('is-open');
        place();
        if (config.onOpen) config.onOpen();
        if (focusPanel) {
          const focusable = panel.querySelector(FOCUSABLE);
          if (focusable && focusable.focus) focusable.focus();
        }
      } else {
        panel.classList.remove('is-open');
        panel.classList.add('is-closing');
        after(reducedMotion() ? 0 : 160, () => {
          panel.classList.remove('is-closing');
          if (!isOpen) panel.hidden = true;
        });
        if (config.onClose) config.onClose();
      }
    }

    for (const item of triggers) {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        setOpen(!isOpen, false, item);
      });
    }

    // Any click outside the panel *and* every trigger dismisses it. Clicks on a
    // trigger are ignored here so the button's own handler owns the toggle —
    // otherwise a tap on the mobile bar button would open and instantly re-close.
    document.addEventListener('click', (event) => {
      if (!isOpen) return;
      const target = event.target;
      if (panel.contains(target) || inTrigger(target)) return;
      setOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (!isOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        if (anchor.focus) anchor.focus();
      }
    });

    root.addEventListener('resize', () => {
      if (isOpen) place();
    }, { passive: true });

    root.addEventListener('scroll', () => {
      if (isOpen) place();
    }, { passive: true });

    panel.hidden = true;
    for (const item of triggers) item.setAttribute('aria-expanded', 'false');

    return {
      open() { setOpen(true); },
      close() { setOpen(false); },
      toggle() { setOpen(!isOpen); },
      isOpen() { return isOpen; },
      refresh: place,
    };
  }

  /* ------------------------------------------------------------------ *
   * Dialog (native <dialog>, animated, focus-returning)
   * ------------------------------------------------------------------ */

  function createDialog(config) {
    const dialog = config.dialog;
    if (!dialog) return null;
    const triggers = config.triggers || [];
    let isOpen = false;
    let lastFocus = null;

    function nativeOpen() {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }

    function nativeClose() {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      lastFocus = document.activeElement;
      dialog.classList.remove('is-closing');
      nativeOpen();
      if (config.onOpen) config.onOpen();
      nextFrame(() => {
        const focusable = dialog.querySelector(FOCUSABLE);
        if (focusable && focusable.focus && !dialog.contains(document.activeElement)) focusable.focus();
      });
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      const finish = () => {
        dialog.classList.remove('is-closing');
        nativeClose();
        const target = lastFocus && lastFocus.focus ? lastFocus : null;
        if (target) target.focus();
      };
      if (reducedMotion()) {
        finish();
        return;
      }
      dialog.classList.add('is-closing');
      after(200, finish);
    }

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault(); // animate instead of snapping shut
      close();
    });

    dialog.addEventListener('click', (event) => {
      // Clicking the backdrop (the dialog element itself) dismisses.
      if (event.target === dialog) close();
    });

    triggers.forEach((trigger) => {
      if (trigger) trigger.addEventListener('click', (event) => {
        event.preventDefault();
        open();
      });
    });

    return { open, close, isOpen() { return isOpen; } };
  }

  /* ------------------------------------------------------------------ *
   * Tabs (ARIA tabs pattern with a gliding indicator)
   * ------------------------------------------------------------------ */

  function createTabs(config) {
    const container = config.container;
    if (!container) return null;
    const tabs = Array.prototype.slice.call(container.querySelectorAll('[role="tab"]'));
    const panels = Array.prototype.slice.call(container.querySelectorAll('[role="tabpanel"]'));
    if (!tabs.length) return null;

    container.classList.add('tabs');
    container.style.setProperty('--tab-count', String(tabs.length));

    function select(index, focusTab) {
      const safe = Math.max(0, Math.min(index, tabs.length - 1));
      container.dataset.active = String(safe);
      tabs.forEach((tab, i) => {
        const active = i === safe;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      panels.forEach((panel, i) => {
        panel.hidden = i !== safe;
      });
      if (focusTab && tabs[safe].focus) tabs[safe].focus();
      if (config.onChange) config.onChange(safe);
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(index));
      tab.addEventListener('keydown', (event) => {
        const keys = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
        if (!(event.key in keys)) return;
        event.preventDefault();
        const step = keys[event.key];
        let next = step === -Infinity ? 0 : step === Infinity ? tabs.length - 1 : index + step;
        if (next < 0) next = tabs.length - 1;
        if (next >= tabs.length) next = 0;
        select(next, true);
      });
    });

    select(0);
    return { select, count: tabs.length };
  }

  /* ------------------------------------------------------------------ *
   * Scroll reveal
   * ------------------------------------------------------------------ */

  function reveal(selectorOrNodes, options) {
    const opts = options || {};
    const nodes = typeof selectorOrNodes === 'string'
      ? Array.prototype.slice.call(document.querySelectorAll(selectorOrNodes))
      : Array.prototype.slice.call(selectorOrNodes || []);
    if (!nodes.length) return;

    const showAll = () => nodes.forEach((node) => node.classList.add('is-visible'));
    if (reducedMotion() || typeof root.IntersectionObserver !== 'function') {
      showAll();
      return;
    }

    const observer = new root.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });

    nodes.forEach((node, index) => {
      node.style.setProperty('--reveal-delay', (opts.stagger ? index * opts.stagger : 0) + 'ms');
      observer.observe(node);
    });
  }

  /* ------------------------------------------------------------------ *
   * Pointer-tracking shine for interactive surfaces
   * ------------------------------------------------------------------ */

  const SHINE_SELECTOR = '.btn, .icon-btn, .nav-item, .segmented button, .bar-btn, .chip-btn';

  function shine(scope) {
    if (!hoverCapable() || reducedMotion()) return;
    const host = scope || document;
    let queued = false;
    let pending = null;

    host.addEventListener('pointermove', (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      const surface = target.closest(SHINE_SELECTOR);
      if (!surface) return;
      pending = { surface, x: event.clientX, y: event.clientY };
      if (queued) return;
      queued = true;
      nextFrame(() => {
        queued = false;
        if (!pending) return;
        const rect = pending.surface.getBoundingClientRect();
        if (rect.width && rect.height) {
          pending.surface.style.setProperty('--shine-x', (((pending.x - rect.left) / rect.width) * 100).toFixed(2) + '%');
          pending.surface.style.setProperty('--shine-y', (((pending.y - rect.top) / rect.height) * 100).toFixed(2) + '%');
          pending.surface.classList.add('has-shine');
        }
        pending = null;
      });
    }, { passive: true });

    host.addEventListener('pointerleave', (event) => {
      const target = event.target;
      if (target && target.classList) target.classList.remove('has-shine');
    }, { passive: true, capture: true });
  }

  /* ------------------------------------------------------------------ *
   * Animated counters
   * ------------------------------------------------------------------ */

  function animateNumber(element, to, options) {
    if (!element) return;
    const opts = options || {};
    const from = Number(element.dataset.value || opts.from || 0);
    const duration = reducedMotion() ? 0 : (opts.duration || 420);
    element.dataset.value = String(to);

    if (!duration || from === to) {
      element.textContent = String(to);
      return;
    }

    const started = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
    const step = () => {
      const now = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = String(Math.round(from + (to - from) * eased));
      if (progress < 1) nextFrame(step);
      else element.textContent = String(to);
    };
    nextFrame(step);
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  root.UI = {
    icon,
    setIcon,
    toast: { show: showToast, dismiss: dismissToast, dismissAll: dismissAllToasts },
    popover: createPopover,
    dialog: createDialog,
    tabs: createTabs,
    reveal,
    shine,
    animateNumber,
    reducedMotion,
  };
})(typeof window !== 'undefined' ? window : this);
