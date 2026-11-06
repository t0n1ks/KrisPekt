import type { InternalLink } from '../core/types';

/**
 * A copied link to a place in the notes. It stays inside the app and is gone when the app closes:
 * internal ids mean nothing elsewhere, and do not belong in the system clipboard.
 */
export class LinkClipboard {
  private link: InternalLink | null = null;

  get current(): InternalLink | null {
    return this.link;
  }

  copy(link: InternalLink): void {
    this.link = link;
  }
}
