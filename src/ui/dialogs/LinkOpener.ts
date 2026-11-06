import type { LinkTarget } from '../../core/types';
import { SafeUrl } from '../../domain/SafeUrl';
import type { I18n } from '../../i18n/I18n';
import type { DialogFactory } from './DialogFactory';

/** Opens links, always after showing where they lead. The one place the app leaves itself. */
export class LinkOpener {
  constructor(
    private readonly i18n: I18n,
    private readonly dialogs: DialogFactory,
    private readonly notify: (message: string) => void,
  ) {}

  /** Asks, then opens in a new tab that cannot reach back into the app or learn where it came from. */
  async open(target: LinkTarget): Promise<void> {
    // Checked again at the last moment, whatever put the link where it was found.
    const href = SafeUrl.strict(target.href);
    if (!href) {
      this.notify(this.i18n.t('linkInvalid'));
      return;
    }
    const title = this.i18n.t('openLinkQ', { host: SafeUrl.hostname(href) });
    if (!(await this.dialogs.confirm(title, href, this.i18n.t('open'), false))) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}
