import type { Box, Stroke, TextItem, TextParagraph } from '../core/types';
import { RichText } from './RichText';
import type { LaidGlyph } from './RichTextLayout';
import type { ScratchRegion } from './ScratchRegion';
import { TextErasure, type TextRange } from './TextErasure';

/** What selection needs to know about a page; the app passes its caches in. */
export interface ScratchPageView {
  strokes: readonly Stroke[];
  texts: readonly TextItem[];
  strokeBox(stroke: Stroke): Box;
  textBox(item: TextItem): Box;
  /** The item as rich text, in the place it is drawn. */
  richText(item: TextItem): TextItem;
  /** The item's characters that could touch a box, in page coordinates. */
  glyphs(item: TextItem, near: Box): readonly LaidGlyph[];
}

/** How a text box changes; `paras` is null when nothing is left of it. */
export interface TextEdit {
  item: TextItem;
  rich: TextItem;
  paras: TextParagraph[] | null;
  /** The characters that go, for the fade-out. */
  gone: LaidGlyph[];
}

/** What a scribble takes away. Images and page backgrounds are never in here. */
export interface ScratchPlan {
  strokes: Stroke[];
  texts: TextEdit[];
  /** How many strokes and characters were within reach, and the best share covered. */
  near: number;
  best: number;
}

/** Selects what a scribble covers. Pure, and fast: a bounding box rules out most of a page. */
export class ScratchTargets {
  /**
   * @param minCoverage the share of a stroke's length, or of a character's box, to be covered.
   *   Anything less stays, such as a long underline that the scribble only touches.
   */
  static plan(view: ScratchPageView, region: ScratchRegion, minCoverage: number): ScratchPlan {
    const plan: ScratchPlan = { strokes: [], texts: [], near: 0, best: 0 };
    for (const stroke of view.strokes) {
      const bounds = view.strokeBox(stroke);
      if (!region.overlaps(bounds)) continue;
      const coverage = region.strokeCoverage(stroke.p, bounds);
      plan.near++;
      plan.best = Math.max(plan.best, coverage);
      if (coverage >= minCoverage) plan.strokes.push(stroke);
    }
    for (const item of view.texts) {
      if (!region.overlaps(view.textBox(item))) continue;
      const edit = ScratchTargets.textEdit(view, item, region, minCoverage, plan);
      if (edit) plan.texts.push(edit);
    }
    return plan;
  }

  /** Whether there is anything to take away. */
  static isEmpty(plan: ScratchPlan): boolean {
    return !plan.strokes.length && !plan.texts.length;
  }

  private static textEdit(
    view: ScratchPageView,
    item: TextItem,
    region: ScratchRegion,
    minCoverage: number,
    plan: ScratchPlan,
  ): TextEdit | null {
    const rich = view.richText(item);
    const covered: LaidGlyph[] = [];
    const glyphs = view.glyphs(rich, region.box).filter((glyph) => glyph.text.trim());
    for (const glyph of glyphs) {
      const coverage = region.boxCoverage(glyph);
      plan.near++;
      plan.best = Math.max(plan.best, coverage);
      if (coverage >= minCoverage) covered.push(glyph);
    }
    if (!covered.length) return null;
    const source = RichText.paragraphsOf(rich);
    const text = RichText.plainText(source);
    const cuts = TextErasure.ranges(
      text,
      covered.map((glyph): TextRange => [glyph.start, glyph.end]),
    );
    const paras = TextErasure.removed(source, cuts);
    const gone = view
      .glyphs(rich, view.textBox(rich))
      .filter((glyph) => cuts.some(([a, b]) => glyph.start >= a && glyph.end <= b));
    return { item, rich, paras: RichText.isBlank(paras) ? null : paras, gone };
  }
}
