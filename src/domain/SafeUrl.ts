import { MAX_URL_LENGTH } from '../core/constants';

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** `example.com:8080/x` and `localhost:3000` look like a scheme, but are an address and a port. */
const HOST_AND_PORT = /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+):\d+([/?#]|$)/i;

function withoutControlChars(text: string): string {
  return Array.from(text)
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code > 0x1f && (code < 0x7f || code > 0x9f);
    })
    .join('');
}

/**
 * The only way a web address enters the app: typed or pasted by the user, or read from storage
 * and backups. Only `http:` and `https:` pass, so `javascript:`, `data:`, `file:`, `intent:` and
 * `blob:` can never reach `window.open` or a PDF link. Pure.
 */
export class SafeUrl {
  /**
   * The normalised address of what was stored or imported, or null if it must not be used. An
   * address with a user name is refused: `https://bank.com@evil.com` leads to evil.com.
   */
  static strict(raw: string): string | null {
    if (raw.length > MAX_URL_LENGTH) return null;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!ALLOWED_PROTOCOLS.has(url.protocol) || !url.hostname) return null;
    if (url.username || url.password) return null;
    return url.href.length > MAX_URL_LENGTH ? null : url.href;
  }

  /** The address meant by what the user typed: trimmed, with `https://` added if it has no scheme. */
  static fromInput(raw: string): string | null {
    const text = withoutControlChars(raw).trim();
    if (!text) return null;
    if (HAS_SCHEME.test(text) && !HOST_AND_PORT.test(text)) return SafeUrl.strict(text);
    const href = SafeUrl.strict('https://' + text.replace(/^\/\//, ''));
    if (!href) return null;
    // A lone word is a typo far more often than a host on the local network.
    const host = new URL(href).hostname;
    return host.includes('.') || host.includes(':') || host === 'localhost' ? href : null;
  }

  /** The host to show, so the user always sees where a link leads. Foreign names stay in punycode. */
  static hostname(href: string): string {
    try {
      return new URL(href).hostname;
    } catch {
      return '';
    }
  }
}
