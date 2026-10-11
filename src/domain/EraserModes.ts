import type { EraserMode } from '../core/types';

/** Pure rules for the eraser modes: pixel eraser (`part`) and stroke eraser (`whole`). */
export class EraserModes {
  /** The other mode: tapping the active eraser switches between the two. */
  static toggle(mode: EraserMode): EraserMode {
    return mode === 'part' ? 'whole' : 'part';
  }

  /**
   * Whether a stylus event comes from its eraser end or eraser button: bit 32 of `buttons`
   * while held, or `button` 5 on the press itself (Pointer Events spec, "eraser button").
   */
  static isStylusEraser(e: { pointerType: string; button: number; buttons: number }): boolean {
    return e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
  }
}
