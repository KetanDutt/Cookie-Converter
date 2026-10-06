/**
 * A tiny, dependency-free DOM.
 * ============================================================================
 * The project ships no test dependencies, so instead of pulling in jsdom the UI
 * tests run `assets/app.js` inside a `node:vm` context backed by this minimal
 * implementation.
 *
 * It is *parsed from the real `index.html`*, which is what makes the UI tests
 * meaningful: element ids, classes, roles, aria attributes, nesting and boolean
 * attributes (`hidden`, `disabled`, `checked`) all match what a browser would
 * build. A typo'd id, a missing parent or a misplaced `hidden` fails a test
 * instead of being papered over by a hand-maintained fixture.
 *
 * Faithful:  element tree · attributes · classList · dataset · bubbling events ·
 *            closest()/contains() · querySelector(All) for simple selectors ·
 *            dialog showModal/close · IntersectionObserver · rAF-backed clock.
 * Stubbed:   layout, rendering, CSS, real timers, real files, real network.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

/* Tags that never have children in HTML. */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

/* Subtrees the stub does not need to build (pure decoration / sitemap-ish). */
const SKIP_SUBTREES = new Set(['svg']);
const SKIP_TAGS = new Set(['script', 'style']);

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
    remove(...names) { write(parse().filter((name) => !names.includes(name))); },
    toggle(name, force) {
      const has = parse().includes(name);
      const next = force === undefined ? !has : Boolean(force);
      if (next) this.add(name); else this.remove(name);
      return next;
    },
    contains(name) { return parse().includes(name); },
    get length() { return parse().length; },
  };
}

/* ------------------------------------------------------------------ *
 * style (needs setProperty for CSS custom properties)
 * ------------------------------------------------------------------ */

function createStyle() {
  const props = new Map();
  return {
    setProperty(name, value) { props.set(name, String(value)); },
    getPropertyValue(name) { return props.get(name) || ''; },
    removeProperty(name) { props.delete(name); },
    get cssText() { return [...props.entries()].map(([k, v]) => `${k}: ${v}`).join('; '); },
  };
}

/* ------------------------------------------------------------------ *
 * Element
 * ------------------------------------------------------------------ */

