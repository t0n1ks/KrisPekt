import type { PdfRejection } from '../../domain/AttachmentRules';

/** A file that cannot be attached; the reason decides what the user is told. */
export class PdfRejectedError extends Error {
  constructor(readonly reason: PdfRejection) {
    super('PDF rejected: ' + reason);
    this.name = 'PdfRejectedError';
  }
}
