import { describe, expect, it } from 'vitest';
import { HL_COLORS, MAX_FAVORITES, MAX_RECENT_COLORS, PEN_COLORS } from '../../src/core/constants';
import { ColorLists } from '../../src/domain/ColorLists';
import { EraserModes } from '../../src/domain/EraserModes';
import { COLOR_PATTERN } from '../../src/storage/validation/guards';
import de from '../../src/i18n/locales/de.json';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import uk from '../../src/i18n/locales/uk.json';

describe('palettes', () => {
  it('has 30 pen colours and 12 highlighter colours, all valid and distinct', () => {
    expect(PEN_COLORS).toHaveLength(30);
    expect(HL_COLORS).toHaveLength(12);
    for (const list of [PEN_COLORS, HL_COLORS]) {
      expect(list.every((c) => COLOR_PATTERN.test(c))).toBe(true);
      expect(new Set(list.map((c) => c.toLowerCase())).size).toBe(list.length);
    }
  });

  it.each([
    ['uk', uk],
    ['ru', ru],
    ['de', de],
    ['en', en],
  ])('%s names every swatch', (_lang, dict) => {
    expect(dict.penColorNames).toHaveLength(PEN_COLORS.length);
    expect(dict.hlColorNames).toHaveLength(HL_COLORS.length);
  });

  it('pen colours stay readable on white paper (no pale tints)', () => {
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    for (const c of PEN_COLORS) expect(1.05 / (luminance(c) + 0.05), c).toBeGreaterThan(2.4);
  });
});

describe('ColorLists', () => {
  it('accepts only #RRGGBB in the hex field', () => {
    expect(ColorLists.parseHex('#1e40af')).toBe('#1E40AF');
    expect(ColorLists.parseHex('  #A1B2C3 ')).toBe('#A1B2C3');
    for (const bad of ['1E40AF', '#1E40A', '#1E40AFF', '#GGGGGG', '#fff', 'red', '', 'url(x)', '#12345\n'])
      expect(ColorLists.parseHex(bad), bad).toBeNull();
  });

  it('keeps at most 8 recent colours, newest first, without duplicates', () => {
    let list: string[] = [];
    for (let i = 0; i < 12; i++) list = ColorLists.pushRecent(list, `#00000${i.toString(16)}`);
    expect(list).toHaveLength(MAX_RECENT_COLORS);
    expect(list[0]).toBe('#00000b');
    list = ColorLists.pushRecent(list, '#00000A');
    expect(list).toHaveLength(MAX_RECENT_COLORS);
    expect(list[0]).toBe('#00000A');
    expect(list.filter((c) => c.toLowerCase() === '#00000a')).toHaveLength(1);
  });

  it('pins up to 5 favourites and refuses duplicates', () => {
    let favs: string[] = ['#111111', '#222222', '#333333'];
    favs = ColorLists.pin(favs, '#444444') ?? favs;
    favs = ColorLists.pin(favs, '#555555') ?? favs;
    expect(favs).toHaveLength(MAX_FAVORITES);
    favs = ColorLists.pin(favs, '#666666') ?? favs;
    expect(favs).toHaveLength(MAX_FAVORITES);
    expect(favs[0]).toBe('#666666');
    expect(ColorLists.pin(favs, '#666666')).toBeNull();
  });

  it('replaces and removes a favourite', () => {
    const favs = ['#111111', '#222222', '#333333'];
    expect(ColorLists.replace(favs, 1, '#ABCDEF')).toEqual(['#111111', '#ABCDEF', '#333333']);
    expect(ColorLists.replace(favs, 0, '#333333')).toEqual(['#333333', '#222222']);
    expect(ColorLists.replace(favs, 9, '#ABCDEF')).toEqual(favs);
    expect(ColorLists.remove(favs, 1)).toEqual(['#111111', '#333333']);
  });
});

describe('EraserModes', () => {
  it('toggles between the pixel and the stroke eraser', () => {
    expect(EraserModes.toggle('part')).toBe('whole');
    expect(EraserModes.toggle('whole')).toBe('part');
    expect(EraserModes.toggle(EraserModes.toggle('part'))).toBe('part');
  });

  it('recognises the stylus eraser end and eraser button only', () => {
    expect(EraserModes.isStylusEraser({ pointerType: 'pen', button: 5, buttons: 32 })).toBe(true);
    expect(EraserModes.isStylusEraser({ pointerType: 'pen', button: -1, buttons: 33 })).toBe(true);
    expect(EraserModes.isStylusEraser({ pointerType: 'pen', button: 0, buttons: 1 })).toBe(false);
    expect(EraserModes.isStylusEraser({ pointerType: 'mouse', button: 5, buttons: 32 })).toBe(false);
  });
});
