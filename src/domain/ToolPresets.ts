import { BRUSH_SPECS, MAX_TOOL_PRESETS } from '../core/constants';
import type { Preferences, ToolKind, ToolPreset, ToolSettings } from '../core/types';

/** The tools a preset can hold; the lasso has no settings to remember. */
export type PinnableTool = ToolPreset['tool'];

/** Width ranges of the tools without brush types (they match the tools' sliders). */
export const HL_RANGE = [6, 40] as const;
export const ERASER_RANGE = [6, 60] as const;
export const TEXT_SIZE_RANGE = [6, 200] as const;

function ratio(value: number, min: number, max: number): number {
  return max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
}

/**
 * Pure rules of pinned tool presets. A preset is a tool with its settings. Using one copies its
 * settings over the working settings the tools read; {@link snapshot} keeps what they were, so
 * the base tools stay as the user left them.
 */
export class ToolPresets {
  /** Whether a tool can be pinned. */
  static isPinnable(kind: ToolKind): kind is PinnableTool {
    return kind !== 'lasso';
  }

  /** A preset with a tool's current settings. */
  static capture(settings: ToolSettings, tool: PinnableTool, id: string): ToolPreset {
    switch (tool) {
      case 'pen': {
        const { c, s } = settings.brushes[settings.brush];
        return { id, tool, brush: settings.brush, c, s };
      }
      case 'hl':
        return { id, tool, c: settings.hl.c, s: settings.hl.s };
      case 'eraser':
        return { id, tool, mode: settings.er.mode, r: settings.er.r };
      case 'text':
        return { ...settings.txt, id, tool };
    }
  }

  /** Copies a preset's settings over the working settings. */
  static apply(settings: ToolSettings, preset: ToolPreset): void {
    switch (preset.tool) {
      case 'pen':
        settings.brush = preset.brush;
        settings.brushes[preset.brush] = { c: preset.c, s: preset.s };
        return;
      case 'hl':
        settings.hl = { c: preset.c, s: preset.s };
        return;
      case 'eraser':
        settings.er = { mode: preset.mode, r: preset.r };
        return;
      case 'text': {
        const { id: _id, tool: _tool, ...style } = preset;
        settings.txt = style;
      }
    }
  }

  /** The preset as the working settings have it now, or null if nothing changed. */
  static updated(preset: ToolPreset, settings: ToolSettings): ToolPreset | null {
    const current = ToolPresets.capture(settings, preset.tool, preset.id);
    return ToolPresets.same(preset, current) ? null : current;
  }

  /** Whether another preset can be added. */
  static canAdd(presets: readonly ToolPreset[]): boolean {
    return presets.length < MAX_TOOL_PRESETS;
  }

  /** The list with a copy of a preset right after it; unchanged when it is full or has no such id. */
  static duplicated(presets: readonly ToolPreset[], id: string, newId: string): ToolPreset[] {
    const index = presets.findIndex((p) => p.id === id);
    const source = presets[index];
    if (!source || !ToolPresets.canAdd(presets)) return [...presets];
    return [...presets.slice(0, index + 1), { ...source, id: newId }, ...presets.slice(index + 1)];
  }

  /** A deep copy of the settings of all tools. */
  static snapshot(settings: ToolSettings): ToolSettings {
    return {
      brush: settings.brush,
      brushes: {
        ballpoint: { ...settings.brushes.ballpoint },
        fountain: { ...settings.brushes.fountain },
        fineliner: { ...settings.brushes.fineliner },
        pencil: { ...settings.brushes.pencil },
        brush: { ...settings.brushes.brush },
      },
      hl: { ...settings.hl },
      er: { ...settings.er },
      txt: { ...settings.txt },
    };
  }

  /** Puts saved settings back as the working settings. */
  static restore(prefs: Preferences, saved: ToolSettings): void {
    Object.assign(prefs, ToolPresets.snapshot(saved));
  }

  /** The preset's colour, if its tool has one. */
  static colorOf(preset: ToolPreset): string | null {
    return preset.tool === 'eraser' ? null : preset.c;
  }

  /** How wide the preset draws within its tool's range, from 0 to 1, for the width hint. */
  static widthHint(preset: ToolPreset): number {
    switch (preset.tool) {
      case 'pen': {
        const spec = BRUSH_SPECS[preset.brush];
        return ratio(preset.s, spec.min, spec.max);
      }
      case 'hl':
        return ratio(preset.s, ...HL_RANGE);
      case 'eraser':
        return ratio(preset.r, ...ERASER_RANGE);
      case 'text':
        return ratio(preset.fs, ...TEXT_SIZE_RANGE);
    }
  }

  private static same(a: ToolPreset, b: ToolPreset): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const valueOf = (preset: ToolPreset, key: string): unknown =>
      (preset as unknown as Record<string, unknown>)[key];
    return [...keys].every((key) => valueOf(a, key) === valueOf(b, key));
  }
}
