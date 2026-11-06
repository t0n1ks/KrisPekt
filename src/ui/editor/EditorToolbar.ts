import type { EventBus } from '../../app/EventBus';
import type { Preferences, ToolKind, ToolbarPrefs } from '../../core/types';
import { el } from '../../core/utils/dom';
import { ColorLists } from '../../domain/ColorLists';
import { ToolbarLayout } from '../../domain/ToolbarLayout';
import { ToolPresets } from '../../domain/ToolPresets';
import type { ToolPresetController } from '../../editor/ToolPresetController';
import type { I18n } from '../../i18n/I18n';
import type { Tool } from '../../tools/Tool';
import type { ToolManager } from '../../tools/ToolManager';
import type { Menu } from '../dialogs/Menu';
import type { Toast } from '../dialogs/Toast';
import { icon } from '../icons';
import { ToolbarCustomizer } from './ToolbarCustomizer';
import { ToolbarItemFactory, type ToolbarState } from './ToolbarItemFactory';
import type { ToolOptionsPopover } from './ToolOptionsPopover';
import { ToolTray } from './ToolTray';

export interface EditorToolbarDeps {
  stage: HTMLElement;
  i18n: I18n;
  menu: Menu;
  toast: Toast;
  bus: EventBus;
  prefs: Preferences;
  savePrefs: () => void;
  presets: ToolPresetController;
  tools: () => ToolManager;
  popover: () => ToolOptionsPopover;
  /** Selects a tool, settling a text box or a selection first. */
  setTool: (kind: ToolKind) => void;
  rulerOn: () => boolean;
  toggleRuler: () => void;
  insertPhoto: () => void;
  undo: () => void;
  redo: () => void;
}

/**
 * The toolbar's behaviour: what a tap on a tool or a preset does, pinning, and customise mode.
 *
 * The re-tap rule, for base tools and presets alike: a tap on what is not in use selects it. A
 * tap on what is in use opens its settings, except the eraser, where it switches the mode, as it
 * always has. A long press opens the settings of a base tool and the Edit, Duplicate and Unpin
 * menu of a preset.
 */
export class EditorToolbar {
  private readonly items: ToolbarItemFactory;
  private readonly tray: ToolTray;
  private readonly customizer: ToolbarCustomizer;
  private readonly offChanged: () => void;
  private canUndo = false;
  private canRedo = false;

  constructor(private readonly deps: EditorToolbarDeps) {
    this.items = new ToolbarItemFactory(deps.i18n, {
      tool: (kind, button) => this.onToolTap(kind, button),
      toolOptions: (kind) => this.openToolOptions(kind),
      preset: (id, button) => this.onPresetTap(id, button),
      presetMenu: (id, button) => this.openPresetMenu(id, button),
      swatch: (color) => this.onSwatch(color),
      swatchMenu: (index, button) => this.openSwatchMenu(index, button),
      ruler: () => deps.toggleRuler(),
      image: () => deps.insertPhoto(),
      undo: () => deps.undo(),
      redo: () => deps.redo(),
    });
    this.tray = new ToolTray(deps.i18n, deps.menu, this.items, () => this.openCustomizer());
    this.customizer = new ToolbarCustomizer(deps.stage, deps.i18n, deps.menu, this.items, {
      state: () => this.state(),
      layout: () => this.layout(),
      setLayout: (layout) => this.setLayout(layout),
      reset: () => this.setLayout(ToolbarLayout.defaults(this.deps.presets.presets)),
      addPreset: (tool, brush) => {
        if (this.deps.presets.add(tool, brush)) this.changed();
      },
    });
    this.offChanged = deps.bus.on('toolbar-changed', () => this.render());
  }

  /** Shows the current tool, settings and layout. */
  render(): void {
    this.tray.render(this.state(), this.layout());
    this.customizer.update();
  }

  setUndoState(canUndo: boolean, canRedo: boolean): void {
    this.canUndo = canUndo;
    this.canRedo = canRedo;
    this.tray.setUndoState(canUndo, canRedo);
  }

  /** The selected tool changed. */
  toolChanged(tool: Tool): void {
    this.deps.presets.toolChanged(tool.kind);
    this.render();
  }

  rect(): DOMRect {
    return this.tray.rect();
  }

  /** Opens customise mode. */
  openCustomizer(): void {
    this.deps.popover().close();
    this.deps.menu.close();
    this.customizer.open();
  }

  /** Closes customise mode; true if it was open. */
  closeCustomizer(): boolean {
    if (!this.customizer.isOpen) return false;
    this.customizer.close();
    return true;
  }

  /**
   * The Pin or Unpin button at the bottom of a tool's options, or null for a tool with nothing
   * to pin.
   */
  pinControl(tool: Tool): HTMLElement | null {
    if (!ToolPresets.isPinnable(tool.kind)) return null;
    const active = this.deps.presets.active;
    const label = this.deps.i18n.t(active ? 'presetUnpin' : 'presetPin');
    return el(
      'button',
      {
        class: 'btn popover__pin',
        attrs: { type: 'button' },
        on: { click: () => (active ? this.unpin(active.id) : this.pinCurrent(tool)) },
      },
      icon(active ? 'unpin' : 'pin', 18),
      el('span', null, label),
    );
  }

