import type { Camera } from '../canvas/Camera';
import type { PageLayout } from '../canvas/PageLayout';
import type { TextLayout } from '../canvas/TextLayout';
import type { CardItem, LinkTarget, Page, Point, ToolKind } from '../core/types';
import { CardRules } from '../domain/CardRules';

/** What is under a stage point: a card, or a linked word. */
export type PressHit =
  | { kind: 'card'; page: Page; card: CardItem; onMenu: boolean }
  | { kind: 'link'; page: Page; link: LinkTarget };

export interface PagePressTargetsDeps {
  camera: Camera;
  layout: PageLayout;
  texts: TextLayout;
  /** The selected tool. */
  tool: () => ToolKind;
  /** Whether a lasso selection is under the point; dragging it comes first. */
  overSelection: (pt: Point) => boolean;
}

/** Finds what a press on the page lands on. It only looks; what happens next is up to the caller. */
export class PagePressTargets {
  constructor(private readonly deps: PagePressTargetsDeps) {}

  /**
   * The card or link under a stage point. The eraser reaches neither: a dab must erase ink, never
   * open a dialog. With the text tool a linked word is text to edit, so only cards count there.
   */
  at(pt: Point): PressHit | null {
    const { camera, layout, texts } = this.deps;
    const tool = this.deps.tool();
    if (tool === 'eraser' || this.deps.overSelection(pt)) return null;
    const world = camera.toWorld(pt.x, pt.y);
    const page = layout.pageAt(world.x, world.y);
    if (!page) return null;
    const local = layout.toPage(page, world);
    if (tool !== 'text') {
      for (const item of [...page.texts].reverse()) {
        const link = texts.linkAt(item, local.x, local.y);
        if (link) return { kind: 'link', page, link };
      }
    }
    const card = [...page.cards].reverse().find((c) => CardRules.contains(c, local.x, local.y));
    if (!card) return null;
    return { kind: 'card', page, card, onMenu: CardRules.inMenuZone(card, local.x, local.y) };
  }

  /** The page under a stage point with the point in page px; for placing a new card. */
  pageAt(pt: Point): { page: Page; local: Point } | null {
    const { camera, layout } = this.deps;
    const world = camera.toWorld(pt.x, pt.y);
    const page = layout.pageAt(world.x, world.y);
    return page ? { page, local: layout.toPage(page, world) } : null;
  }
}
