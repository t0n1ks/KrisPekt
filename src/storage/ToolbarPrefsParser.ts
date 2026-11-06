import { BRUSH_KINDS, BRUSH_SPECS, MAX_TOOL_PRESETS } from '../core/constants';
import type { TextPrefs, ToolPreset, ToolbarPrefs } from '../core/types';
import { ERASER_RANGE, HL_RANGE, TEXT_SIZE_RANGE } from '../domain/ToolPresets';
import { COLOR_PATTERN, isRecord, type UnknownRecord } from './validation/guards';

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;
/** The stored list of toolbar items: base items and presets, with room for old leftovers. */
const MAX_ITEMS = 40;
const MAX_ITEM_LENGTH = 60;

function inRange(raw: unknown, min: number, max: number): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max;
}

function isColor(raw: unknown): raw is string {
  return typeof raw === 'string' && COLOR_PATTERN.test(raw);
}

/**
 * Reads pinned presets and the toolbar layout from untrusted stored preferences. An invalid
 * preset or item is left out, and what is not a list at all counts as not stored: other
 * preferences are not affected, and the toolbar is never worse than its default.
 */
export class ToolbarPrefsParser {
  /** The valid presets, with unknown fields dropped, at most the maximum, without repeated ids. */
  static presets(raw: unknown): ToolPreset[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const presets: ToolPreset[] = [];
    for (const entry of raw) {
      const preset = isRecord(entry) ? ToolbarPrefsParser.preset(entry) : null;
      if (!preset || seen.has(preset.id) || presets.length === MAX_TOOL_PRESETS) continue;
      seen.add(preset.id);
      presets.push(preset);
    }
    return presets;
  }

  /** The stored layout's lists of plain strings, or undefined if it is not a layout. */
  static toolbar(raw: unknown): ToolbarPrefs | undefined {
    if (!isRecord(raw) || !Array.isArray(raw.order) || !Array.isArray(raw.hidden)) return undefined;
    return { order: ToolbarPrefsParser.items(raw.order), hidden: ToolbarPrefsParser.items(raw.hidden) };
  }

  private static items(raw: readonly unknown[]): string[] {
    return raw
      .filter((id): id is string => typeof id === 'string' && id.length <= MAX_ITEM_LENGTH)
      .slice(0, MAX_ITEMS);
  }

  private static preset(raw: UnknownRecord): ToolPreset | null {
    const { id, tool } = raw;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
    switch (tool) {
      case 'pen':
        return ToolbarPrefsParser.pen(raw, id);
      case 'hl':
        if (!isColor(raw.c) || !inRange(raw.s, ...HL_RANGE)) return null;
        return { id, tool, c: raw.c, s: raw.s };
      case 'eraser':
        if ((raw.mode !== 'part' && raw.mode !== 'whole') || !inRange(raw.r, ...ERASER_RANGE)) return null;
        return { id, tool, mode: raw.mode, r: raw.r };
      case 'text':
        return ToolbarPrefsParser.text(raw, id);
      default:
        return null;
    }
  }

  private static pen(raw: UnknownRecord, id: string): ToolPreset | null {
    const brush = BRUSH_KINDS.find((kind) => kind === raw.brush);
    if (!brush || !isColor(raw.c)) return null;
    const spec = BRUSH_SPECS[brush];
    if (!inRange(raw.s, spec.min, spec.max)) return null;
    return { id, tool: 'pen', brush, c: raw.c, s: raw.s };
  }

  private static text(raw: UnknownRecord, id: string): ToolPreset | null {
    if (!isColor(raw.c) || !inRange(raw.fs, ...TEXT_SIZE_RANGE)) return null;
    const flags: Pick<TextPrefs, 'b' | 'i' | 'u' | 's'> = {};
    for (const key of ['b', 'i', 'u', 's'] as const) if (raw[key] === true) flags[key] = true;
    return { ...flags, id, tool: 'text', fs: raw.fs, c: raw.c };
  }
}