  destroy(): void {
    this.offChanged();
    this.tray.destroy();
    this.customizer.close();
  }

  private state(): ToolbarState {
    const { prefs, presets, tools, rulerOn } = this.deps;
    const active = presets.active;
    return {
      activeItem: active ? ToolbarLayout.presetItem(active.id) : tools().kind,
      prefs,
      base: presets.base,
      presets: presets.presets,
      rulerOn: rulerOn(),
      canUndo: this.canUndo,
      canRedo: this.canRedo,
    };
  }

  private layout(): ToolbarPrefs {
    return ToolbarLayout.resolve(this.deps.prefs.toolbar, this.deps.presets.presets);
  }

  private setLayout(layout: ToolbarPrefs): void {
    this.deps.prefs.toolbar = layout;
    this.changed();
  }

  private changed(): void {
    this.deps.savePrefs();
    this.render();
  }

  /** A base tool: leaves any preset, and otherwise works as it always has. */
  private onToolTap(kind: ToolKind, button: HTMLButtonElement): void {
    const { presets, popover, tools } = this.deps;
    if (presets.active) {
      presets.leave();
      popover().close();
      this.deps.savePrefs();
      if (tools().kind === kind) this.render();
      else this.deps.setTool(kind);
      return;
    }
    if (tools().kind !== kind) {
      this.deps.setTool(kind);
      return;
    }
    if (tools().current.onActiveTap()) popover().close();
    else popover().toggle(button, tools().current);
  }

  /** A long press on a base tool: select it if needed and open its options. */
  private openToolOptions(kind: ToolKind): void {
    const { presets, tools, popover } = this.deps;
    if (presets.active) presets.leave();
    if (tools().kind !== kind) this.deps.setTool(kind);
    else this.render();
    const button = this.tray.buttonFor(kind);
    if (button) popover().open(button, tools().current);
  }

  private onPresetTap(id: string, button: HTMLButtonElement): void {
    const { presets, popover, tools } = this.deps;
    if (presets.active?.id !== id) {
      this.activate(id);
      return;
    }
    if (tools().current.onActiveTap()) popover().close();
    else popover().toggle(button, tools().current);
  }

  private activate(id: string): void {
    const { presets } = this.deps;
    const preset = presets.presets.find((p) => p.id === id);
    if (!preset) return;
    // The tool first: leaving a text box saves it with the style it was written in.
    this.deps.setTool(preset.tool);
    presets.activate(id);
    this.changed();
  }

  private openPresetMenu(id: string, button: HTMLButtonElement): void {
    const { i18n, menu } = this.deps;
    menu.show(button, [
      { label: i18n.t('presetEdit'), icon: 'edit', onClick: () => this.editPreset(id) },
      { label: i18n.t('presetDuplicate'), icon: 'duplicate', onClick: () => this.duplicate(id) },
      { label: i18n.t('presetUnpin'), icon: 'unpin', danger: true, onClick: () => this.unpin(id) },
    ]);
  }

  private editPreset(id: string): void {
    const { presets, popover, tools } = this.deps;
    if (presets.active?.id !== id) this.activate(id);
    const button = this.tray.buttonFor(ToolbarLayout.presetItem(id));
    if (button) popover().open(button, tools().current);
  }

  private duplicate(id: string): void {
    const { presets, toast, i18n } = this.deps;
    if (presets.duplicate(id)) this.changed();
    else toast.show(i18n.t('presetLimit'));
  }

  private unpin(id: string): void {
    this.deps.popover().close();
    this.deps.presets.unpin(id);
    this.changed();
  }

  private pinCurrent(tool: Tool): void {
    const { presets, popover, toast, i18n } = this.deps;
    if (!ToolPresets.isPinnable(tool.kind)) return;
    popover().close();
    if (presets.pinCurrent(tool.kind)) {
      this.changed();
      toast.show(i18n.t('presetPinned'), 2400);
    } else toast.show(i18n.t('presetLimit'));
  }

  private onSwatch(color: string): void {
    const { prefs, presets } = this.deps;
    // A pinned colour is for the pen: on a pen preset it changes the preset, on anything else
    // it is the base pen that gets it.
    if (presets.active && presets.active.tool !== 'pen') presets.leave();
    prefs.brushes[prefs.brush].c = color;
    this.deps.savePrefs();
    this.deps.setTool('pen');
  }

  /** Long press on a pinned colour: replace it with the current pen colour, or remove it. */
  private openSwatchMenu(index: number, button: HTMLButtonElement): void {
    const { prefs, i18n, menu } = this.deps;
    const current = prefs.brushes[prefs.brush].c;
    const update = (favs: string[]): void => {
      prefs.favs = favs;
      this.changed();
    };
    menu.show(button, [
      {
        label: i18n.t('favReplace'),
        swatch: current,
        onClick: () => update(ColorLists.replace(prefs.favs, index, current)),
      },
      {
        label: i18n.t('favRemove'),
        icon: 'trash',
        danger: true,
        onClick: () => update(ColorLists.remove(prefs.favs, index)),
      },
    ]);
  }
}
