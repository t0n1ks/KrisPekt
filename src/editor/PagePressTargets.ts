import type { Camera } from '../canvas/Camera';
import type { PageLayout } from '../canvas/PageLayout';
import type { LinkGeometry } from '../canvas/LinkGeometry';
import type { TextLayout } from '../canvas/TextLayout';
import type {
  Anchor,
  Box,
  CardItem,
  InkLink,
  LinkTarget,
  Page,
  Point,
  TextItem,
  ToolKind,
} from '../core/types';
import { CardRules } from '../domain/CardRules';

/** What is under a stage point: a card, a bookmark's marker, or a linked word. */
export type PressHit =
  | { kind: 'card'; page: Page; card: CardItem; onMenu: boolean }
  | { kind: 'anchor'; page: Page; anchor: Anchor }
  | LinkHit;

/** A link under a press, and what carries it: a word in a text box, or ink. */
export type LinkHit = { kind: 'link'; page: Page; link: LinkTarget } & (
  { item: TextItem; ink?: undefined } | { ink: InkLink; item?: undefined }
);

/** How far around linked ink a press still counts, in page px; handwriting is thin to hit. */
const INK_LINK_REACH = 6;
/** A marker is tiny on paper; this many screen px around its middle still press it, at any zoom. */
const MARKER_REACH = 22;

export interface PagePressTargetsDeps {
  camera: Camera;
  layout: PageLayout;
  texts: TextLayout;
  geometry: Pick<LinkGeometry, 'inkBox' | 'markerBox' | 'anchorBox'>;
  /** Whether bookmark markers are shown; one that cannot be seen cannot be pressed. */
  markersOn: () => boolean;
  /** The selected tool. */
  tool: () => ToolKind;
  /** Whether a lasso selection is under the point; dragging it comes first. */
  overSelection: (pt: Point) => boolean;
}

/** Finds what a press on the page lands on. It only looks; what happens next is up to the caller. */
export class PagePressTargets {
  constructor(private readonly deps: PagePressTargetsDeps) {}

  /**
   * The card, marker or link under a stage point; who may open them is for `ToolRules`. With the
   * text tool a linked word is text to edit, so it does not count there. The area around a marker
   * comes last, so that it never takes a press from what is there.
   */
  at(pt: Point): PressHit | null {
    const { camera, layout, texts } = this.deps;
    const tool = this.deps.tool();
    if (this.deps.overSelection(pt)) return null;
    const world = camera.toWorld(pt.x, pt.y);
    const page = layout.pageAt(world.x, world.y);
    if (!page) return null;
    const local = layout.toPage(page, world);
    const onMarker = this.markerAt(page, local, false);
    if (onMarker) return { kind: 'anchor', page, anchor: onMarker };
    if (tool !== 'text') {
      for (const item of [...page.texts].reverse()) {
        const link = texts.linkAt(item, local.x, local.y);
        if (link) return { kind: 'link', page, link, item };
      }
      const ink = this.inkLinkAt(page, local);
      if (ink) return { kind: 'link', page, link: ink.link, ink };
    }
    const card = [...page.cards].reverse().find((c) => CardRules.contains(c, local.x, local.y));
    if (card) return { kind: 'card', page, card, onMenu: CardRules.inMenuZone(card, local.x, local.y) };
    const nearMarker = this.markerAt(page, local, true);
    return nearMarker ? { kind: 'anchor', page, anchor: nearMarker } : null;
  }

  /** The marker at a point; `near` also takes the finger-sized area around it, but not its text. */
  private markerAt(page: Page, local: Point, near: boolean): Anchor | null {
    if (!this.deps.markersOn()) return null;
    const { geometry } = this.deps;
    const reach = near ? MARKER_REACH / this.deps.camera.z : 0;
    for (const anchor of [...page.anchors].reverse()) {
      const box = geometry.markerBox(page, anchor);
      const insideX = Math.abs(local.x - (box.x0 + box.x1) / 2) <= Math.max((box.x1 - box.x0) / 2, reach);
      const insideY = Math.abs(local.y - (box.y0 + box.y1) / 2) <= Math.max((box.y1 - box.y0) / 2, reach);
      if (!insideX || !insideY) continue;
      if (near && anchor.items.length && PagePressTargets.inside(geometry.anchorBox(page, anchor), local)) {
        continue;
      }
      return anchor;
    }
    return null;
  }

  private static inside(box: Box, at: Point): boolean {
    return at.x >= box.x0 && at.x <= box.x1 && at.y >= box.y0 && at.y <= box.y1;
  }

  private inkLinkAt(page: Page, local: Point): InkLink | null {
    for (const ink of [...page.inkLinks].reverse()) {
      const box = this.deps.geometry.inkBox(page, ink);
      const inside =
        local.x >= box.x0 - INK_LINK_REACH &&
        local.x <= box.x1 + INK_LINK_REACH &&
        local.y >= box.y0 - INK_LINK_REACH &&
        local.y <= box.y1 + INK_LINK_REACH;
      if (inside) return ink;
    }
    return null;
  }

  /** The page under a stage point with the point in page px; for placing a new card. */
  pageAt(pt: Point): { page: Page; local: Point } | null {
    const { camera, layout } = this.deps;
    const world = camera.toWorld(pt.x, pt.y);
    const page = layout.pageAt(world.x, world.y);
    return page ? { page, local: layout.toPage(page, world) } : null;
  }
}