class StubElement {
  constructor(tagName, document) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.namespaceURI = null;
    this.ownerDocument = document;
    this.parentNode = null;
    this.childNodes = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = createStyle();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.tabIndex = 0;
    this.href = '';
    this.download = '';
    this.type = '';
    this.title = '';
    this.files = [];
    this.className = '';
    this.listeners = new Map();
    this.classList = createClassList(this);
  }

  /* —— tree —— */

  appendChild(child) {
    if (child && child.isFragment) {
      for (const grandChild of child.childNodes.slice()) this.appendChild(grandChild);
      child.childNodes = [];
      return child;
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  removeChild(child) { this.childNodes = this.childNodes.filter((item) => item !== child); child.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  /** Element children only — mirrors the DOM `children` collection. */
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  get childElementCount() { return this.children.length; }
  get parentElement() { return this.parentNode; }

  /* —— text —— */

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    const text = value === null || value === undefined ? '' : String(value);
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = text ? [createTextNode(text)] : [];
  }

  /* —— attributes —— */

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'type') this.type = String(value);
    if (name === 'href') this.href = String(value);
    if (name === 'role') this.role = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(value);
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name === 'type') return this.type || null;
    if (name === 'href') return this.href || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'id') this.id = undefined; }

  /* —— events —— */

  addEventListener(type, handler, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ handler, capture: Boolean(options && options.capture) });
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((item) => item.handler !== handler));
  }

  /** Dispatch with bubbling to the document node. */
  dispatchEvent(event) {
    const evt = event || {};
    evt.type = evt.type || 'event';
    evt.defaultPrevented = Boolean(evt.defaultPrevented);
    if (!evt.preventDefault) evt.preventDefault = () => { evt.defaultPrevented = true; };
    if (!evt.stopPropagation) evt.stopPropagation = () => { evt.stopped = true; };
    if (!evt.target) evt.target = this;
    if (evt.dataTransfer === undefined) evt.dataTransfer = null;
    if (evt.clipboardData === undefined) evt.clipboardData = undefined;

    let node = this;
    while (node) {
      const list = node.listeners && node.listeners.get(evt.type);
      if (list) for (const entry of list.slice()) entry.handler.call(node, evt);
      if (evt.stopped) break;
      node = node.parentNode;
    }
    return !evt.defaultPrevented;
  }

  click() { return this.dispatchEvent({ type: 'click' }); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  select() { this.selected = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }

  /* native <dialog> surface */
  showModal() { this.open = true; this.setAttribute('open', ''); }
  show() { this.showModal(); }
  close() { this.open = false; this.removeAttribute('open'); this.dispatchEvent({ type: 'close' }); }

  /* —— selectors —— */

  matches(selector) {
    const parts = String(selector).trim().split(/\s*,\s*/);
    for (const part of parts) {
      const simple = part.trim();
      if (!simple) continue;
      if (this.matchesSimple(simple)) return true;
    }
    return false;
  }

  matchesSimple(simple) {
    if (simple.startsWith('#')) return this.id === simple.slice(1);
    if (simple.startsWith('.')) return this.classList.contains(simple.slice(1));
    if (simple.startsWith('[')) {
      const match = /^\[([\w-]+)(?:([~|^$*]?=)"?([^"\]]*)"?)?\]$/.exec(simple);
      if (!match) return false;
      const [, name, operator, value] = match;
      const actual = this.getAttribute(name);
      if (actual === null || actual === undefined) return false;
      if (!operator) return true;
      if (operator === '=') return actual === value;
      if (operator === '^=') return String(actual).startsWith(value);
      if (operator === '$=') return String(actual).endsWith(value);
      return String(actual).includes(value);
    }
    const tagAndClass = /^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?$/.exec(simple);
    if (!tagAndClass || (!tagAndClass[1] && !tagAndClass[2])) return false;
    const [, tag, className] = tagAndClass;
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (className && !this.classList.contains(className)) return false;
    return true;
  }

  /** Search this subtree (excluding self) for the first match of a simple selector. */
  findDescendant(selector) {
    for (const child of this.children) {
      if (child.matches && child.matches(selector)) return child;
      const deeper = child.findDescendant ? child.findDescendant(selector) : null;
      if (deeper) return deeper;
    }
    return null;
  }

  findAllDescendants(selector, out) {
    const results = out || [];
    for (const child of this.children) {
      if (child.matches && child.matches(selector)) results.push(child);
      if (child.findAllDescendants) child.findAllDescendants(selector, results);
    }
    return results;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* Supports "#id", ".class", "tag" and "#id tag" — all app.js uses. */
  querySelector(selector) {
    const parts = String(selector).trim().split(/\s+/);
    if (parts.length === 2 && parts[0].startsWith('#')) {
      const root = this.ownerDocument.getElementById(parts[0].slice(1));
      if (!root) return null;
      let found = root.findDescendant(parts[1]);
      if (!found && /^[a-zA-Z][\w-]*$/.test(parts[1])) {
        found = this.ownerDocument.createElement(parts[1]);
        root.appendChild(found);
      }
      return found;
    }
    if (this.matches && this.matches(selector)) return this;
    return this.findDescendant(selector);
  }

  querySelectorAll(selector) {
    return this.findAllDescendants(selector);
  }
}

/* ------------------------------------------------------------------ *
 * Document
 * ------------------------------------------------------------------ */

