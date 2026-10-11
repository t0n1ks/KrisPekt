import type { BrushKind } from '../core/types';
import type { TextKey } from '../i18n/I18n';

/** Translation keys of the brush names. */
export const BRUSH_LABELS: Record<BrushKind, TextKey> = {
  ballpoint: 'brush_ballpoint',
  fountain: 'brush_fountain',
  fineliner: 'brush_fineliner',
  pencil: 'brush_pencil',
  brush: 'brush_brush',
};
