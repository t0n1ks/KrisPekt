import type { InternalLink, Notebook } from '../../core/types';
import { el, replaceChildren } from '../../core/utils/dom';
import type { LinkDirectory, LinkEntry } from '../../domain/LinkDirectory';
import type { I18n } from '../../i18n/I18n';
import { icon } from '../icons';

export interface LinkTargetPickerDeps {
  i18n: I18n;
  directory: LinkDirectory;
  recent: () => readonly InternalLink[];
  /** The link copied in the app, if any. */
  copied: () => InternalLink | null;
  onPick: (link: InternalLink) => void;
  /** Where the link being edited leads now. */
  current?: InternalLink | null;
}

type View =
  | { kind: 'home' }
  | { kind: 'subject'; id: string; name: string }
  | { kind: 'notebook'; nb: Notebook }
  | { kind: 'page'; nb: Notebook; pageId: string; number: number };

/**
 * Finds a place in the notes: search across every notebook, the recently used, or browsing subject
 * → notebook → page → bookmark. Everything is drawn as text from what is stored.
 */
export class LinkTargetPicker {
  readonly node: HTMLElement;
  private readonly list = el('div', { class: 'link-pick__list' });
  private readonly search: HTMLInputElement;
  private view: View = { kind: 'home' };

  constructor(private readonly deps: LinkTargetPickerDeps) {
    this.search = el('input', {
      class: 'input',
      attrs: {
        type: 'text',
        id: 'linkSearch',
        placeholder: deps.i18n.t('linkPickSearch'),
        'aria-label': deps.i18n.t('linkPickSearch'),
        autocomplete: 'off',
      },
      on: { input: () => this.render() },
    });
    this.node = el('div', { class: 'link-pick' }, this.search, this.list);
    this.render();
  }

  private render(): void {
    const query = this.search.value.trim();
    if (query) replaceChildren(this.list, ...this.results(query));
    else replaceChildren(this.list, ...this.browse());
    this.list.scrollTop = 0;
  }

  private results(query: string): Node[] {
    const found = this.deps.directory.search(query);
    if (!found.length) return [el('p', { class: 'hint' }, this.deps.i18n.t('linkPickNothing'))];
    return found.map((entry) => this.entryRow(entry));
  }

  private browse(): Node[] {
    switch (this.view.kind) {
      case 'home':
        return this.home();
      case 'subject':
        return this.subject(this.view.id, this.view.name);
      case 'notebook':
        return this.notebook(this.view.nb);
      case 'page':
        return this.page(this.view.nb, this.view.pageId, this.view.number);
    }
  }

  private home(): Node[] {
    const { i18n, directory } = this.deps;
    const known = (links: readonly InternalLink[]): LinkEntry[] =>
      links.flatMap((link) => directory.describe(link) ?? []);
    const { current } = this.deps;
    const copied = this.deps.copied();
    return [
      ...this.section(i18n.t('linkPickCurrent'), known(current ? [current] : [])),
      ...this.section(i18n.t('linkPickCopied'), known(copied ? [copied] : [])),
      ...this.section(i18n.t('linkPickRecent'), known(this.deps.recent())),
      el('h3', { class: 'link-pick__heading' }, i18n.t('linkPickBrowse')),
      ...directory
        .subjects()
        .map((subject) =>
          this.row(
            subject.name,
            '',
            () => this.go({ kind: 'subject', id: subject.id, name: subject.name }),
            true,
          ),
        ),
    ];
  }

  private section(title: string, entries: readonly LinkEntry[]): Node[] {
    if (!entries.length) return [];
    return [
      el('h3', { class: 'link-pick__heading' }, title),
      ...entries.map((entry) => this.entryRow(entry)),
    ];
  }

  private subject(id: string, name: string): Node[] {
    return [
      this.up(name, { kind: 'home' }),
      ...this.deps.directory
        .notebooksOf(id)
        .map((nb) => this.row(nb.title, '', () => this.go({ kind: 'notebook', nb }), true)),
    ];
  }

  private notebook(nb: Notebook): Node[] {
    const { i18n, directory } = this.deps;
    const subject = directory.describe({ kind: 'notebook', nb: nb.id })?.subject ?? '';
    return [
      this.up(nb.title, { kind: 'subject', id: nb.subjectId, name: subject }),
      this.row(i18n.t('linkPickWholeNotebook'), '', () => this.deps.onPick({ kind: 'notebook', nb: nb.id })),
      ...nb.pageIds.map((pageId, index) => {
        const count = directory.anchorsOn(nb, pageId).length;
        return this.row(
          i18n.t('linkPageN', { n: index + 1 }),
          count ? i18n.plural(count, 'mark') : '',
          () => this.go({ kind: 'page', nb, pageId, number: index + 1 }),
          true,
        );
      }),
    ];
  }

  private page(nb: Notebook, pageId: string, number: number): Node[] {
    const { i18n, directory } = this.deps;
    return [
      this.up(i18n.t('linkPageN', { n: number }), { kind: 'notebook', nb }),
      this.row(i18n.t('linkPickWholePage'), '', () =>
        this.deps.onPick({ kind: 'page', nb: nb.id, id: pageId }),
      ),
      ...directory.anchorsOn(nb, pageId).map((entry) => this.entryRow(entry)),
    ];
  }

  private go(view: View): void {
    this.view = view;
    this.render();
  }

  private up(title: string, to: View): HTMLElement {
    return el(
      'button',
      {
        class: 'link-pick__up',
        attrs: { type: 'button', 'aria-label': this.deps.i18n.t('linkPickUp') },
        on: { click: () => this.go(to) },
      },
      icon('back', 16),
      el('span', null, title),
    );
  }

  private entryRow(entry: LinkEntry): HTMLElement {
    const { i18n } = this.deps;
    const pages = entry.pageNumber === null ? '' : i18n.t('contentsPage', { n: entry.pageNumber });
    const title =
      entry.target.kind === 'page' ? i18n.t('linkPageN', { n: entry.pageNumber ?? 0 }) : entry.name;
    const where = entry.target.kind === 'notebook' ? entry.subject : entry.notebook;
    const sub = entry.target.kind === 'anchor' ? `${where} · ${pages}` : where;
    return this.row(title, sub, () => this.deps.onPick(entry.target));
  }

  private row(title: string, sub: string, onClick: () => void, drills = false): HTMLElement {
    return el(
      'button',
      { class: 'link-pick__row', attrs: { type: 'button' }, on: { click: onClick } },
      el(
        'span',
        { class: 'link-pick__text' },
        el('span', { class: 'link-pick__title' }, title),
        sub ? el('span', { class: 'link-pick__sub' }, sub) : null,
      ),
      drills ? el('span', { class: 'link-pick__more' }, icon('forward', 16)) : null,
    );
  }
}
