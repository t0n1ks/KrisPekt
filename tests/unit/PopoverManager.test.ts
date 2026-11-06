// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/app/EventBus';
import { PopoverPlacement } from '../../src/domain/PopoverPlacement';
import { Menu } from '../../src/ui/dialogs/Menu';
import { PopoverManager, type PopoverHandle } from '../../src/ui/dialogs/PopoverManager';

const VIEW = { left: 0, top: 0, width: 400, height: 600 };

function press(target: Element): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
}

function setup(): { bus: EventBus; popovers: PopoverManager; menu: Menu; button: HTMLButtonElement } {
  const bus = new EventBus();
  const popovers = new PopoverManager(document, bus);
  const button = document.createElement('button');
  document.body.append(button);
  return { bus, popovers, menu: new Menu(popovers), button };
}

/** What a tap on the button does: the press first, then the click that opens or closes the menu. */
function tap(button: HTMLButtonElement, menu: Menu): void {
  press(button);
  menu.show(button, [{ label: 'Item', onClick: () => undefined }]);
}

const openMenus = (): number => document.querySelectorAll('.menu').length;

afterEach(() => {
  document.body.replaceChildren();
});

describe('a menu and the button that opens it', () => {
  it('opens on the first tap and closes on the second, without opening again', () => {
    const { menu, button } = setup();
    tap(button, menu);
    expect(openMenus()).toBe(1);
    tap(button, menu);
    expect(openMenus()).toBe(0);
    expect(menu.isOpen).toBe(false);
    tap(button, menu);
    expect(openMenus()).toBe(1);
  });

  it('counts a press on the icon inside the button as a press on the button', () => {
    const { menu, button } = setup();
    const inner = document.createElement('span');
    button.append(inner);
    tap(button, menu);
    press(inner);
    expect(openMenus()).toBe(1);
  });

  it('closes on a press outside, but not on a press inside', () => {
    const { menu, button } = setup();
    tap(button, menu);
    press(document.querySelector('.menu__item') as Element);
    expect(openMenus()).toBe(1);
    press(document.body);
    expect(openMenus()).toBe(0);
  });

  it('closes on Escape, which then reaches nothing else', () => {
    const { menu, button } = setup();
    const behind = vi.fn();
    document.body.addEventListener('keydown', behind);
    tap(button, menu);
    pressEscape();
    expect(openMenus()).toBe(0);
    expect(behind).not.toHaveBeenCalled();
    pressEscape();
    expect(behind).toHaveBeenCalledOnce();
  });

  it('opening from another button replaces the menu', () => {
    const { menu, button } = setup();
    const other = document.createElement('button');
    document.body.append(other);
    tap(button, menu);
    press(other);
    menu.show(other, [{ label: 'Other', onClick: () => undefined }]);
    expect(openMenus()).toBe(1);
    expect(document.querySelector('.menu__item')?.textContent).toBe('Other');
  });

  it('an item may open another menu at the same button', () => {
    const { menu, button } = setup();
    menu.show(button, [
      { label: 'Item', onClick: () => menu.show(button, [{ label: 'Second', onClick: () => undefined }]) },
    ]);
    const item = document.querySelector('.menu__item') as HTMLElement;
    press(item);
    item.click();
    expect(document.querySelector('.menu__item')?.textContent).toBe('Second');
  });

  it('closes when a sheet opens', () => {
    const { bus, menu, button } = setup();
    tap(button, menu);
    bus.emit('menu-opened', undefined);
    expect(openMenus()).toBe(0);
  });
});

describe('PopoverManager', () => {
  const handle = (inside = false, trigger = false): PopoverHandle & { closes: number } => {
    const self = {
      closes: 0,
      contains: () => inside,
      isTrigger: () => trigger,
      close: (): void => undefined,
    };
    return self;
  };

  it('keeps one thing open at a time', () => {
    const popovers = new PopoverManager(document, new EventBus());
    const first = handle();
    first.close = () => {
      first.closes++;
      popovers.closed(first);
    };
    popovers.opened(first);
    popovers.opened(handle());
    expect(first.closes).toBe(1);
    expect(popovers.isOpen).toBe(true);
  });

  it('stops listening once nothing is open', () => {
    const popovers = new PopoverManager(document, new EventBus());
    const only = handle();
    only.close = () => {
      only.closes++;
      popovers.closed(only);
    };
    popovers.opened(only);
    press(document.body);
    press(document.body);
    expect(only.closes).toBe(1);
    expect(popovers.isOpen).toBe(false);
  });

  it('something closed out of turn does not close what is open now', () => {
    const popovers = new PopoverManager(document, new EventBus());
    const open = handle();
    popovers.opened(open);
    popovers.closed(handle());
    expect(popovers.isOpen).toBe(true);
  });
});

describe('PopoverPlacement', () => {
  const size = { w: 200, h: 300 };

  it('hangs below its button, right-aligned', () => {
    const at = PopoverPlacement.anchored({ left: 300, top: 10, right: 340, bottom: 50 }, size, VIEW);
    expect(at).toEqual({ x: 140, y: 56 });
  });

  it('flips above when it only fits there', () => {
    const at = PopoverPlacement.anchored({ left: 300, top: 500, right: 340, bottom: 540 }, size, VIEW);
    expect(at.y).toBe(194);
  });

  it('shifts onto the screen when it fits on neither side', () => {
    const tall = { w: 200, h: 500 };
    const at = PopoverPlacement.anchored({ left: 0, top: 280, right: 40, bottom: 320 }, tall, VIEW);
    expect(at.x).toBe(8);
    expect(at.y).toBeGreaterThanOrEqual(8);
    expect(at.y + tall.h).toBeLessThanOrEqual(592);
  });

  it('stays inside what the on-screen keyboard leaves', () => {
    const view = { left: 0, top: 0, width: 400, height: 300 };
    const at = PopoverPlacement.anchored(
      { left: 300, top: 250, right: 340, bottom: 290 },
      { w: 200, h: 100 },
      view,
    );
    expect(at.y + 100).toBeLessThanOrEqual(292);
  });

  it('makes a large menu on a narrow screen a bottom sheet', () => {
    expect(PopoverPlacement.isSheet(500, VIEW, false)).toBe(true);
    expect(PopoverPlacement.isSheet(200, VIEW, false)).toBe(false);
    expect(PopoverPlacement.isSheet(200, VIEW, true)).toBe(true);
    expect(PopoverPlacement.isSheet(500, { ...VIEW, width: 800 }, true)).toBe(false);
    expect(PopoverPlacement.sheet(200, VIEW)).toEqual({ x: 0, y: 400 });
  });

  it('never asks for more height than the screen has', () => {
    expect(PopoverPlacement.maxHeight(VIEW)).toBe(584);
    expect(PopoverPlacement.maxHeight({ ...VIEW, height: 4 })).toBe(0);
  });
});
