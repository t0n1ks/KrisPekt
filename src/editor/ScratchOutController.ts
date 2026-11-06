import { MM, SCRATCH_HINT_COUNT, SCRATCH_LEVELS, SCRATCH_MIN_EXTENT_PX } from '../core/constants';
import type { Box, Page, Preferences, ScratchThresholds, Stroke, TextItem } from '../core/types';
import type { LaidGlyph } from '../domain/RichTextLayout';
import { RichText } from '../domain/RichText';
import { ScratchRegion } from '../domain/ScratchRegion';
import { ScratchTargets, type ScratchPlan } from '../domain/ScratchTargets';
import { ScribbleDetector, type ScribbleMetrics } from '../domain/ScribbleDetector';
import { TextBoxRules } from '../domain/TextBoxRules';

export type ScratchDecision = 'off' | 'writing' | 'nothing' | 'erased';

/** How the last pen stroke was judged, for the input diagnostics. */
export interface ScratchReport {
  metrics: ScribbleMetrics;
  limits: ScratchThresholds;
  /** Null when the shape already ruled it out and nothing was looked up. */
  coverage: { hit: number; near: number; best: number } | null;
  decision: ScratchDecision;
}

export interface ScratchOutDeps {
  prefs: Preferences;
  savePrefs(): void;
  strokeBox(stroke: Stroke): Box;
  textBox(item: TextItem): Box;
  richText(item: TextItem): TextItem;
  glyphs(item: TextItem, near: Box): readonly LaidGlyph[];
  naturalWidth(item: TextItem): number;
  /** The id of the text being edited on a page: it is not on the page for now. */
  hiddenTextOn(page: Page): string | null;
  recordUndo(page: Page): void;
  touch(page: Page): void;
  /** Shows what is going away fading out. */
  fade(page: Page, strokes: readonly Stroke[], glyphs: readonly LaidGlyph[]): void;
  report(report: ScratchReport): void;
  hint(): void;
}

/**
 * Scribbling over ink or text deletes it. Runs when a pen stroke ends: first the stroke's shape,
 * which rules out nearly all strokes for next to nothing, and only then the page. It never changes
 * anything unless there is something to delete; otherwise the scribble stays an ordinary stroke.
 */
export class ScratchOutController {
  constructor(private readonly deps: ScratchOutDeps) {}

  /**
   * Judges a finished pen stroke that is not on the page yet. True means that it was a scribble,
   * that what it covered is gone in one undo step, and that the stroke itself must not be added.
   * @param zoom how much the page is enlarged: the smallest scribble is a size on the screen
   */
  tryErase(page: Page, stroke: Stroke, zoom: number): boolean {
    const { prefs } = this.deps;
    const limits = SCRATCH_LEVELS[prefs.scratch.level];
    const metrics = ScribbleDetector.measure(stroke.p);
    const shape = ScribbleDetector.isScribble(metrics, limits, SCRATCH_MIN_EXTENT_PX / zoom);
    if (!prefs.scratch.on || !shape) {
      const decision = prefs.scratch.on ? 'writing' : 'off';
      this.deps.report({ metrics, limits, coverage: null, decision });
      return false;
    }
    const plan = ScratchTargets.plan(
      this.view(page),
      ScratchRegion.around(stroke.p, stroke.s),
      limits.minCoverage,
    );
    const empty = ScratchTargets.isEmpty(plan);
    this.deps.report({
      metrics,
      limits,
      coverage: { hit: plan.strokes.length + plan.texts.length, near: plan.near, best: plan.best },
      decision: empty ? 'nothing' : 'erased',
    });
    if (empty) return false;
    this.erase(page, stroke, plan);
    this.countHint();
    return true;
  }

  private view(page: Page): Parameters<typeof ScratchTargets.plan>[0] {
    const { deps } = this;
    const hidden = deps.hiddenTextOn(page);
    return {
      strokes: page.strokes,
      texts: hidden === null ? page.texts : page.texts.filter((t) => t.id !== hidden),
      strokeBox: (stroke) => deps.strokeBox(stroke),
      textBox: (item) => deps.textBox(item),
      richText: (item) => deps.richText(item),
      glyphs: (item, near) => deps.glyphs(item, near),
    };
  }

  private erase(page: Page, scribble: Stroke, plan: ScratchPlan): void {
    this.deps.recordUndo(page);
    const gone = new Set(plan.strokes);
    page.strokes = page.strokes.filter((stroke) => !gone.has(stroke));
    for (const edit of plan.texts) {
      page.texts = page.texts.flatMap((item) => {
        if (item !== edit.item) return [item];
        return edit.paras ? [this.edited(page, edit.rich, edit.paras)] : [];
      });
    }
    this.deps.touch(page);
    this.deps.fade(
      page,
      [...plan.strokes, scribble],
      plan.texts.flatMap((edit) => edit.gone),
    );
  }

  /** A new item, never a change to the old one: undo steps share items. */
  private edited(page: Page, rich: TextItem, paras: NonNullable<TextItem['paras']>): TextItem {
    const item: TextItem = { ...rich, paras, t: RichText.plainText(paras) };
    if (!item.auto) return item;
    const bounds = { width: page.w * MM, height: page.h * MM };
    return { ...item, w: TextBoxRules.autoWidth(this.deps.naturalWidth(item), item.x, item.fs, bounds) };
  }

  private countHint(): void {
    const { prefs } = this.deps;
    if (prefs.scratch.hints >= SCRATCH_HINT_COUNT) return;
    prefs.scratch.hints++;
    this.deps.savePrefs();
    this.deps.hint();
  }
}
