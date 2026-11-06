import type { Anchor, Box, InkLink, LinkTarget, Page, PageRect, TextItem } from '../core/types';
import { LinkRules } from './LinkRules';

/** What anchors and ink links are bound to. */
type Binding = Anchor | InkLink;

/** Where bound items are now; null when they cannot be measured. */
export type BindingArea = (items: readonly string[], binding: Binding) => Box | null;

/** Coordinates differing by less than this are the same place; stored rects need no finer. */
const RECT_PRECISION = 0.01;

function rectOf(box: Box): PageRect {
  return { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 };
}

function sameRect(a: PageRect, b: PageRect): boolean {
  return (
    Math.abs(a.x - b.x) < RECT_PRECISION &&
    Math.abs(a.y - b.y) < RECT_PRECISION &&
    Math.abs(a.w - b.w) < RECT_PRECISION &&
    Math.abs(a.h - b.h) < RECT_PRECISION
  );
}

/**
 * Keeps anchors and ink links true to the items they are bound to. Like items, they are replaced
 * and never changed in place, because undo snapshots share them. Bindings live on the page, so an
 * undo step that restores the page restores them with it. Pure.
 */
export class ItemBindings {
  /**
   * Brings a page's bindings in line with its items, after any change to them: items that are gone
   * are forgotten, a binding with no item left goes with its last one, and the stored rect follows
   * the items. An anchor without items stands for the whole page and always stays.
   */
  static reconcile(page: Page, exists: (id: string) => boolean, area: BindingArea): void {
    const keep = <T extends Binding>(list: T[], allowEmpty: boolean): T[] => {
      let changed = false;
      const kept: T[] = [];
      for (const binding of list) {
        const next = ItemBindings.reconciled(binding, exists, area, allowEmpty);
        if (next !== binding) changed = true;
        if (next) kept.push(next);
      }
      return changed ? kept : list;
    };
    page.anchors = keep(page.anchors, true);
    page.inkLinks = keep(page.inkLinks, false);
  }

  private static reconciled<T extends Binding>(
    binding: T,
    exists: (id: string) => boolean,
    area: BindingArea,
    allowEmpty: boolean,
  ): T | null {
    if (!binding.items.length) return allowEmpty ? binding : null;
    const items = binding.items.filter(exists);
    if (!items.length) return null;
    const box = area(items, binding);
    const rect = box ? rectOf(box) : binding.rect;
    if (items.length === binding.items.length && sameRect(rect, binding.rect)) return binding;
    return { ...binding, items, rect };
  }

  /**
   * Moves the bindings whose items all moved to another page. One left with some of its items
   * stays and follows those; {@link reconcile} then forgets the others.
   */
  static carry(source: Page, target: Page, moved: ReadonlySet<string>): void {
    const goes = (binding: Binding): boolean =>
      binding.items.length > 0 && binding.items.every((id) => moved.has(id));
    target.anchors = [...target.anchors, ...source.anchors.filter(goes)];
    target.inkLinks = [...target.inkLinks, ...source.inkLinks.filter(goes)];
    source.anchors = source.anchors.filter((binding) => !goes(binding));
    source.inkLinks = source.inkLinks.filter((binding) => !goes(binding));
  }

  /** A stroke cut by the eraser becomes new strokes, and what was bound to it follows them. */
  static replaceItem(page: Page, oldId: string, newIds: readonly string[]): void {
    const replaced = <T extends Binding>(list: T[]): T[] =>
      list.some((binding) => binding.items.includes(oldId))
        ? list.map((binding) =>
            binding.items.includes(oldId)
              ? { ...binding, items: binding.items.flatMap((id) => (id === oldId ? [...newIds] : [id])) }
              : binding,
          )
        : list;
    page.anchors = replaced(page.anchors);
    page.inkLinks = replaced(page.inkLinks);
  }

  /** Copies of ink links whose items were all copied, bound to the copies. */
  static copiedInkLinks(
    links: readonly InkLink[],
    copies: ReadonlyMap<string, string>,
    makeId: () => string,
  ): InkLink[] {
    return links
      .filter((link) => link.items.length > 0 && link.items.every((id) => copies.has(id)))
      .map((link) => ({
        ...link,
        id: makeId(),
        items: link.items.map((id) => copies.get(id) ?? id),
      }));
  }

  /**
   * The bindings of a page's copy. Anchors get new ids, so links keep leading to the original, and
   * are bound to the copied items.
   */
  static copiedAnchors(
    anchors: readonly Anchor[],
    copies: ReadonlyMap<string, string>,
    makeId: () => string,
  ): Anchor[] {
    return anchors.map((anchor) => ({
      ...anchor,
      id: makeId(),
      items: anchor.items.map((id) => copies.get(id) ?? id),
    }));
  }

  /** Whether a page shows a link that leads inside the app: its look depends on the target. */
  static hasInternalLinks(page: Page): boolean {
    return (
      page.inkLinks.some((ink) => LinkRules.isInternal(ink.link)) ||
      page.texts.some((item) => ItemBindings.textLinks(item).some(LinkRules.isInternal))
    );
  }

  private static textLinks(item: TextItem): LinkTarget[] {
    return (item.paras ?? []).flatMap((para) => para.runs.flatMap((run) => (run.link ? [run.link] : [])));
  }
}
