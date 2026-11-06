/** Reports a job's progress as a whole percentage, and only when that number changes. */
export class PercentLine {
  private shown = -1;

  constructor(private readonly show: (percent: number) => void) {}

  /** `done` runs from 0 to 1. */
  report(done: number): void {
    const percent = Math.min(100, Math.max(0, Math.floor(done * 100)));
    if (percent === this.shown) return;
    this.shown = percent;
    this.show(percent);
  }
}
