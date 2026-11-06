import type { EventBus } from '../../app/EventBus';

/** What the manager needs to know about something it keeps open. */
export interface PopoverHandle {
  /** Whether a node is part of the popover itself. */
  contains(target: Node): boolean;
  /** Whether a node is on the button that opened it. */
  isTrigger(target: Node): boolean;
  /** Takes it off the screen and calls {@link PopoverManager.closed}. */
  close(): void;
}

/**
 * The rules that every menu and popover shares: one is open at a time, a press outside or Escape
 * closes it, and any sheet opening closes it.
 *
 * A press on the button that opened it is left alone. Closing on that press would make the click
 * that follows open it again, so the button could never close its own menu and the menu would only
 * flicker. That click is what decides, through the owner's toggle.
 */
export class PopoverManager {
  private current: PopoverHandle | null = null;

  private readonly onPress = (e: Event): void => {
    const { current } = this;
    if (!current || !(e.target instanceof Node)) return;
    if (!current.contains(e.target) && !current.isTrigger(e.target)) current.close();
  };

  // Stopped here so that one Escape closes one thing: not the sheet under the menu as well.
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.current) return;
    e.preventDefault();
    e.stopPropagation();
    this.current.close();
  };

  constructor(
    private readonly target: Pick<Document, 'addEventListener' | 'removeEventListener'>,
    bus: EventBus,
  ) {
    bus.on('menu-opened', () => this.closeCurrent());
  }

  /** Whether anything is open. */
  get isOpen(): boolean {
    return this.current !== null;
  }

  /** Records what was just opened, and closes what was open before it. */
  opened(handle: PopoverHandle): void {
    if (this.current !== handle) this.closeCurrent();
    if (!this.current) {
      this.target.addEventListener('pointerdown', this.onPress as EventListener, true);
      this.target.addEventListener('keydown', this.onKey as EventListener, true);
    }
    this.current = handle;
  }

  /** Forgets something that has closed; closing something else's turn changes nothing. */
  closed(handle: PopoverHandle): void {
    if (this.current !== handle) return;
    this.current = null;
    this.target.removeEventListener('pointerdown', this.onPress as EventListener, true);
    this.target.removeEventListener('keydown', this.onKey as EventListener, true);
  }

  /** Closes whatever is open. */
  closeCurrent(): void {
    this.current?.close();
  }
}
