import type { Camera } from '../../canvas/Camera';
import { ZOOM_LOCK_HINT_MS } from '../../core/constants';
import type { Notebook } from '../../core/types';
import { formatZoom } from '../../core/utils/format';
import { now } from '../../core/utils/math';
import type { Viewport } from '../../editor/Viewport';
import type { I18n } from '../../i18n/I18n';
import type { MenuEntry, MenuItem } from '../dialogs/Menu';

export interface ZoomMenuDeps {
  camera: Camera;
  viewport: Pick<Viewport, 'fitWidth' | 'zoomTo'>;
  i18n: I18n;
  /** The open notebook, which keeps the lock. */
  notebook: () => Notebook;
  /** Queues the notebook for saving. */
  markDirty: () => void;
  /** Redraws, which also updates the zoom pill. */
  redraw: () => void;
  toast: (message: string) => void;
}

/**
 * The zoom pill's menu and the notebook's zoom lock.
 *
 * While the zoom is locked the presets are disabled rather than unlocking first: a lock that a
 * stray tap can undo would not be worth much, so unlocking always takes its own explicit step.
 */
export class ZoomMenu {
  private lastHint = -Infinity;

  constructor(private readonly deps: ZoomMenuDeps) {}

  /** The current value, the presets and the lock toggle. */
  entries(): MenuEntry[] {
    const { camera, viewport, i18n } = this.deps;
    const locked = camera.zoomLocked;
    return [
      { label: i18n.t('zoomCurrent', { v: formatZoom(camera.z) }), disabled: true, onClick: () => undefined },
      '-',
      { label: i18n.t('fitWidth'), disabled: locked, onClick: () => viewport.fitWidth() },
      { label: formatZoom(1), disabled: locked, onClick: () => viewport.zoomTo(1) },
      '-',
      this.lockEntry(),
    ];
  }

  /** "Lock zoom" or "Unlock zoom", whichever applies. */
  lockEntry(): MenuItem {
    const locked = this.deps.camera.zoomLocked;
    return {
      label: this.deps.i18n.t(locked ? 'zoomUnlock' : 'zoomLock'),
      icon: locked ? 'unlock' : 'lock',
      onClick: () => this.toggleLock(),
    };
  }

  /** Locks at the current zoom, or unlocks; saved with the notebook. */
  toggleLock(): void {
    const { camera, i18n, toast } = this.deps;
    const nb = this.deps.notebook();
    if (camera.zoomLocked) {
      camera.setZoomLock(null);
      delete nb.zoomLock;
      toast(i18n.t('zoomUnlocked'));
    } else {
      camera.setZoomLock(camera.z);
      nb.zoomLock = camera.z;
      toast(i18n.t('zoomLockedAt', { v: formatZoom(camera.z) }));
    }
    this.deps.markDirty();
    this.deps.redraw();
  }

  /** Says why a gesture did not zoom; at most once every few seconds, so it never nags. */
  showBlockedHint(time = now()): void {
    if (time - this.lastHint < ZOOM_LOCK_HINT_MS) return;
    this.lastHint = time;
    const { camera, i18n, toast } = this.deps;
    toast(i18n.t('zoomLockedAt', { v: formatZoom(camera.z) }));
  }
}
