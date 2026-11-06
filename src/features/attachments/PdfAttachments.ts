import type { PdfCard } from '../../core/types';
import { sha256Hex } from '../../core/utils/files';
import { AttachmentRules, type StorageFigures } from '../../domain/AttachmentRules';
import { FileNames } from '../../domain/FileNames';
import type { BlobRepository } from '../../storage/BlobRepository';
import type { PdfFacts } from './PdfInspector';
import { PdfRejectedError } from './PdfRejectedError';

const PDF_TYPE = 'application/pdf';
const HEAD_BYTES = 16;
/** The name of a file whose own name leaves nothing usable. */
const FALLBACK_NAME = 'document.pdf';

export interface PdfAttachmentsDeps {
  blobs: Pick<BlobRepository, 'get' | 'save'>;
  inspect: (bytes: Uint8Array) => Promise<PdfFacts>;
  /** What the browser says about its storage; null when it does not say. */
  storage: () => Promise<StorageFigures | null>;
  /** For browsers without hashing: such files are simply not deduplicated. */
  makeId: () => string;
}

/** A checked file in memory, waiting for the user to choose where its card goes. */
export interface PreparedPdf {
  file: Blob;
  thumb: Blob | null;
  /** The card's fields that come from the file. */
  fields: Pick<PdfCard, 'kind' | 'blob' | 'thumb' | 'name' | 'pages' | 'bytes' | 'problem'>;
}

/**
 * Takes in PDF files for attachment cards. The file is hostile until proven otherwise: only its
 * size and first bytes decide whether it is accepted. Nothing is stored until {@link store}, so
 * cancelling leaves nothing behind.
 */
export class PdfAttachments {
  constructor(private readonly deps: PdfAttachmentsDeps) {}

  /** Checks a file and reads what a card shows. Throws {@link PdfRejectedError}. */
  async prepare(source: Blob, fileName: string): Promise<PreparedPdf> {
    const early = AttachmentRules.reject(
      source.size,
      new Uint8Array(await source.slice(0, HEAD_BYTES).arrayBuffer()),
    );
    if (early) throw new PdfRejectedError(early);
    // In memory from here on: a file handle from the picker may stop working while the user chooses.
    const bytes = new Uint8Array(await source.arrayBuffer());
    const hash = await sha256Hex(bytes);
    const ids = hash
      ? AttachmentRules.idsFromHash(hash)
      : { file: this.deps.makeId(), thumb: this.deps.makeId() };
    const stored = await this.deps.blobs.get(ids.file);
    if (!stored && !AttachmentRules.hasRoom(await this.deps.storage(), source.size)) {
      throw new PdfRejectedError('no-space');
    }
    const facts = await this.deps.inspect(bytes);
    const fields: PreparedPdf['fields'] = {
      kind: 'pdf',
      blob: ids.file,
      thumb: facts.thumb ? ids.thumb : null,
      name: FileNames.sanitize(fileName, FALLBACK_NAME),
      pages: facts.pages,
      bytes: source.size,
    };
    if (facts.problem) fields.problem = facts.problem;
    return { file: new Blob([bytes], { type: PDF_TYPE }), thumb: facts.thumb, fields };
  }

  /** Stores the file and its thumbnail. The same id means the same content, so it is one record. */
  async store(prepared: PreparedPdf): Promise<void> {
    await this.deps.blobs.save(prepared.fields.blob, prepared.file);
    if (prepared.thumb && prepared.fields.thumb) {
      await this.deps.blobs.save(prepared.fields.thumb, prepared.thumb);
    }
  }
}
