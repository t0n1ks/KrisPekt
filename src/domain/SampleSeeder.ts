import { MM } from '../core/constants';
import type { Notebook, Page, Stroke, StrokeKind, Subject } from '../core/types';
import type { I18n } from '../i18n/I18n';

type PointMm = [number, number];

export interface SampleData {
  subjects: Subject[];
  notebooks: Notebook[];
  pages: Page[];
}

const BLUE = '#1E40AF';
const INK = '#16181D';
const RED = '#C81E2C';
const YELLOW = '#FDE047';

/** Evenly spaced points on a segment, in mm. */
function segment(x0: number, y0: number, x1: number, y1: number, n = 12): PointMm[] {
  const out: PointMm[] = [];
  for (let i = 0; i <= n; i++) out.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  return out;
}

function wave(): PointMm[] {
  const out: PointMm[] = [];
  for (let i = 0; i <= 60; i++) out.push([20 + i * 1.6, 27.5 + Math.sin(i * 0.9) * 0.7]);
  return out;
}

function parabola(): PointMm[] {
  const out: PointMm[] = [];
  for (let x = 72; x <= 138; x += 1.5) out.push([x, 190 - 8 * Math.pow((x - 105) / 12, 2)]);
  return out;
}

function vertexCircle(): PointMm[] {
  const out: PointMm[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2.08;
    out.push([105 + Math.cos(a) * 4.2, 190 + Math.sin(a) * 3.4]);
  }
  return out;
}

/**
 * Builds the first-run sample shelf (two subjects, two notebooks, a page with a plotted
 * parabola) in the current language. Seeded once; the caller persists it.
 */
export class SampleSeeder {
  constructor(
    private readonly i18n: I18n,
    private readonly makeId: () => string,
  ) {}

  build(now: number = Date.now()): SampleData {
    const t = this.i18n;
    const s1: Subject = {
      id: this.makeId(),
      name: t.t('s_math'),
      color: '#2F5DA8',
      order: 0,
      createdAt: now,
    };
    const s2: Subject = {
      id: this.makeId(),
      name: t.t('s_hist'),
      color: '#B23A48',
      order: 1,
      createdAt: now + 1,
    };
    const nb1 = this.notebook(s1, t.t('s_lect'), { w: 210, h: 297 }, 'gridm', now);
    const nb2 = this.notebook(s2, t.t('s_sem'), { w: 148, h: 210 }, 'lines', now + 1);
    nb2.updatedAt = now;
    const p1 = this.lecturePage(nb1, now);
    const p2 = this.emptyPage(nb1, now);
    const p3 = this.emptyPage(nb2, now);
    p3.texts = [
      { id: this.makeId(), x: 14 * MM, y: 12 * MM, w: 120 * MM, t: t.t('s_sem1'), fs: 22, c: '#B23A48' },
    ];
    nb1.pageIds = [p1.id, p2.id];
    nb2.pageIds = [p3.id];
    return { subjects: [s1, s2], notebooks: [nb1, nb2], pages: [p1, p2, p3] };
  }

  private notebook(
    subject: Subject,
    title: string,
    base: Notebook['base'],
    bg: Notebook['bg'],
    createdAt: number,
  ): Notebook {
    return {
      id: this.makeId(),
      subjectId: subject.id,
      title,
      color: subject.color,
      base,
      bg,
      pageIds: [],
      createdAt,
      updatedAt: createdAt,
      sample: true,
      view: null,
    };
  }

  private emptyPage(nb: Notebook, now: number): Page {
    return {
      id: this.makeId(),
      nbId: nb.id,
      w: nb.base.w,
      h: nb.base.h,
      locked: true,
      bg: nb.bg,
      bgBlob: null,
      strokes: [],
      texts: [],
      images: [],
      updatedAt: now,
    };
  }

  private lecturePage(nb: Notebook, now: number): Page {
    const page = this.emptyPage(nb, now);
    page.strokes = [
      this.stroke(segment(19, 21.2, 118, 21.2, 20), YELLOW, 20, 'hl'),
      this.stroke(wave(), RED, 1.6),
      this.stroke(segment(40, 190, 178, 190, 30), INK, 1.8),
      this.stroke(segment(178, 190, 173, 187.4, 3), INK, 1.8),
      this.stroke(segment(178, 190, 173, 192.6, 3), INK, 1.8),
      this.stroke(segment(105, 236, 105, 112, 30), INK, 1.8),
      this.stroke(segment(105, 112, 102.4, 117, 3), INK, 1.8),
      this.stroke(segment(105, 112, 107.6, 117, 3), INK, 1.8),
      this.stroke(parabola(), BLUE, 2.4),
      this.stroke(vertexCircle(), RED, 1.5),
    ];
    const t = this.i18n;
    page.texts = [
      { id: this.makeId(), x: 20 * MM, y: 15.5 * MM, w: 160 * MM, t: t.t('s_title'), fs: 26, c: BLUE },
      { id: this.makeId(), x: 20 * MM, y: 34 * MM, w: 160 * MM, fs: 16, c: INK, t: t.t('s_body') },
      { id: this.makeId(), x: 132 * MM, y: 122 * MM, w: 50 * MM, t: 'y = x²', fs: 20, c: BLUE },
      { id: this.makeId(), x: 108 * MM, y: 196 * MM, w: 60 * MM, t: t.t('s_vertex'), fs: 14, c: RED },
    ];
    return page;
  }

  /** A stroke from mm points with a gentle simulated pressure wobble. */
  private stroke(points: PointMm[], color: string, size: number, kind: StrokeKind = 'pen'): Stroke {
    const flat: number[] = [];
    points.forEach(([x, y], i) =>
      flat.push(x * MM, y * MM, kind === 'hl' ? 0.5 : 0.48 + 0.14 * Math.sin(i * 0.7)),
    );
    return { id: this.makeId(), k: kind, c: color, s: size, p: new Float32Array(flat) };
  }
}
