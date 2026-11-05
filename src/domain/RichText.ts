import type { TextItem, TextParagraph, TextSpan, TextStyle } from '../core/types';

/** A style change: `false` turns a flag off. */
export interface StylePatch {
  fs?: number;
  c?: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
}

/** A paragraph change; `null` restores the default. */
export interface ParagraphPatch {
  align?: 'center' | 'right' | null;
  list?: 'bullet' | 'number' | null;
}

const STYLE_KEYS = ['fs', 'c', 'b', 'i', 'u', 's'] as const;

/**
 * Operations on the rich text model: paragraphs of runs, addressed by character offsets, where
 * a paragraph break counts as one character. Values are never mutated in place (history
 * snapshots share them). Pure, so it can be unit tested.
 */
export class RichText {
  /** A box's paragraphs; an old text item without any becomes plain paragraphs. */
  static paragraphsOf(item: Pick<TextItem, 't' | 'paras'>): TextParagraph[] {
    return (
      item.paras ??
      String(item.t)
        .split('\n')
        .map((t) => ({ runs: [{ t }] }))
    );
  }

  /** The text without styles, with paragraphs on separate lines. */
  static plainText(paras: readonly TextParagraph[]): string {
    return paras.map((p) => p.runs.map((r) => r.t).join('')).join('\n');
  }

  /** Length in offsets. */
  static length(paras: readonly TextParagraph[]): number {
    return RichText.plainText(paras).length;
  }

  /** Whether there is nothing but whitespace; such a box does not stay on the page. */
  static isBlank(paras: readonly TextParagraph[]): boolean {
    return !RichText.plainText(paras).trim();
  }

  /** Whether two runs look the same. */
  static sameStyle(a: TextStyle, b: TextStyle): boolean {
    return STYLE_KEYS.every((key) => a[key] === b[key]);
  }

  /** The style fields of a run, without its text. */
  static styleOf(run: TextStyle): TextStyle {
    const style: TextStyle = {};
    if (run.fs !== undefined) style.fs = run.fs;
    if (run.c !== undefined) style.c = run.c;
    if (run.b) style.b = true;
    if (run.i) style.i = true;
    if (run.u) style.u = true;
    if (run.s) style.s = true;
    return style;
  }

  /** Merges neighbouring runs of the same style and drops empty ones (a paragraph keeps one). */
  static normalized(paras: readonly TextParagraph[]): TextParagraph[] {
    return paras.map((p) => {
      const runs: TextSpan[] = [];
      for (const run of p.runs) {
        const last = runs[runs.length - 1];
        if (!run.t) continue;
        if (last && RichText.sameStyle(last, run)) runs[runs.length - 1] = { ...last, t: last.t + run.t };
        else runs.push(run);
      }
      if (!runs.length) runs.push(p.runs[0] ?? { t: '' });
      return { ...p, runs };
    });
  }

  /** Applies a style to the characters in [start, end); empty paragraphs inside the range too. */
  static applyStyle(
    paras: readonly TextParagraph[],
    start: number,
    end: number,
    patch: StylePatch,
  ): TextParagraph[] {
    let at = 0;
    const out = paras.map((p) => {
      const from = at;
      const len = p.runs.reduce((sum, r) => sum + r.t.length, 0);
      at += len + 1;
      if (from > end || from + len < start) return p;
      if (!len) return start <= from && from <= end ? RichText.styledEmpty(p, patch) : p;
      return { ...p, runs: RichText.styleRuns(p.runs, start - from, end - from, patch) };
    });
    return RichText.normalized(out);
  }

  /** Changes every paragraph that the range [start, end] touches. */
  static applyParagraph(
    paras: readonly TextParagraph[],
    start: number,
    end: number,
    patch: ParagraphPatch,
  ): TextParagraph[] {
    let at = 0;
    return paras.map((p) => {
      const from = at;
      const len = p.runs.reduce((sum, r) => sum + r.t.length, 0);
      at += len + 1;
      if (from > end || from + len < start) return p;
      const next = { ...p };
      if (patch.align !== undefined) RichText.assign(next, 'align', patch.align);
      if (patch.list !== undefined) RichText.assign(next, 'list', patch.list);
      return next;
    });
  }

  /**
   * The style that all characters in [start, end) share; a field they disagree on is absent.
   * An empty range gives the style of the character before it, what typing continues with.
   */
  static commonStyle(paras: readonly TextParagraph[], start: number, end: number): TextStyle {
    const runs = RichText.runsIn(paras, start, end);
    const first = runs[0];
    if (!first) return {};
    let common = RichText.styleOf(first);
    for (const run of runs) {
      const next: TextStyle = {};
      for (const key of STYLE_KEYS) if (common[key] === run[key]) Object.assign(next, { [key]: common[key] });
      common = RichText.styleOf(next);
    }
    return common;
  }

  /** The first paragraph that an offset falls in. */
  static paragraphAt(paras: readonly TextParagraph[], offset: number): TextParagraph | undefined {
    let at = 0;
    for (const p of paras) {
      const len = p.runs.reduce((sum, r) => sum + r.t.length, 0);
      if (offset <= at + len) return p;
      at += len + 1;
    }
    return paras[paras.length - 1];
  }

  /** Replaces [start, end) with plain text in the given style; "\n" starts a new paragraph. */
  static replaceRange(
    paras: readonly TextParagraph[],
    start: number,
    end: number,
    text: string,
    style: TextStyle,
  ): TextParagraph[] {
    const head = RichText.cut(paras, 0, start);
    const tail = RichText.cut(paras, end, Infinity);
    const before = head[head.length - 1] ?? { runs: [] };
    const after = tail[0] ?? { runs: [] };
    const pieces = text.split('\n');
    const middle = pieces.map((t, i): TextParagraph => {
      const runs: TextSpan[] = [{ ...style, t }];
      if (i === 0) runs.unshift(...before.runs);
      if (i === pieces.length - 1) runs.push(...after.runs);
      return { ...before, runs };
    });
    return RichText.normalized([...head.slice(0, -1), ...middle, ...tail.slice(1)]);
  }

