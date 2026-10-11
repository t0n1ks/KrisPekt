/*
 * Static, hard-coded SVG icon paths. This is the only module allowed to turn a string into
 * markup (enforced by ESLint): the strings below are constants and never contain user data.
 */
const PATHS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  undo: '<path d="M9 5L4 10l5 5"/><path d="M4 10h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 5l5 5-5 5"/><path d="M20 10H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  pen: '<path d="M4 20l1.2-4.8L15.8 4.6a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.8 18.8z"/><path d="M14 6.5l3.5 3.5"/>',
  ballpoint:
    '<path d="M4 20l1.2-4.8L15.8 4.6a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.8 18.8z"/><path d="M14 6.5l3.5 3.5"/>',
  fountain:
    '<path d="M12 21.5l-4.6-9.2L12 2.5l4.6 9.8z"/><path d="M12 21.5v-8"/><circle cx="12" cy="11.3" r="1.5"/>',
  fineliner:
    '<path d="M17.2 3.2l3.6 3.6-10 10-3.6-3.6z"/><path d="M7.2 13.2L6 18l4.8-1.2"/><path d="M6 18l-2.5 2.5"/>',
  pencil:
    '<path d="M4 20l1.4-5L15.8 4.6l3.6 3.6L9 18.6z"/><path d="M5.4 15L9 18.6"/><path d="M13.6 6.8l3.6 3.6"/><path d="M4 20l2.2-.6-1.6-1.6z" fill="currentColor"/>',
  brush:
    '<path d="M20.5 3.5c-3.2 1.4-7.4 5.6-9.6 8.8l1.6 1.6c3.2-2.2 7.4-6.4 8-10.4z"/><path d="M10.2 13.2c-2.6-.2-4.4 1.4-4.6 3.8-.1 1.4-.9 2.6-2.4 2.9 3.2 1.4 7.8.6 8.4-3.2z"/>',
  eraserPixel:
    '<circle cx="12" cy="12" r="7.5" stroke-dasharray="2.6 2.4"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>',
  eraserStroke: '<path d="M3 14.5c2.6-5.5 5.4-5.5 9 0s6.4 5.5 9 0"/><path d="M4.5 5l15 14"/>',
  marker:
    '<path d="M7 14.5l8.6-9.4a2 2 0 0 1 2.9-.1l.5.5a2 2 0 0 1-.1 2.9L9.5 17H7z"/><path d="M7 14.5L4.5 17v2.5H7l2.5-2.5"/><path d="M13 21h7"/>',
  eraser:
    '<path d="M8 20h12"/><path d="M4.6 15.4l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8.2z"/><path d="M9.2 10.8l5 5"/>',
  lasso:
    '<ellipse cx="12" cy="9.5" rx="8" ry="5.5" stroke-dasharray="3 2.6"/><path d="M8 14.3c-1.4 1.6-.8 3.6 1.2 4.2 1.6.5 1.8 1.7 1 3"/>',
  text: '<path d="M5 7V4.5h14V7"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
  ruler:
    '<rect x="2" y="7.5" width="20" height="9" rx="1.5"/><path d="M6 7.5v3.5M10 7.5v2.5M14 7.5v3.5M18 7.5v2.5"/>',
  pages: '<rect x="4" y="3" width="11" height="14" rx="1.5"/><path d="M9 21h9.5a1.5 1.5 0 0 0 1.5-1.5V8"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.7-1.5"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  image:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.7"/><path d="M21 15.5l-5-5L7 19"/>',
  file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h4.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9.5l5-5 5 5M5 20h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  hand: '<path d="M8 13.5V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.6 7-6.5 7-3 0-4.8-1.6-6-4l-1.3-2.8a1.5 1.5 0 0 1 2.6-1.5L8 14.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  page: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  palette:
    '<path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-1 2-2 0-1.5-1.3-1.7-1.3-3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.3 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  folder:
    '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
} as const;

export type IconName = keyof typeof PATHS;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an inline SVG icon (decorative, hidden from screen readers). */
export function icon(name: IconName, size = 22): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs: Record<string, string> = {
    class: 'icon',
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  };
  for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
  svg.innerHTML = PATHS[name];
  return svg;
}
