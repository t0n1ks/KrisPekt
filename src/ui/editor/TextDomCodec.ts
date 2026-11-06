import type { LinkTarget, TextParagraph, TextSpan, TextStyle } from '../../core/types';
import { el, replaceChildren } from '../../core/utils/dom';
import { ID_PATTERN } from '../../core/utils/id';
import { RichText } from '../../domain/RichText';
import { LIST_INDENT_EM, RichTextLayout, type BoxDefaults } from '../../domain/RichTextLayout';
import { SafeUrl } from '../../domain/SafeUrl';
import { COLOR_PATTERN, LIMITS } from '../../storage/validation/guards';

/** A character range; a paragraph break counts as one character. */
export interface TextRange {
  start: number;
  end: number;
}

/**
 * Invisible character in an otherwise empty run, so the caret can sit in it and typing takes its
 * style (a browser would otherwise type into the neighbouring run). Never part of the model.
 */
const CARET_MARK = String.fromCharCode(0x200b);
const NO_BREAK_SPACE = String.fromCharCode(0xa0);
const FLAGS = ['b', 'i', 'u', 's'] as const;
const FLAG_CLASSES = { b: 'bold', i: 'italic', u: 'underline', s: 'strike' } as const;

function clean(text: string): string {
  return text.split(CARET_MARK).join('').split(NO_BREAK_SPACE).join(' ').split('\n').join(' ');
}

/**
 * Converts between the rich text model and the DOM of the editor. It builds with createElement and
 * textContent only. When reading, it trusts nothing: it takes the text of any node, and a style
 * only from the data attributes of runs, after checking them. So whatever a browser or a keyboard
 * put into the editor, only plain text and known styles can come out.
 */
export class TextDomCodec {
  /** Rebuilds the editor's content. */
  static render(root: HTMLElement, paras: readonly TextParagraph[], base: BoxDefaults): void {
    const numbers = RichText.listNumbers(paras);
    replaceChildren(root, ...paras.map((p, i) => TextDomCodec.paragraph(p, numbers[i] ?? 0, base)));
  }

  /** Reads the model back from whatever the editor contains now. */
  static parse(root: HTMLElement): TextParagraph[] {
    const out: TextParagraph[] = [];
    let loose: TextParagraph | null = null;
    for (const node of Array.from(root.childNodes)) {
      if (node instanceof HTMLDivElement) {
        loose = null;
        TextDomCodec.parseBlock(node, out);
        continue;
      }
      if (!loose) {
        loose = { runs: [] };
        out.push(loose);
      }
      TextDomCodec.collect(node, {}, loose, out);
    }
    if (!out.length) out.push({ runs: [{ t: '' }] });
    return RichText.normalized(out);
  }

  /** Whether the content is exactly what {@link render} builds; browsers' edits may leave it not. */
  static isCanonical(root: HTMLElement): boolean {
    const blocks = Array.from(root.childNodes);
    return blocks.length > 0 && blocks.every((block) => TextDomCodec.isCanonicalBlock(block));
  }

  /** Brings list numbers up to date without touching the text (safe during composition). */
  static syncMarkers(root: HTMLElement, paras: readonly TextParagraph[]): void {
    const numbers = RichText.listNumbers(paras);
    Array.from(root.children).forEach((block, i) => {
      const para = paras[i];
      if (!para?.list || !(block instanceof HTMLElement)) return;
      block.dataset.marker = TextDomCodec.markerText(para, numbers[i] ?? 0);
    });
  }

