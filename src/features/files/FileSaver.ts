import type { I18n } from '../../i18n/I18n';

/** The optional downloads capability some hosts (claude.ai) inject; absent on GitHub Pages. */
interface HostDownloads {
  save(file: { filename: string; data: Blob }): Promise<unknown>;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

/** How long to wait for the host capability before using a normal download. */
const HOST_TIMEOUT_MS = 8000;

/**
 * Saves a blob as a file. When the page runs inside a host that offers a downloads
 * capability (`window.claude.use('downloads')`), that is used; otherwise a regular
 * `<a download>` click. The object URL is revoked shortly after.
 */
export class FileSaver {
  private host: Promise<HostDownloads | null> | null = null;

  constructor(
    private readonly i18n: I18n,
    private readonly notify: (message: string) => void,
  ) {}

  private hostDownloads(): Promise<HostDownloads | null> {
    if (!this.host) {
      const claude: unknown = (window as unknown as { claude?: unknown }).claude;
      const use =
        typeof claude === 'object' && claude !== null ? (claude as { use?: unknown }).use : undefined;
      this.host =
        typeof use === 'function'
          ? Promise.race([
              Promise.resolve(
                (use as (name: string) => Promise<HostDownloads>).call(claude, 'downloads'),
              ).catch(() => null),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), HOST_TIMEOUT_MS)),
            ])
          : Promise.resolve(null);
    }
    return this.host;
  }

  async save(name: string, blob: Blob): Promise<void> {
    const host = await this.hostDownloads();
    if (host) {
      try {
        await host.save({ filename: name, data: blob });
        this.notify(this.i18n.t('fileSaved'));
        return;
      } catch (error) {
        const code = errorCode(error);
        if (code === 'declined') return;
        if (code === 'rate_limited') return this.notify(this.i18n.t('waitRetry'));
        if (code === 'too_large') return this.notify(this.i18n.t('tooLarge'));
        // Anything else: fall back to a normal download.
      }
    }
    this.download(name, blob);
    this.notify(this.i18n.t('dlStarted'));
  }

  private download(name: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 5000);
  }
}
