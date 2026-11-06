import type { Camera } from '../../canvas/Camera';
import type { LinkGeometry } from '../../canvas/LinkGeometry';
import type { PageLayout } from '../../canvas/PageLayout';
import type { InternalLink, Notebook, Page } from '../../core/types';
import { byId, replaceChildren, el } from '../../core/utils/dom';
import type { LinkDirectory } from '../../domain/LinkDirectory';
import { NavigationStack, type NavigationSpot } from '../../domain/NavigationStack';
import type { EditorSession } from '../../editor/EditorSession';
import type { Viewport } from '../../editor/Viewport';
import type { I18n } from '../../i18n/I18n';
import { SystemBackGuard, type BackHistory } from '../../input/SystemBackGuard';
import { icon } from '../icons';
import { TargetHighlight } from './TargetHighlight';

export interface LinkNavigatorDeps {
  session: EditorSession;
  camera: Camera;
  layout: PageLayout;
  viewport: Viewport;
  geometry: Pick<LinkGeometry, 'anchorBox' | 'pageBox'>;
  directory: LinkDirectory;
  i18n: I18n;
  /** Opens another notebook in the editor; false if it could not be loaded. */
  switchTo: (nb: Notebook) => Promise<boolean>;
  /** Finishes text editing and clears the selection. */
  settle: () => void;
  /** A dialog or the PDF viewer is up. */
  blocked: () => boolean;
  toast: (message: string) => void;
  history: BackHistory;
  events: Pick<EventTarget, 'addEventListener'>;
}

/**
 * Following internal links: going to the place, showing it, and coming back to exactly where the
 * jump started. Only `switchTo` and scrolling move the view, so a locked zoom stays locked.
 */
export class LinkNavigator {
  private readonly stack = new NavigationStack();
  private readonly chip = byId<HTMLButtonElement>('backChip');
  private readonly highlight: TargetHighlight;
  private readonly guard: SystemBackGuard;
  private busy = false;

  constructor(private readonly deps: LinkNavigatorDeps) {
    this.highlight = new TargetHighlight(deps.camera, deps.layout);
    this.guard = new SystemBackGuard({
      history: deps.history,
      events: deps.events,
      hasSteps: () => this.stack.size > 0,
      goBack: () => void this.back(),
      blocked: deps.blocked,
    });
    this.chip.addEventListener('click', () => void this.back());
    this.applyLanguage();
  }

  /** Goes to a place in the notes. False if it no longer exists; nothing has moved then. */
  async go(link: InternalLink): Promise<boolean> {
    const found = this.deps.directory.resolve(link);
    if (!found) return false;
    if (this.busy) return true;
    this.busy = true;
    try {
      const here = this.spot();
      this.deps.settle();
      if (this.deps.session.notebook !== found.nb && !(await this.deps.switchTo(found.nb))) {
        this.deps.toast(this.deps.i18n.t('linkOpenFail'));
        return true;
      }
      if (here) this.stack.push(here);
      this.land(link);
      this.stepsChanged();
    } finally {
      this.busy = false;
    }
    return true;
  }

  /** Returns to where the last jump started. */
  async back(): Promise<void> {
    if (this.busy) {
      // The system back button used up its history entry; it must have one for next time.
      this.guard.sync();
      return;
    }
    const spot = this.stack.pop();
    if (!spot) return;
    this.busy = true;
    try {
      this.deps.settle();
      this.highlight.hide();
      await this.restore(spot);
    } finally {
      this.busy = false;
      this.stepsChanged();
    }
  }

  /** Leaving for the shelf ends the trail. */
  reset(): void {
    this.stack.clear();
    this.highlight.hide();
    this.stepsChanged();
  }

  /** Follows the camera; runs on every frame. */
  position(): void {
    this.highlight.position();
  }

  applyLanguage(): void {
    const label = this.deps.i18n.t('navBack');
    this.chip.setAttribute('aria-label', label);
    replaceChildren(this.chip, icon('back', 16), el('span', null, label));
  }

  private stepsChanged(): void {
    this.chip.hidden = this.stack.size === 0;
    this.guard.sync();
  }

  private spot(): NavigationSpot | null {
    const { session, camera, layout } = this.deps;
    const nb = session.notebook;
    if (!nb) return null;
    const page = session.currentPage();
    return {
      nbId: nb.id,
      pageId: page?.id ?? null,
      dy: page ? camera.y - layout.pos(page).y : camera.y,
      x: camera.x,
      z: camera.z,
    };
  }

  private land(link: InternalLink): void {
    const { session, viewport, geometry } = this.deps;
    const first = session.pages[0];
    if (link.kind === 'notebook') {
      if (first) viewport.scrollTo(first);
      return;
    }
    const anchor = link.kind === 'anchor' ? this.findAnchor(link.id) : null;
    const page = anchor?.page ?? session.find(link.id);
    if (!page) return;
    const area = anchor ? geometry.anchorBox(page, anchor.anchor) : geometry.pageBox(page);
    if (anchor?.anchor.items.length) viewport.reveal(page, area);
    else viewport.scrollTo(page);
    this.highlight.show(page, area);
  }

  private findAnchor(id: string): { page: Page; anchor: Page['anchors'][number] } | null {
    for (const page of this.deps.session.pages) {
      const anchor = page.anchors.find((a) => a.id === id);
      if (anchor) return { page, anchor };
    }
    return null;
  }

  private async restore(spot: NavigationSpot): Promise<void> {
    const { session, directory, viewport, i18n } = this.deps;
    const found = directory.resolve({ kind: 'notebook', nb: spot.nbId });
    if (!found) {
      this.deps.toast(i18n.t('linkBrokenTitle'));
      return;
    }
    if (session.notebook !== found.nb && !(await this.deps.switchTo(found.nb))) {
      this.deps.toast(i18n.t('linkOpenFail'));
      return;
    }
    const page = (spot.pageId && session.find(spot.pageId)) || session.pages[0];
    if (page) viewport.showAt(page, spot);
  }
}
