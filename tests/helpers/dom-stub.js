/**
 * A tiny, dependency-free DOM stub.
 * ============================================================================
 * The project ships no test dependencies, so instead of pulling in jsdom the
 * UI tests run `assets/app.js` inside a `node:vm` context backed by this
 * minimal implementation: enough DOM to boot the app, drive the real event
 * handlers and assert on the real DOM mutations.
 *
 * It is intentionally small — it implements exactly the surface `app.js`
 * touches, and it reads the element ids straight out of `index.html` so the
 * stub can never drift from the real markup.
 *
 * What is faithful:
 *   • element tree with bubbling dispatch, `closest()`, `querySelector()` for
 *     the selectors the app uses;
 *   • `classList`, `dataset`, attributes, `textContent`, `hidden`, `value`;
 *   • a controllable clock (`setTimeout` never really schedules) so toast and
 *     debounce timers are deterministic and never keep Node alive.
 *
 * What is stubbed: layout, rendering, CSS, real timers, real files.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

const VOID_TAGS = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source']);

/* ------------------------------------------------------------------ *
 * classList
 * ------------------------------------------------------------------ */

function createClassList(node) {
  const parse = () => String(node.className || '').split(/\s+/).filter(Boolean);
  const write = (list) => { node.className = list.join(' '); };
  return {
    add(...names) {
      const list = parse();
      for (const name of names) if (!list.includes(name)) list.push(name);
      write(list);
    },
    remove(...names) {
      write(parse().filter((name) => !names.includes(name)));
    },
    toggle(name, force) {
      const has = parse().includes(name);
      const shouldHave = force === undefined ? !has : Boolean(force);
      if (shouldHave) this.add(name); else this.remove(name);
      return shouldHave;
    },
    contains(name) {
      return parse().includes(name);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Element
 * ------------------------------------------------------------------ */

class StubElement {
  constructor(tagName, document) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = document;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.href = '';
    this.download = '';
    this.type = '';
    this.files = [];
    this.className = '';
    this.textValue = '';
    this.listeners = new Map();
    this.classList = createClassList(this);
  }

  /* —— children —— */

  appendChild(child) {
    if (child && child.isFragment) {
      for (const grandChild of child.children.slice()) this.appendChild(grandChild);
      child.children = [];
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  get childElementCount() { return this.children.length; }

  /* —— text —— */

  get textContent() {
    if (this.children.length === 0) return this.textValue;
    return this.textValue + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.textValue = value === null || value === undefined ? '' : String(value);
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }

  /* —— attributes —— */

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'type') this.type = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(value);
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  /* —— events —— */

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((item) => item !== handler));
  }

  /** Dispatch with bubbling up to the document node. */
  dispatchEvent(event) {
    const evt = event || {};
    evt.type = evt.type || 'event';
    evt.defaultPrevented = Boolean(evt.defaultPrevented);
    if (!evt.preventDefault) evt.preventDefault = () => { evt.defaultPrevented = true; };
    if (!evt.stopPropagation) evt.stopPropagation = () => { evt.stopped = true; };
    if (!evt.target) evt.target = this;
    if (evt.dataTransfer === undefined) evt.dataTransfer = null;

    let node = this;
    while (node) {
      const list = node.listeners && node.listeners.get(evt.type);
      if (list) for (const handler of list.slice()) handler.call(node, evt);
      if (evt.stopped) break;
      node = node.parentNode;
    }
    return !evt.defaultPrevented;
  }

  click() {
    return this.dispatchEvent({ type: 'click' });
  }

  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  select() { this.selected = true; }
  scrollIntoView() { this.scrolledIntoView = true; }

  /* —— queries —— */

  matches(selector) {
    for (const part of String(selector).trim().split(/\s*,\s*/)) {
      const simple = part.trim();
      if (!simple) continue;
      const tagAndClass = /^([a-z]+)?(?:\.([\w-]+))?$/.exec(simple);
      if (simple.startsWith('#')) {
        if (this.id === simple.slice(1)) return true;
        continue;
      }
      if (!tagAndClass) continue;
      const [, tag, className] = tagAndClass;
      if (tag && this.tagName !== tag.toUpperCase()) continue;
      if (className && !this.classList.contains(className)) continue;
      if (!tag && !className) continue;
      return true;
    }
    return false;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    return this.ownerDocument.querySelector(selector, this);
  }

  /** Depth-first search over this subtree (document searches the whole tree). */
  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const deeper = child.find(predicate);
      if (deeper) return deeper;
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Document
 * ------------------------------------------------------------------ */

class StubDocument extends StubElement {
  constructor() {
    super('#document', null);
    this.ownerDocument = this;
    this.byId = new Map();
    this.readyState = 'complete';
    this.activeElement = null;
    this.documentElement = new StubElement('html', this);
    this.body = new StubElement('body', this);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.execCommand = () => true;
    this.createdElements = [];
  }

  createElement(tagName) {
    const node = new StubElement(tagName, this);
    this.createdElements.push(node);
    return node;
  }

  /** A fragment behaves like an element whose children get moved on append. */
  createDocumentFragment() {
    const fragment = new StubElement('#fragment', this);
    fragment.isFragment = true;
    return fragment;
  }

  /** Register a pre-existing element (mirrors `id="…"` in index.html). */
  register(id, tagName, parent) {
    const node = new StubElement(tagName || 'div', this);
    node.id = id;
    node.setAttribute('id', id);
    (parent || this.body).appendChild(node);
    this.byId.set(id, node);
    return node;
  }

  getElementById(id) {
    return this.byId.get(id) || null;
  }

  querySelector(selector, scope) {
    const query = String(selector).trim();

    if (query.startsWith('#')) {
      const [first, ...rest] = query.split(/\s+/);
      const root = this.byId.get(first.slice(1));
      if (!root) return null;
      if (!rest.length) return root;
      // Only the compound selectors this app uses: "#table tbody".
      const tag = rest[0];
      let child = root.find((node) => node.tagName === tag.toUpperCase());
      if (!child) {
        child = this.createElement(tag);
        root.appendChild(child);
      }
      return child;
    }

    if (query.startsWith('.')) {
      const className = query.slice(1);
      const roots = scope ? [scope] : [this.body, ...this.createdElements];
      for (const element of this.byId.values()) roots.push(element);
      for (const root of roots) {
        if (root.classList && root.classList.contains(className)) return root;
        const found = root.find((node) => node.classList && node.classList.contains(className));
        if (found) return found;
      }
      return null;
    }

    return null;
  }
}

/* ------------------------------------------------------------------ *
 * index.html → element registry
 * ------------------------------------------------------------------ */

const TAG_BY_ID = {
  file: 'input',
  input: 'textarea',
  output: 'textarea',
  filter: 'input',
  reveal: 'input',
  'only-required': 'input',
  'opt-extra': 'input',
  'opt-expired': 'input',
  convert: 'button',
  sample: 'button',
  clear: 'button',
  copy: 'button',
  'download-json': 'button',
  'download-txt': 'button',
  'fmt-pretty': 'button',
  'fmt-min': 'button',
  'theme-toggle': 'button',
  checklist: 'ul',
  notes: 'ul',
  'report-list': 'ul',
  report: 'details',
  status: 'div',
  toasts: 'div',
  result: 'section',
  'table-note': 'p',
  'privacy-note': 'p',
};

/** Build a document whose ids exactly mirror index.html. */
function createDocument() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const doc = new StubDocument();

  for (const match of html.matchAll(/id="([^"]+)"/g)) {
    const id = match[1];
    if (doc.byId.has(id)) continue;
    doc.register(id, TAG_BY_ID[id] || 'div');
  }

  // The two structural lookups app.js performs with querySelector().
  doc.register('segmented-anchor', 'div', doc.getElementById('output-tools') || doc.body);
  doc.byId.get('segmented-anchor').className = 'segmented';
  return doc;
}

