import { CARD_THUMB_HEIGHT, CARD_THUMB_WIDTH, PAPER } from '../core/constants';
import type { CardItem, LinkCard, PdfCard } from '../core/types';
import { RichTextLayout, type TextMeasurer } from '../domain/RichTextLayout';
import { SafeUrl } from '../domain/SafeUrl';
import type { PathSink } from './brushes/PathSink';
import type { DrawSink, LineStyle } from './draw/DrawSink';

/** The translated words on a card. */
export interface CardLabels {
  /** "12 pages · 1.4 MB". */
  pdfMeta(card: PdfCard): string;
  /** Why the file cannot be shown, or null. */
  pdfProblem(card: PdfCard): string | null;
  /** The letters on a PDF card without a thumbnail. */
  readonly pdfBadge: string;
}

/** Sizes per unit of the card's height. */
const PADDING = 0.11;
const RADIUS = 0.12;
const TITLE_SIZE = { pdf: 0.19, link: 0.27 } as const;
const META_SIZE = { pdf: 0.145, link: 0.2 } as const;
const LINE_GAP = 0.08;
const DOT_RADIUS = 0.022;
const DOT_STEP = 0.075;
const DOTS_FROM_RIGHT = 0.2;
const CHROME_ROOM = 0.45;
const LINK_ICON_SIZE = 0.56;
const LINK_ICON_WIDTH = 0.045;
const ELLIPSIS = '…';

/**
 * Draws attachment cards in page px through a {@link DrawSink}, so the screen, PNG and both PDFs
 * show the same card. Everything on it is drawn as text, never as markup, and comes from what is
 * stored: nothing is fetched for a link.
 */
export class CardPainter {
  constructor(
    private readonly measurer: TextMeasurer,
    private readonly labels: CardLabels,
  ) {}

  /**
   * Emits a card. `chrome` adds the ⋮ button, which only the screen needs. A link card also marks
   * its rectangle as a link, which only a vector PDF does anything with.
   */
  emit<P extends PathSink>(sink: DrawSink<P>, card: CardItem, chrome = false): void {
    this.background(sink, card);
    if (card.kind === 'pdf') this.pdfCard(sink, card, chrome);
    else this.linkCard(sink, card, chrome);
    if (chrome) CardPainter.menuDots(sink, card);
  }

  private background<P extends PathSink>(sink: DrawSink<P>, card: CardItem): void {
    const path = sink.newPath();
    CardPainter.roundedRect(path, card.x, card.y, card.w, card.h, card.h * RADIUS);
    sink.fillPath(path, { color: PAPER.cardFill, alpha: 1 });
    sink.strokePath(path, CardPainter.line(PAPER.cardEdge, 1));
  }

  private pdfCard<P extends PathSink>(sink: DrawSink<P>, card: PdfCard, chrome: boolean): void {
    const pad = card.h * PADDING;
    const height = card.h - pad * 2;
    const width = (height * CARD_THUMB_WIDTH) / CARD_THUMB_HEIGHT;
    const x = card.x + pad;
    const y = card.y + pad;
    if (card.thumb) {
      sink.image({ blob: card.thumb, x, y, w: width, h: height, placeholder: PAPER.imagePlaceholder });
    } else {
      this.badge(sink, x, y, width, height);
    }
    const problem = this.labels.pdfProblem(card);
    this.twoLines(sink, card, x + width + pad, chrome, {
      kind: 'pdf',
      title: card.name,
      meta: problem ?? this.labels.pdfMeta(card),
      metaColor: problem ? PAPER.cardProblem : PAPER.cardMeta,
    });
  }

  private badge<P extends PathSink>(sink: DrawSink<P>, x: number, y: number, w: number, h: number): void {
    const path = sink.newPath();
    CardPainter.roundedRect(path, x, y, w, h, w * RADIUS);
    sink.fillPath(path, { color: PAPER.cardBadge, alpha: 1 });
    const size = w * 0.3;
    this.measurer.font = RichTextLayout.font(size, true);
    const width = this.measurer.measureText(this.labels.pdfBadge).width;
    sink.text({
      text: this.labels.pdfBadge,
      x: x + (w - width) / 2,
      top: y + h / 2 - size / 2,
      baseline: y + h / 2 + size * 0.35,
      bold: true,
      size,
      color: PAPER.cardBadgeText,
    });
  }

