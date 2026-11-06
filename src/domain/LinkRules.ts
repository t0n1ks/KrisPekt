import { MAX_RECENT_LINKS } from '../core/constants';
import type { InternalLink, LinkTarget } from '../core/types';

/** What is true of every link, whatever it leads to. Pure. */
export class LinkRules {
  /** Whether a link leads somewhere inside the app rather than to the web. */
  static isInternal(link: LinkTarget): link is InternalLink {
    return link.kind !== 'url';
  }

  /** A string that is equal for links that lead to the same place. */
  static key(link: LinkTarget): string {
    if (link.kind === 'url') return 'url:' + link.href;
    return link.kind === 'notebook' ? 'notebook:' + link.nb : `${link.kind}:${link.nb}:${link.id}`;
  }

  /** Whether two links lead to the same place. */
  static same(a: LinkTarget | undefined, b: LinkTarget | undefined): boolean {
    if (!a || !b) return a === b;
    return LinkRules.key(a) === LinkRules.key(b);
  }

  /** The recently used targets with this one first. */
  static pushRecent(list: readonly InternalLink[], link: InternalLink): InternalLink[] {
    return [link, ...list.filter((other) => !LinkRules.same(other, link))].slice(0, MAX_RECENT_LINKS);
  }
}
