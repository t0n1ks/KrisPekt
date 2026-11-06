import type { InternalLink } from '../../core/types';
import { el, replaceChildren } from '../../core/utils/dom';
import { TableOfContents, type ContentsEntry } from '../../domain/TableOfContents';
import type { EditorSession } from '../../editor/EditorSession';
import type { I18n } from '../../i18n/I18n';
import type { DialogFactory } from '../dialogs/DialogFactory';
import type { Sheet } from '../dialogs/Sheet';
import { icon, type IconName } from '../icons';

export interface AnchorsPanelHandlers {
  jump(link: InternalLink): void;
  rename(anchorId: string): Promise<void>;
  remove(anchorId: string): Promise<void>;
  copyLink(link: InternalLink): void;
  /** Bookmarks the current page. */
  addToCurrentPage(): Promise<unknown>;
  insertContents(): void;
}

/** The notebook's contents: its bookmarks in page order, to go to, rename, delete or link to. */
export class AnchorsPanel {
  private readonly list = el('div', { class: 'anchor-list' });
  private sheet: Sheet | null = null;

  constructor(
    private readonly i18n: I18n,
    private readonly dialogs: DialogFactory,
    private readonly session: EditorSession,
    private readonly handlers: AnchorsPanelHandlers,
  ) {}

  open(): void {
    const { i18n, handlers } = this;
    this.render();
    this.sheet = this.dialogs.sheet({
      title: i18n.t('bookmarks'),
      body: this.list,
      actions: [
        {
          label: i18n.t('bookmarkThisPage'),
          onClick: async () => {
            await handlers.addToCurrentPage();
            this.render();
            return false;
          },
        },
        { label: i18n.t('contentsInsert'), primary: true, onClick: () => handlers.insertContents() },
      ],
      onClose: () => (this.sheet = null),
    });
  }

  private entries(): ContentsEntry[] {
    const nb = this.session.notebook;
    return nb ? TableOfContents.entries(nb.id, this.session.pages) : [];
  }

  private render(): void {
    const entries = this.entries();
    if (!entries.length) {
      replaceChildren(this.list, el('p', { class: 'hint' }, this.i18n.t('bookmarksEmpty')));
      return;
    }
    replaceChildren(this.list, ...entries.map((entry) => this.row(entry)));
  }

  private row(entry: ContentsEntry): HTMLElement {
    const { i18n, handlers } = this;
    const { target } = entry;
    const id = target.kind === 'anchor' ? target.id : '';
    return el(
      'div',
      { class: 'anchor-list__row' },
      el(
        'button',
        {
          class: 'anchor-list__jump',
          attrs: { type: 'button' },
          on: {
            click: () => {
              this.sheet?.close();
              handlers.jump(target);
            },
          },
        },
        el('span', { class: 'anchor-list__name' }, entry.name),
        el('span', { class: 'anchor-list__page' }, i18n.t('contentsPage', { n: entry.page })),
      ),
      this.action('edit', i18n.t('bookmarkRename'), async () => {
        await handlers.rename(id);
        this.render();
      }),
      this.action('copy', i18n.t('cardCopyLink'), () => handlers.copyLink(target)),
      this.action('trash', i18n.t('bookmarkDelete'), async () => {
        await handlers.remove(id);
        this.render();
      }),
    );
  }

  private action(name: IconName, label: string, onClick: () => unknown): HTMLElement {
    return el(
      'button',
      {
        class: 'icon-btn anchor-list__action',
        attrs: { type: 'button', 'aria-label': label, title: label },
        on: { click: () => void onClick() },
      },
      icon(name, 18),
    );
  }
}