class StubDocument extends StubElement {
  constructor() {
    super('#document', null);
    this.ownerDocument = this;
    this.readyState = 'complete';
    this.activeElement = null;
    this.documentElement = new StubElement('html', this);
    this.body = new StubElement('body', this);
    this.head = new StubElement('head', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.execCommand = () => true;
  }

  createElement(tagName) { return new StubElement(tagName, this); }

  createElementNS(namespace, tagName) {
    const node = new StubElement(tagName, this);
    node.namespaceURI = namespace;
    return node;
  }

  createDocumentFragment() {
    const fragment = new StubElement('#fragment', this);
    fragment.isFragment = true;
    return fragment;
  }

  getElementById(id) {
    if (this.id === id) return this;
    return this.body.findAllDescendants('#' + id)[0] || this.head.findAllDescendants('#' + id)[0] || null;
  }

  querySelector(selector) {
    const parts = String(selector).trim().split(/\s+/);
    if (parts.length === 2 && parts[0].startsWith('#')) {
      const root = this.getElementById(parts[0].slice(1));
      if (!root) return null;
      let found = root.findDescendant(parts[1]);
      if (!found && /^[a-zA-Z][\w-]*$/.test(parts[1])) {
        found = this.createElement(parts[1]);
        root.appendChild(found);
      }
      return found;
    }
    return this.body.findDescendant(selector) || this.head.findDescendant(selector);
  }

  querySelectorAll(selector) {
    return this.body.findAllDescendants(selector).concat(this.head.findAllDescendants(selector));
  }
}

/* ------------------------------------------------------------------ *
 * Mini HTML parser — builds the document tree from index.html
 * ------------------------------------------------------------------ */

const ATTR_RE = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Minimal text node — only the bits the tests observe. */
function createTextNode(text) {
  return { nodeType: 3, parentNode: null, textContent: String(text) };
}

function parseAttributes(source) {
  const attributes = [];
  ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ATTR_RE.exec(source))) {
    attributes.push({
      name: match[1].toLowerCase(),
      value: match[2] !== undefined ? match[2]
        : match[3] !== undefined ? match[3]
          : match[4] !== undefined ? match[4] : '',
    });
  }
  return attributes;
}

/** Apply markup attributes to a stub node the way a browser would. */
function applyAttributes(node, attributes) {
  for (const { name, value } of attributes) {
    if (name === 'class') { node.className = value; continue; }
    if (name === 'id') { node.id = value; node.attributes.set('id', value); continue; }
    node.attributes.set(name, value);
    if (name === 'role') node.role = value;
    if (name === 'type') node.type = value;
    if (name === 'href') node.href = value;
    if (name === 'value') node.value = value;
    if (name === 'title') node.title = value;
    if (name === 'hidden') node.hidden = true;
    if (name === 'disabled') node.disabled = true;
    if (name === 'checked') node.checked = true;
    if (name === 'open') node.open = true;
    if (name === 'tabindex') node.tabIndex = Number(value);
    if (name.startsWith('data-')) {
      node.dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = value;
    }
  }
}

/**
 * Parse an HTML document into a StubDocument.
 * Deliberately small: tags, attributes, comments, void elements, and skipping
 * of `script`/`style`/`svg` subtrees.
 */
