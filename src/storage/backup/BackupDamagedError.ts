/** A backup that fails a check of its own content, as opposed to data of the wrong shape. */
export class BackupDamagedError extends Error {
  constructor(problem: string) {
    super('Damaged backup: ' + problem);
    this.name = 'BackupDamagedError';
  }
}