  /** Removes trailing spaces and empty paragraphs. */
  static trimmedEnd(paras: readonly TextParagraph[]): TextParagraph[] {
    const out = [...paras];
    while (out.length > 1 && !RichText.plainText(out.slice(-1)).trim()) out.pop();
    const last = out[out.length - 1];
    if (!last) return out;
    const runs = [...last.runs];
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i] as TextSpan;
      const t = run.t.replace(/\s+$/, '');
      runs[i] = { ...run, t };
      if (t) break;
    }
    out[out.length - 1] = { ...last, runs };
    return RichText.normalized(out);
  }

  /** Scales font sizes that a run sets itself. */
  static scaled(paras: readonly TextParagraph[], k: number, min: number, max: number): TextParagraph[] {
    return paras.map((p) => ({
      ...p,
      runs: p.runs.map((r) =>
        r.fs === undefined ? r : { ...r, fs: Math.min(max, Math.max(min, r.fs * k)) },
      ),
    }));
  }

  /** Drops the runs' own colours, so the whole box takes the box colour. */
  static withoutColors(paras: readonly TextParagraph[]): TextParagraph[] {
    return RichText.normalized(
      paras.map((p) => ({
        ...p,
        runs: p.runs.map((r) => {
          const { c: _dropped, ...rest } = r;
          return rest;
        }),
      })),
    );
  }

  /** The number shown in front of each numbered paragraph; a run of them counts from 1. */
  static listNumbers(paras: readonly TextParagraph[]): number[] {
    let n = 0;
    return paras.map((p) => {
      n = p.list === 'number' ? n + 1 : 0;
      return n;
    });
  }

  /** A style with a patch applied; a flag set to false is removed, not stored. */
  static patchedStyle<Style extends TextStyle>(style: Style, patch: StylePatch): Style {
    const out = { ...style };
    if (patch.fs !== undefined) out.fs = patch.fs;
    if (patch.c !== undefined) out.c = patch.c;
    for (const flag of ['b', 'i', 'u', 's'] as const) {
      if (patch[flag] === true) out[flag] = true;
      else if (patch[flag] === false) out[flag] = undefined;
    }
    return RichText.withoutUndefined(out);
  }

  private static withoutUndefined<Value extends object>(value: Value): Value {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Value;
  }

  private static assign(p: TextParagraph, key: 'align' | 'list', value: string | null): void {
    Object.assign(p, { [key]: value ?? undefined });
    if (value === null) {
      const { [key]: _removed, ...rest } = p;
      for (const name of Object.keys(p)) Reflect.deleteProperty(p, name);
      Object.assign(p, rest);
    }
  }

  private static styledEmpty(p: TextParagraph, patch: StylePatch): TextParagraph {
    return { ...p, runs: [RichText.patched(p.runs[0] ?? { t: '' }, patch)] };
  }

  private static patched(run: TextSpan, patch: StylePatch): TextSpan {
    return RichText.patchedStyle(run, patch);
  }

  private static styleRuns(
    runs: readonly TextSpan[],
    start: number,
    end: number,
    patch: StylePatch,
  ): TextSpan[] {
    const out: TextSpan[] = [];
    let at = 0;
    for (const run of runs) {
      const a = Math.max(start - at, 0);
      const b = Math.min(end - at, run.t.length);
      at += run.t.length;
      if (b <= a) {
        out.push(run);
        continue;
      }
      if (a > 0) out.push({ ...run, t: run.t.slice(0, a) });
      out.push(RichText.patched({ ...run, t: run.t.slice(a, b) }, patch));
      if (b < run.t.length) out.push({ ...run, t: run.t.slice(b) });
    }
    return out;
  }

  /** The runs that characters in [start, end) belong to; for an empty range, the one before it. */
  private static runsIn(paras: readonly TextParagraph[], start: number, end: number): TextSpan[] {
    const out: TextSpan[] = [];
    let at = 0;
    let before: TextSpan | undefined;
    for (const p of paras) {
      const blank = p.runs.every((r) => !r.t);
      if (blank && start <= at && at <= end && p.runs[0]) {
        if (start === end) return [p.runs[0]];
      }
      for (const run of p.runs) {
        const stop = at + run.t.length;
        if (run.t && at < end && stop > start) out.push(run);
        if (run.t && at < start && stop >= start) before = run;
        at = stop;
      }
      at += 1;
    }
    if (start !== end) return out;
    return before ? [before] : (paras[0]?.runs.slice(0, 1) ?? []);
  }

  /** Paragraphs of the characters in [start, end), keeping the paragraph settings. */
  private static cut(paras: readonly TextParagraph[], start: number, end: number): TextParagraph[] {
    const out: TextParagraph[] = [];
    let at = 0;
    for (const p of paras) {
      const len = p.runs.reduce((sum, r) => sum + r.t.length, 0);
      const from = at;
      at += len + 1;
      if (from > end || from + len < start) continue;
      const runs: TextSpan[] = [];
      let pos = from;
      for (const run of p.runs) {
        const a = Math.max(start - pos, 0);
        const b = Math.min(end - pos, run.t.length);
        if (b > a) runs.push({ ...run, t: run.t.slice(a, b) });
        pos += run.t.length;
      }
      out.push({ ...p, runs });
    }
    return out;
  }
}