function parseDocument(html) {
  const doc = new StubDocument();
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const stack = [doc.body];
  let index = 0;

  function pushText(text) {
    if (!text) return;
    const collapsed = text.replace(/\s+/g, ' ');
    if (!collapsed.trim()) return;
    stack[stack.length - 1].appendChild(createTextNode(collapsed.trim()));
  }

  while (index < source.length) {
    const lt = source.indexOf('<', index);
    if (lt === -1) { pushText(source.slice(index)); break; }

    pushText(source.slice(index, lt));

    if (source.startsWith('<!', lt)) {
      index = source.indexOf('>', lt) + 1 || source.length;
      continue;
    }

    const gt = source.indexOf('>', lt);
    if (gt === -1) break;
    const raw = source.slice(lt + 1, gt);
    index = gt + 1;

    if (raw.startsWith('/')) { // closing tag
      const name = raw.slice(1).trim().toLowerCase();
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName === name.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const spaceAt = body.search(/[\s/]/);
    const tagName = (spaceAt === -1 ? body : body.slice(0, spaceAt)).toLowerCase();
    const attributes = spaceAt === -1 ? [] : parseAttributes(body.slice(spaceAt));
    if (!tagName) continue;

    if (SKIP_TAGS.has(tagName)) { // skip <script>/<style> entirely
      const closeAt = source.toLowerCase().indexOf('</' + tagName, index);
      index = closeAt === -1 ? source.length : source.indexOf('>', closeAt) + 1;
      continue;
    }

    const parent = stack[stack.length - 1];
    if (SKIP_SUBTREES.has(tagName)) { // skip <svg> subtrees (sprite, art)
      const closeAt = source.toLowerCase().indexOf('</' + tagName, index);
      index = closeAt === -1 ? source.length : source.indexOf('>', closeAt) + 1;
      continue;
    }

    const node = doc.createElement(tagName);
    applyAttributes(node, attributes);
    parent.appendChild(node);

    const isVoid = VOID_TAGS.has(tagName) || selfClosing;
    if (!isVoid) stack.push(node);
  }

  return doc;
}

/** Build a document whose tree matches index.html. */
function createDocument() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return parseDocument(html);
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
    requestAnimationFrame(handler) { return this.setTimeout(() => handler(Date.now()), 16); },
    cancelAnimationFrame(id) { pending.delete(id); },
    get size() { return pending.size; },
    /** Run every pending callback, in scheduling order, until none remain. */
    runAll() {
      let guard = 0;
      while (pending.size && guard++ < 2000) {
        const [id, job] = pending.entries().next().value;
        pending.delete(id);
        job.handler();
      }
    },
    /** Run callbacks scheduled with delay <= maxDelay. */
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
 * IntersectionObserver stub — resolves immediately as "in view"
 * ------------------------------------------------------------------ */

class StubIntersectionObserver {
  constructor(callback) { this.callback = callback; this.targets = new Set(); }
  observe(node) {
    this.targets.add(node);
    this.callback([{ isIntersecting: true, target: node, intersectionRatio: 1 }], this);
  }
  unobserve(node) { this.targets.delete(node); }
  disconnect() { this.targets.clear(); }
}

/* ------------------------------------------------------------------ *
 * Realm
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
      matches: options.prefersLight && /prefers-color-scheme: light/.test(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
    }),
    performance: { now: () => Date.now() },
    innerWidth: 1280,
    innerHeight: 900,
    scrollY: 0,
    scrollTo: () => {},
    setTimeout: (handler, delay) => clock.setTimeout(handler, delay),
    clearTimeout: (id) => clock.clearTimeout(id),
    requestAnimationFrame: (handler) => clock.requestAnimationFrame(handler),
    cancelAnimationFrame: (id) => clock.cancelAnimationFrame(id),
    addEventListener: (type, handler, opts) => doc.addEventListener(type, handler, opts),
    removeEventListener: (type, handler) => doc.removeEventListener(type, handler),
    IntersectionObserver: StubIntersectionObserver,
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    Blob: class BlobStub { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } },
    FileReader: class FileReaderStub {
      readAsText() { if (this.onerror) this.onerror(new Error('not implemented')); }
    },
    Intl,
  };

  const sandbox = Object.assign({}, window, {
    window,
    self: window,
    globalThis: window,
    document: doc,
    console,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    IntersectionObserver: StubIntersectionObserver,
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
    TypeError,
    Map,
    Set,
    Symbol,
    Intl,
  });

  const context = vm.createContext(sandbox);
  const sources = ['assets/converter.js', 'assets/ui.js', 'assets/app.js'];
  for (const file of sources) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }

  return {
    context,
    window,
    document: doc,
    clock,
    storage,
    engine: window.CookieConverter,
    ui: window.UI,
    /** Fire a document-level event (keydown, paste, …). */
    fire(type, event) {
      return doc.dispatchEvent(Object.assign({ type }, event || {}));
    },
    /** Make the page scroll to `y` and run the listener. */
    scrollTo(y) {
      window.scrollY = y;
      doc.dispatchEvent({ type: 'scroll' });
      clock.runDue(20);
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

module.exports = { createRealm, createDocument, createClock, makeFile, StubElement, parseDocument };
