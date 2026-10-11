import { HL_COLORS } from '../core/constants';
import type { PenPrefs, StrokeKind } from '../core/types';
import { PenTool } from './PenTool';

/** A wide translucent marker; same input handling as the pen, its own colours and sizes. */
export class HighlighterTool extends PenTool {
  override readonly kind: StrokeKind = 'hl';

  protected override get settings(): PenPrefs {
    return this.ctx.prefs.hl;
  }

  protected override get palette(): readonly string[] {
    return HL_COLORS;
  }

  protected override get sizeRange(): { min: string; max: string; step: string } {
    return { min: '6', max: '40', step: '1' };
  }

  protected override get title(): string {
    return this.ctx.i18n.t('hl');
  }

  protected override extraOptions(): HTMLElement[] {
    return [];
  }
}
