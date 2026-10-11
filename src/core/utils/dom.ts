/** A child accepted by {@link el}: nodes are appended, strings become text nodes, falsy values are skipped. */
export type Child = Node | string | number | null | undefined | false;

type Listeners = { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };

export interface ElOptions {
  class?: string;
  /** Attributes. `true` sets an empty attribute, `false`/`null`/`undefined` skip it. Event attributes are rejected. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** Event listeners, added with addEventListener. */
  on?: Listeners;
  /** CSS custom properties and runtime geometry, e.g. `{ '--cover-color': '#2F5DA8' }`. */
  style?: Record<string, string>;
}

/**
 * Creates an element. Text is always inserted as text nodes, never parsed as markup, so user
 * data passed as a child is safe. `on…` attributes throw: listeners go through `opts.on`.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts?: ElOptions | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts) applyOptions(node, opts);
  append(node, children);
  return node;
}

function applyOptions(node: HTMLElement, opts: ElOptions): void {
  if (opts.class) node.className = opts.class;
  if (opts.attrs) {
    for (const [key, value] of Object.entries(opts.attrs)) {
      if (/^on/i.test(key)) throw new Error('Event attributes are not allowed: ' + key);
      if (value == null || value === false) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (opts.style) for (const [prop, value] of Object.entries(opts.style)) node.style.setProperty(prop, value);
  if (opts.on) {
    for (const [type, handler] of Object.entries(opts.on)) {
      node.addEventListener(type, handler as EventListener);
    }
  }
}

/** Appends children to a node (see {@link Child}). */
export function append(node: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Finds a required element by id; a missing shell element is a programming error. */
export function byId<T extends HTMLElement = HTMLElement>(id: string, root: Document = document): T {
  const node = root.getElementById(id);
  if (!node) throw new Error('Missing element #' + id);
  return node as T;
}

/** Finds a required descendant by selector. */
export function query<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error('Missing element ' + selector);
  return node;
}

/** Gets a 2D context; canvases always support it in the browsers we target. */
export function context2d(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D {
  const ctx = (canvas as HTMLCanvasElement).getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return ctx;
}

/** Replaces all children of a node. */
export function replaceChildren(node: Element, ...children: Child[]): void {
  node.textContent = '';
  append(node, children);
}