  /** The selection as offsets, if it is inside the editor. */
  static selection(root: HTMLElement): TextRange | null {
    const selection = root.ownerDocument.getSelection();
    if (!selection?.anchorNode || !selection.focusNode) return null;
    if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
    const a = TextDomCodec.offsetOf(root, selection.anchorNode, selection.anchorOffset);
    const b = TextDomCodec.offsetOf(root, selection.focusNode, selection.focusOffset);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  /** Selects a range. */
  static select(root: HTMLElement, range: TextRange): void {
    const selection = root.ownerDocument.getSelection();
    if (!selection) return;
    const start = TextDomCodec.pointAt(root, range.start);
    const end = range.end === range.start ? start : TextDomCodec.pointAt(root, range.end);
    selection.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
  }

  /** The offset nearest to a client point. */
  static offsetFromPoint(root: HTMLElement, x: number, y: number): number | null {
    const doc = root.ownerDocument;
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range && root.contains(range.startContainer)) {
      return TextDomCodec.offsetOf(root, range.startContainer, range.startOffset);
    }
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position && root.contains(position.offsetNode)) {
      return TextDomCodec.offsetOf(root, position.offsetNode, position.offset);
    }
    return null;
  }

  /** Puts an empty run in this style at the caret, with the caret in it: what comes next is styled. */
  static insertCaretRun(root: HTMLElement, offset: number, style: TextStyle, base: BoxDefaults): void {
    const point = TextDomCodec.pointAt(root, offset);
    const run = TextDomCodec.run({ ...style, t: CARET_MARK }, base);
    const text = run.firstChild as Text;
    const host = point.node instanceof Text ? point.node.parentElement : (point.node as Element);
    if (point.node instanceof Text && host) {
      const after = point.node.splitText(point.offset);
      const tail = host.cloneNode(false) as HTMLElement;
      tail.append(after);
      host.after(run, ...(after.data ? [tail] : []));
    } else if (host?.classList.contains('text-run')) host.after(run);
    else host?.append(run);
    root.ownerDocument.getSelection()?.setBaseAndExtent(text, 1, text, 1);
  }

  private static paragraph(para: TextParagraph, number: number, base: BoxDefaults): HTMLDivElement {
    const block = el('div', { class: 'text-para' });
    if (para.align) {
      block.classList.add('text-para--' + para.align);
      block.dataset.align = para.align;
    }
    if (para.list) {
      const fs = para.runs[0]?.fs ?? base.fs;
      block.classList.add('text-para--list');
      block.dataset.list = para.list;
      block.dataset.marker = TextDomCodec.markerText(para, number);
      block.style.setProperty('--indent', fs * LIST_INDENT_EM + 'px');
      block.style.setProperty('--marker-size', fs + 'px');
      block.style.setProperty('--marker-color', para.runs[0]?.c ?? base.c);
    }
    for (const run of para.runs) block.append(TextDomCodec.run(run, base));
    return block;
  }

  private static markerText(para: TextParagraph, number: number): string {
    return para.list === 'bullet' ? '•' : `${number}.`;
  }

  private static run(run: TextSpan, base: BoxDefaults): HTMLSpanElement {
    const span = el('span', { class: 'text-run' });
    span.style.setProperty('--run-size', (run.fs ?? base.fs) + 'px');
    span.style.setProperty('--run-color', RichTextLayout.runColor(run, base));
    if (run.fs !== undefined) span.dataset.fs = String(run.fs);
    if (run.c !== undefined) span.dataset.c = run.c;
    for (const flag of FLAGS) {
      if (!run[flag]) continue;
      span.dataset[flag] = '1';
      span.classList.add('text-run--' + FLAG_CLASSES[flag]);
    }
    if (run.link) {
      TextDomCodec.writeLink(span, run.link);
      span.classList.add('text-run--underline');
    }
    if (run.t) span.textContent = run.t;
    else span.append(el('br'));
    return span;
  }

  private static parseBlock(block: HTMLElement, out: TextParagraph[]): void {
    const para: TextParagraph = { runs: [] };
    if (block.dataset.align === 'center' || block.dataset.align === 'right') para.align = block.dataset.align;
    if (block.dataset.list === 'bullet' || block.dataset.list === 'number') para.list = block.dataset.list;
    out.push(para);
    TextDomCodec.collect(block, {}, para, out);
    if (!para.runs.length) para.runs.push({ t: '' });
  }

  /** Adds the text under a node to a paragraph; a nested block or a line break starts another. */
  private static collect(node: Node, style: TextStyle, para: TextParagraph, out: TextParagraph[]): void {
    let current = para;
    for (const child of node instanceof Text ? [node] : Array.from(node.childNodes)) {
      if (child instanceof Text) {
        current.runs.push({ ...style, t: clean(child.data) });
      } else if (child instanceof HTMLBRElement) {
        if (TextDomCodec.hasContentAfter(child, node)) {
          current = { ...TextDomCodec.settingsOf(current), runs: [] };
          out.push(current);
        } else current.runs.push({ ...style, t: '' });
      } else if (child instanceof HTMLDivElement || child instanceof HTMLParagraphElement) {
        TextDomCodec.parseBlock(child, out);
        current = { ...TextDomCodec.settingsOf(current), runs: [] };
        out.push(current);
      } else if (child instanceof HTMLElement) {
        TextDomCodec.collect(child, TextDomCodec.readStyle(child, style), current, out);
      }
    }
    for (let i = out.length - 1; i >= 0; i--) {
      const candidate = out[i];
      if (candidate && !candidate.runs.length && candidate !== para) out.splice(i, 1);
    }
  }

  private static settingsOf(para: TextParagraph): Omit<TextParagraph, 'runs'> {
    const { runs: _runs, ...settings } = para;
    return settings;
  }

  private static hasContentAfter(br: Element, parent: Node): boolean {
    let next = br.nextSibling;
    while (next) {
      if ((next.textContent ?? '') !== '' || next instanceof HTMLBRElement) return true;
      next = next.nextSibling;
    }
    return parent instanceof HTMLElement && parent.classList.contains('text-run')
      ? parent.nextSibling !== null
      : false;
  }

  /** A style from a run's data attributes, only if they check out. */
  private static readStyle(node: HTMLElement, inherited: TextStyle): TextStyle {
    if (!node.classList.contains('text-run')) return inherited;
    const style: TextStyle = {};
    const fs = Number(node.dataset.fs);
    if (node.dataset.fs && fs >= LIMITS.fontSize[0] && fs <= LIMITS.fontSize[1]) style.fs = fs;
    const color = node.dataset.c;
    if (color && COLOR_PATTERN.test(color)) style.c = color;
    for (const flag of FLAGS) if (node.dataset[flag] === '1') style[flag] = true;
    const link = TextDomCodec.readLink(node);
    if (link) style.link = link;
    return style;
  }

  private static writeLink(span: HTMLElement, link: LinkTarget): void {
    if (link.kind === 'url') {
      span.dataset.href = link.href;
      return;
    }
    span.dataset.linkKind = link.kind;
    span.dataset.linkNb = link.nb;
    if (link.kind !== 'notebook') span.dataset.linkId = link.id;
  }

  /** A link from a run's data attributes, only if it checks out. */
  private static readLink(node: HTMLElement): LinkTarget | null {
    const { href, linkKind: kind, linkNb: nb, linkId: id } = node.dataset;
    if (href) {
      const safe = SafeUrl.strict(href);
      return safe ? { kind: 'url', href: safe } : null;
    }
    if (!nb || !ID_PATTERN.test(nb)) return null;
    if (kind === 'notebook') return { kind, nb };
    return (kind === 'anchor' || kind === 'page') && id && ID_PATTERN.test(id) ? { kind, nb, id } : null;
  }

  private static isCanonicalBlock(block: Node): boolean {
    if (!(block instanceof HTMLDivElement) || !block.classList.contains('text-para')) return false;
    const runs = Array.from(block.childNodes);
    return runs.length > 0 && runs.every((run) => TextDomCodec.isCanonicalRun(run));
  }

  private static isCanonicalRun(run: Node): boolean {
    if (!(run instanceof HTMLSpanElement) || !run.classList.contains('text-run')) return false;
    if (run.style.length !== 2 || run.childNodes.length !== 1) return false;
    const only = run.firstChild;
    return only instanceof HTMLBRElement || (only instanceof Text && only.data.length > 0);
  }

  private static offsetOf(root: HTMLElement, node: Node, nodeOffset: number): number {
    if (node === root) {
      let total = 0;
      Array.from(root.childNodes)
        .slice(0, nodeOffset)
        .forEach((block) => {
          total += clean(block.textContent ?? '').length + 1;
        });
      return total;
    }
    let total = 0;
    for (const block of Array.from(root.childNodes)) {
      if (!block.contains(node)) {
        total += clean(block.textContent ?? '').length + 1;
        continue;
      }
      const range = root.ownerDocument.createRange();
      range.setStart(block, 0);
      range.setEnd(node, nodeOffset);
      return total + clean(range.toString()).length;
    }
    return Math.max(0, total - 1);
  }

  /** The DOM point of an offset; in a run with no text, the run itself. */
  private static pointAt(root: HTMLElement, offset: number): { node: Node; offset: number } {
    let left = offset;
    const blocks = Array.from(root.childNodes);
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i] as Node;
      const len = clean(block.textContent ?? '').length;
      if (left <= len || i === blocks.length - 1)
        return TextDomCodec.pointInBlock(block, Math.min(left, len));
      left -= len + 1;
    }
    return { node: root, offset: 0 };
  }

  private static pointInBlock(block: Node, offset: number): { node: Node; offset: number } {
    const walker = (block.ownerDocument as Document).createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let left = offset;
    let last: Text | null = null;
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      const len = clean(text.data).length;
      if (!len) continue;
      if (left <= len) return { node: text, offset: left };
      left -= len;
      last = text;
    }
    if (last) return { node: last, offset: last.data.length };
    const run = block.firstChild;
    return run && !(run instanceof Text) ? { node: run, offset: 0 } : { node: block, offset: 0 };
  }
}
