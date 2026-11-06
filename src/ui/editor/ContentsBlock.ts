import type { Camera } from '../../canvas/Camera';
import type { PageLayout } from '../../canvas/PageLayout';
import type { TextLayout } from '../../canvas/TextLayout';
import { CARD_MARGIN, CONTENTS_FONT_SIZE, MM } from '../../core/constants';
import type { Page, TextItem } from '../../core/types';
import { RichText } from '../../domain/RichText';
import { TableOfContents } from '../../domain/TableOfContents';
import type { EditorSession } from '../../editor/EditorSession';
import type { UndoController } from '../../editor/UndoController';
import type { I18n } from '../../i18n/I18n';

export interface ContentsBlockDeps {
  i18n: I18n;
  session: EditorSession;
  camera: Camera;
  layout: PageLayout;
  texts: Pick<TextLayout, 'naturalWidth'>;
  undo: Pick<UndoController, 'record'>;
  makeId: () => string;
  /** The colour text starts with. */
  textColor: () => string;
  toast: (message: string) => void;
}

/** The table of contents on a page: an ordinary text box of links, which can be written again. */
export class ContentsBlock {
  constructor(private readonly deps: ContentsBlockDeps) {}

  /** Puts the contents at the top of what is visible of the current page, as one undo step. */
  insert(): void {
    const { session, camera, layout } = this.deps;
    const page = session.currentPage();
    if (!page) return;
    const y = Math.max(CARD_MARGIN, camera.y + camera.topPad / camera.z - layout.pos(page).y);
    const item = this.written(page, {
      id: this.deps.makeId(),
      x: CARD_MARGIN,
      y: Math.min(y, page.h * MM - CARD_MARGIN),
      w: page.w * MM - CARD_MARGIN * 2,
      t: '',
      fs: CONTENTS_FONT_SIZE,
      c: this.deps.textColor(),
      toc: true,
    });
    if (!item) return;
    this.deps.undo.record(page);
    page.texts = [...page.texts, item];
    session.touch(page);
  }

  /** Writes a table of contents again, from the anchors and page numbers as they are now. */
  update(page: Page, item: TextItem): void {
    const updated = this.written(page, item);
    if (!updated || !page.texts.some((other) => other.id === item.id)) return;
    this.deps.undo.record(page);
    page.texts = page.texts.map((other) => (other.id === item.id ? updated : other));
    this.deps.session.touch(page);
  }

  private written(page: Page, item: TextItem): TextItem | null {
    const { i18n, session, texts } = this.deps;
    const entries = TableOfContents.entries(page.nbId, session.pages);
    if (!entries.length) {
      this.deps.toast(i18n.t('contentsEmpty'));
      return null;
    }
    const { fs, c } = item;
    const paras = TableOfContents.paragraphs(entries, {
      width: item.w,
      pageLabel: (n) => i18n.t('contentsPage', { n }),
      measure: (t) => texts.naturalWidth({ t, paras: [{ runs: [{ t }] }], fs, c }),
    });
    return { ...item, paras, t: RichText.plainText(paras) };
  }
}
