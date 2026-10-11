import { PEN_COLORS } from '../core/constants';
import type { Page, Point, ToolKind } from '../core/types';
import { el } from '../core/utils/dom';
import { ColorRow } from '../ui/widgets/ColorRow';
import { Segmented } from '../ui/widgets/Segmented';
import { Tool } from './Tool';

/** Taps that move more than this many px are drags, not taps. */
const TAP_SLOP = 8;
/** Existing text is hit within this many page px of its box. */
const TEXT_HIT_PAD = 6;

type TextSize = '14' | '18' | '24' | '32';

/** Text boxes: tap empty paper to type, tap existing text to edit it. */
export class TextTool extends Tool {
  readonly kind: ToolKind = 'text';
  private tap: { page: Page | null; start: Point; moved: boolean } | null = null;

  override get cursorClass(): string {
    return 'stage__canvas--text';
  }

  onPointerDown(e: PointerEvent, pt: Point): void {
    const { camera, layout } = this.ctx;
    const w = camera.toWorld(pt.x, pt.y);
    this.startOperation(e);
    this.tap = { page: layout.pageAt(w.x, w.y), start: pt, moved: false };
  }

  override onPointerMove(e: PointerEvent): void {
    if (!this.tap) return;
    const pt = this.ctx.camera.toLocal(e.clientX, e.clientY);
    if (Math.hypot(pt.x - this.tap.start.x, pt.y - this.tap.start.y) > TAP_SLOP) this.tap.moved = true;
  }

  override onPointerUp(): void {
    const tap = this.tap;
    this.tap = null;
    this.endOperation();
    if (tap && !tap.moved && tap.page) this.openAt(tap.page, tap.start);
  }

  override onPointerCancel(): void {
    this.tap = null;
    this.endOperation();
  }

  /** A finger tap (finger drawing off) also places text. */
  override onTap(pt: Point): void {
    const { camera, layout } = this.ctx;
    const w = camera.toWorld(pt.x, pt.y);
    const page = layout.pageAt(w.x, w.y);
    if (page) this.openAt(page, pt);
  }

  /** Edits the topmost text under the point, or starts a new one there. */
  private openAt(page: Page, pt: Point): void {
    const { camera, layout, texts } = this.ctx;
    const local = layout.toPage(page, camera.toWorld(pt.x, pt.y));
    const hit = [...page.texts].reverse().find((t) => {
      const b = texts.box(t);
      const pad = TEXT_HIT_PAD;
      return local.x >= b.x0 - pad && local.x <= b.x1 + pad && local.y >= b.y0 - pad && local.y <= b.y1 + pad;
    });
    this.ctx.editText(page, hit ?? null, local.x, local.y);
  }

  createOptionsPanel(): HTMLElement {
    const { i18n, prefs } = this.ctx;
    const sizes = new Segmented<TextSize>(
      [
        { v: '14', label: i18n.t('txtSmall') },
        { v: '18', label: i18n.t('txtNormal') },
        { v: '24', label: i18n.t('txtLarge') },
        { v: '32', label: i18n.t('txtHeading') },
      ],
      String(prefs.txt.fs) as TextSize,
      (v) => {
        prefs.txt.fs = Number(v);
        this.ctx.savePrefs();
      },
    );
    const colors = new ColorRow(i18n, PEN_COLORS, prefs.txt.c, (c) => {
      prefs.txt.c = c;
      this.ctx.savePrefs();
    });
    return el(
      'div',
      { class: 'popover__content' },
      el('h3', { class: 'popover__title' }, i18n.t('text')),
      sizes.node,
      colors.node,
      el('p', { class: 'hint' }, i18n.t('textHint')),
    );
  }
}
