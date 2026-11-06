import { MAX_ATTACHMENT_PDF_BYTES, STORAGE_ROOM_FACTOR } from '../core/constants';
import { sniffBytes } from '../core/utils/files';

/** Why a file cannot be attached. */
export type PdfRejection = 'too-large' | 'wrong-type' | 'no-space';

/** What the browser says about its storage; either figure may be unknown. */
export interface StorageFigures {
  quota?: number;
  usage?: number;
}

/** Hex digits of a SHA-256 kept in a blob id (ids are at most 40 characters long). */
const FILE_ID_LENGTH = 40;

/** Pure rules for attached PDF files. Nothing about a file is trusted but its own bytes. */
export class AttachmentRules {
  /** Why these bytes cannot be attached, or null. The name and the declared type do not count. */
  static reject(size: number, head: Uint8Array): PdfRejection | null {
    if (size > MAX_ATTACHMENT_PDF_BYTES) return 'too-large';
    return sniffBytes(head) === 'application/pdf' ? null : 'wrong-type';
  }

  /** Whether `bytes` more fit, with room to spare. An unknown quota gets the benefit of the doubt. */
  static hasRoom(figures: StorageFigures | null, bytes: number): boolean {
    if (figures?.quota === undefined || figures.usage === undefined) return true;
    return figures.quota - figures.usage >= bytes * STORAGE_ROOM_FACTOR;
  }

  /**
   * The ids of a file and its thumbnail come from its content, so the same PDF attached twice is
   * one stored blob. What keeps it stored is that some page names it; nothing counts references,
   * so no count can ever disagree with the pages.
   */
  static idsFromHash(hash: string): { file: string; thumb: string } {
    return { file: hash.slice(0, FILE_ID_LENGTH), thumb: 't' + hash.slice(0, FILE_ID_LENGTH - 1) };
  }
}
