import { HL_COLORS } from '../core/constants';
import type { BrushKind, PenPrefs, RecentColors, StrokeKind } from '../core/types';
import { PenTool } from './PenTool';

/** A wide translucent marker; same input handling as the pen, its own colours and sizes. */
export class HighlighterTool extends PenTool {
  override readonly kind: StrokeKind = 'hl';

  protected override get settings(): PenPrefs {
    return this.ctx.prefs.hl;
  }

  /** Highlighter strokes have no brush. */
  protected override get brush(): BrushKind | undefined {
    return undefined;
  }

  protected override get palette(): readonly string[] {
    return HL_COLORS;
  }

  protected override get paletteNames(): string[] {
    return this.ctx.i18n.list('hlColorNames');
  }

  protected override get recentKey(): keyof RecentColors {
    return 'hl';
  }

  protected override get sizeRange(): { min: number; max: number; step: number } {
    return { min: 6, max: 40, step: 1 };
  }

  protected override get title(): string {
    return this.ctx.i18n.t('hl');
  }

  protected override brushPicker(): HTMLElement[] {
    return [];
  }

  protected override extraOptions(): HTMLElement[] {
    return [];
  }
}