/* ------------------------------------------------------------------ *
 * Clock — deterministic timers
 * ------------------------------------------------------------------ */

function createClock() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(handler, delay) {
      const id = nextId++;
      pending.set(id, { handler, delay: delay || 0 });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    get size() { return pending.size; },
    /** Run every pending callback (in scheduling order) exactly once. */
    runAll() {
      let guard = 0;
      while (pending.size && guard++ < 500) {
        const [id, job] = pending.entries().next().value;
        pending.delete(id);
        job.handler();
      }
    },
    /** Run callbacks scheduled with a delay <= maxDelay (default: 0 ms). */
    runDue(maxDelay = 0) {
      for (const [id, job] of [...pending.entries()]) {
        if (job.delay <= maxDelay) {
          pending.delete(id);
          job.handler();
        }
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Window / realm
 * ------------------------------------------------------------------ */

function createRealm(options = {}) {
  const doc = createDocument();
  const clock = createClock();
  const storage = new Map();
  if (options.theme) storage.set('gcc-theme', options.theme);
  if (options.prefs) storage.set('gcc-prefs', JSON.stringify(options.prefs));
  const matchMediaState = { matches: Boolean(options.prefersLight) };

  const window = {
    document: doc,
    navigator: options.navigator === null ? undefined : Object.assign({
      clipboard: null,
      serviceWorker: undefined,
      userAgent: 'dom-stub',
    }, options.navigator || {}),
    location: { protocol: options.protocol || 'file:', href: 'file:///index.html' },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    matchMedia: (query) => ({
      matches: /prefers-color-scheme: light/.test(query) ? matchMediaState.matches : false,
      media: query,
      addEventListener: () => {},
      addListener: () => {},
    }),
    performance: { now: () => Date.now() },
    scrollY: 0,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    addEventListener: (type, handler) => doc.addEventListener(type, handler),
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    Blob: class BlobStub { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } },
    Intl,
  };

  const sandbox = Object.assign({}, window, {
    window,
    self: window,
    globalThis: window,
    document: doc,
    console,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    Promise,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Map,
    Set,
    Symbol,
    Intl,
  });

  const context = vm.createContext(sandbox);

  // The engine first (it defines window.CookieConverter), then the UI.
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/converter.js'), 'utf8'), context,
    { filename: 'assets/converter.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8'), context,
    { filename: 'assets/app.js' });

  return {
    context,
    window,
    document: doc,
    clock,
    storage,
    matchMediaState,
    engine: window.CookieConverter,
    /** Fire a document-level event (keydown, paste, …). */
    fire(type, event) {
      return doc.dispatchEvent(Object.assign({ type }, event || {}));
    },
  };
}

/** A File-ish object backed by a string, like the ones app.js reads. */
function makeFile(name, text) {
  return {
    name,
    size: Buffer.byteLength(text, 'utf8'),
    text: () => Promise.resolve(text),
  };
}

module.exports = { createRealm, createDocument, createClock, makeFile, StubElement };
