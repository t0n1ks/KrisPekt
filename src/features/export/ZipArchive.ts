/** A file to put into an archive or save on its own. */
export interface ExportFile {
  name: string;
  blob: Blob;
}

/**
 * Packs files into one ZIP with fflate, loaded only when a ZIP is made. PNGs are already
 * compressed, so files are stored without compression: faster, and no bigger.
 */
export class ZipArchive {
  private module: Promise<typeof import('fflate')> | null = null;

  private load(): Promise<typeof import('fflate')> {
    if (!this.module) {
      this.module = import('fflate');
      this.module.catch(() => {
        this.module = null;
      });
    }
    return this.module;
  }

  /** The files as a ZIP blob (names must be unique). */
  async build(files: readonly ExportFile[]): Promise<Blob> {
    const { zipSync } = await this.load();
    const entries: Record<string, Uint8Array> = {};
    for (const file of files) entries[file.name] = new Uint8Array(await file.blob.arrayBuffer());
    return new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' });
  }
}
