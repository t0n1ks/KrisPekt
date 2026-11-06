import type { EventBus } from '../app/EventBus';
import type { BrushKind, Preferences, ToolKind, ToolPreset, ToolSettings } from '../core/types';
import { ToolbarLayout } from '../domain/ToolbarLayout';
import { ToolPresets, type PinnableTool } from '../domain/ToolPresets';

/**
 * Which pinned preset is in use, and the bookkeeping around it. It holds no interface: the
 * toolbar calls it and listens to `toolbar-changed`.
 *
 * While a preset is active its settings are the working settings the tools read and change, and
 * `prefs.presetBase` keeps what the base tools had. That copy is stored, so a reload cannot leave
 * a preset's settings on a base tool: loading puts it back (see PreferencesStore).
 */
export class ToolPresetController {
  private activePresetId: string | null = null;

  constructor(
    private readonly prefs: Preferences,
    private readonly makeId: () => string,
    private readonly bus: EventBus,
  ) {}

  get presets(): readonly ToolPreset[] {
    return this.prefs.presets ?? [];
  }

  /** The preset in use, or null when a base tool is in use. */
  get active(): ToolPreset | null {
    return this.presets.find((p) => p.id === this.activePresetId) ?? null;
  }

  /** The settings of the base tools, also while a preset is active. */
  get base(): ToolSettings {
    return this.prefs.presetBase ?? this.prefs;
  }

  /** Starts using a preset. Returns false if there is no such preset. */
  activate(id: string): boolean {
    const preset = this.presets.find((p) => p.id === id);
    if (!preset) return false;
    if (this.prefs.presetBase) ToolPresets.restore(this.prefs, this.prefs.presetBase);
    else this.prefs.presetBase = ToolPresets.snapshot(this.prefs);
    ToolPresets.apply(this.prefs, preset);
    this.activePresetId = id;
    return true;
  }

  /** Goes back to the base tools and their own settings. */
  leave(): void {
    this.activePresetId = null;
    const base = this.prefs.presetBase;
    if (!base) return;
    ToolPresets.restore(this.prefs, base);
    delete this.prefs.presetBase;
  }

  /** The selected tool changed: a preset of another tool is no longer in use. */
  toolChanged(kind: ToolKind): void {
    if (this.active && this.active.tool !== kind) this.leave();
  }

  /** Pins a tool with its current settings and starts using the new preset. */
  pinCurrent(tool: PinnableTool): ToolPreset | null {
    const preset = this.add(tool);
    if (preset) this.activate(preset.id);
    return preset;
  }

  /** Adds a preset with a base tool's settings; null when the toolbar already has the maximum. */
  add(tool: PinnableTool, brush?: BrushKind): ToolPreset | null {
    if (!ToolPresets.canAdd(this.presets)) return null;
    const settings = brush ? { ...this.base, brush } : this.base;
    const preset = ToolPresets.capture(settings, tool, this.makeId());
    this.prefs.presets = [...this.presets, preset];
    return preset;
  }

  /** Adds a copy of a preset next to it, on the toolbar too. Returns false when full. */
  duplicate(id: string): boolean {
    if (!ToolPresets.canAdd(this.presets)) return false;
    const newId = this.makeId();
    this.prefs.presets = ToolPresets.duplicated(this.presets, id, newId);
    const layout = ToolbarLayout.resolve(this.prefs.toolbar, this.presets);
    const at = layout.order.indexOf(ToolbarLayout.presetItem(id));
    this.prefs.toolbar = {
      ...layout,
      order: ToolbarLayout.moved(layout.order, ToolbarLayout.presetItem(newId), at + 1),
    };
    return true;
  }

  /** Removes a preset, leaving it first if it is in use. */
  unpin(id: string): void {
    if (this.activePresetId === id) this.leave();
    this.prefs.presets = this.presets.filter((p) => p.id !== id);
    if (this.prefs.toolbar) {
      this.prefs.toolbar = ToolbarLayout.without(this.prefs.toolbar, ToolbarLayout.presetItem(id));
    }
  }

  /**
   * Brings the active preset up to date with the working settings. Runs on every save, so any
   * change of a setting, from whichever panel, updates the preset.
   */
  sync(): void {
    const active = this.active;
    if (!active) return;
    const updated = ToolPresets.updated(active, this.prefs);
    if (!updated) return;
    this.prefs.presets = this.presets.map((p) => (p.id === active.id ? updated : p));
    this.bus.emit('toolbar-changed', undefined);
  }
}