  private linkCard<P extends PathSink>(sink: DrawSink<P>, card: LinkCard, chrome: boolean): void {
    const pad = card.h * PADDING;
    const icon = card.h * LINK_ICON_SIZE;
    CardPainter.linkIcon(sink, card.x + pad * 1.4, card.y + (card.h - icon) / 2, icon, card.h);
    const host = SafeUrl.hostname(card.link.href);
    this.twoLines(sink, card, card.x + pad * 2.4 + icon, chrome, {
      kind: 'link',
      title: card.title || host,
      meta: host,
      metaColor: PAPER.link,
    });
    sink.link?.(card.x, card.y, card.w, card.h, card.link);
  }

  private twoLines<P extends PathSink>(
    sink: DrawSink<P>,
    card: CardItem,
    x: number,
    chrome: boolean,
    text: { kind: CardItem['kind']; title: string; meta: string; metaColor: string },
  ): void {
    const titleSize = card.h * TITLE_SIZE[text.kind];
    const metaSize = card.h * META_SIZE[text.kind];
    const gap = card.h * LINE_GAP;
    const room = card.x + card.w - card.h * (chrome ? CHROME_ROOM : PADDING) - x;
    const top = card.y + (card.h - titleSize - gap - metaSize) / 2;
    const titleBase = top + titleSize * 0.85;
    const metaBase = top + titleSize + gap + metaSize * 0.85;
    sink.text({
      text: this.fit(text.title, titleSize, true, room),
      x,
      top,
      baseline: titleBase,
      bold: true,
      size: titleSize,
      color: PAPER.cardTitle,
    });
    sink.text({
      text: this.fit(text.meta, metaSize, false, room),
      x,
      top: metaBase - metaSize,
      baseline: metaBase,
      size: metaSize,
      color: text.metaColor,
    });
  }

  /** The text cut with "…" to fit a width; empty when not even that fits. */
  private fit(text: string, size: number, bold: boolean, room: number): string {
    if (room <= 0) return '';
    this.measurer.font = RichTextLayout.font(size, bold);
    if (this.measurer.measureText(text).width <= room) return text;
    const chars = Array.from(text);
    let low = 0;
    let high = chars.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const piece = chars.slice(0, middle).join('') + ELLIPSIS;
      if (this.measurer.measureText(piece).width <= room) low = middle;
      else high = middle - 1;
    }
    return low ? chars.slice(0, low).join('').trimEnd() + ELLIPSIS : '';
  }

  /** Two linked rings: a picture that works without any words or fonts. */
  private static linkIcon<P extends PathSink>(
    sink: DrawSink<P>,
    x: number,
    y: number,
    size: number,
    cardHeight: number,
  ): void {
    const radius = size * 0.3;
    const middle = y + size / 2;
    const path = sink.newPath();
    path.moveTo(x + radius * 2, middle);
    path.arc(x + radius, middle, radius, 0, Math.PI * 2);
    path.closePath();
    path.moveTo(x + size, middle);
    path.arc(x + size - radius, middle, radius, 0, Math.PI * 2);
    path.closePath();
    sink.strokePath(path, CardPainter.line(PAPER.link, cardHeight * LINK_ICON_WIDTH));
  }

  private static menuDots<P extends PathSink>(sink: DrawSink<P>, card: CardItem): void {
    const x = card.x + card.w - card.h * DOTS_FROM_RIGHT;
    const middle = card.y + card.h / 2;
    const path = sink.newPath();
    for (const step of [-1, 0, 1]) {
      const y = middle + step * card.h * DOT_STEP;
      path.moveTo(x + card.h * DOT_RADIUS, y);
      path.arc(x, y, card.h * DOT_RADIUS, 0, Math.PI * 2);
      path.closePath();
    }
    sink.fillPath(path, { color: PAPER.cardMeta, alpha: 1 });
  }

  private static line(color: string, width: number): LineStyle {
    return { color, alpha: 1, width, cap: 'round', join: 'round', blend: 'normal' };
  }

  private static roundedRect(path: PathSink, x: number, y: number, w: number, h: number, r: number): void {
    path.moveTo(x + r, y);
    path.lineTo(x + w - r, y);
    path.quadraticCurveTo(x + w, y, x + w, y + r);
    path.lineTo(x + w, y + h - r);
    path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    path.lineTo(x + r, y + h);
    path.quadraticCurveTo(x, y + h, x, y + h - r);
    path.lineTo(x, y + r);
    path.quadraticCurveTo(x, y, x + r, y);
    path.closePath();
  }
}
