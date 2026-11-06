import { PALM_SIZE_PX } from '../../core/constants';
import type { ScratchDecision, ScratchReport } from '../../editor/ScratchOutController';
import { byId } from '../../core/utils/dom';
import type { I18n, TextKey } from '../../i18n/I18n';
import { InputLog, type InputLogEntry, type InputSample } from '../../input/InputLog';

const DECISIONS: Record<ScratchDecision, TextKey> = {
  off: 'scratchDiagOff',
  writing: 'scratchDiagWriting',
  nothing: 'scratchDiagNothing',
  erased: 'scratchDiagErased',
};

/**
 * Hidden "input diagnostics" overlay: the last pointer events with their type, id, contact size,
 * pressure, buttons and how the router classified them, to tune palm rejection on a real tablet.
 * It also shows how many lost items were moved back onto their pages when the notebook opened, and
 * how the last pen stroke was judged as a scribble, to tune scratch-out.
 *
 * Opened by a long press on "Draw with finger" in the editor's ⋯ menu. Off by default, never
 * stored, plain text only (`textContent`); nothing leaves the device.
 */
export class InputDiagnosticsOverlay {
  private readonly node = byId('inputDiag');
  private readonly log = new InputLog();
  private frame = 0;
  private repaired = 0;
  private scratch: ScratchReport | null = null;

  constructor(private readonly i18n: I18n) {}

  get visible(): boolean {
    return !this.node.hidden;
  }

  /** Shows or hides the overlay; hiding forgets the logged events. */
  setVisible(on: boolean): void {
    this.node.hidden = !on;
    this.log.clear();
    if (on) this.render();
    else this.destroy();
  }

  /** How many items lying outside their pages were moved back when the notebook was opened. */
  noteRepaired(count: number): void {
    this.repaired = count;
    if (this.visible) this.update();
  }

  /** How the last pen stroke was judged; kept while hidden, to be there when the overlay opens. */
  noteScratch(report: ScratchReport): void {
    this.scratch = report;
    if (this.visible) this.update();
  }

  /** Records a pointer event while the overlay is visible. */
  record(sample: InputSample): void {
    if (!this.visible) return;
    this.log.push(sample);
    this.update();
  }

  /** Redraws on the next frame (pointer events arrive faster than the screen refreshes). */
  update(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render(): void {
    const head = [this.i18n.t('inputDiagTitle', { n: PALM_SIZE_PX }), this.i18n.t('inputDiagLegend')];
    if (this.repaired) head.push(this.i18n.t('inputDiagRepaired', { n: this.repaired }));
    if (this.scratch) head.push(...this.scratchLines(this.scratch));
    this.node.textContent = [...head, ...this.log.entries.map(InputDiagnosticsOverlay.line)].join('\n');
  }

  /** Cancels a pending redraw. */
  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Each measure with the limit it has to meet, so that it is clear which one decided. */
  private scratchLines(report: ScratchReport): string[] {
    const { metrics, limits, coverage, decision } = report;
    const { i18n } = this;
    const shape = i18n.t('scratchDiagShape', {
      reversals: metrics.reversals,
      minReversals: limits.minReversals,
      density: metrics.density.toFixed(1),
      minDensity: limits.minDensity,
      pitch: metrics.pitch.toFixed(2),
      maxPitch: limits.maxPitch,
      winding: metrics.winding.toFixed(2),
      maxWinding: limits.maxWinding,
    });
    const covered = coverage
      ? i18n.t('scratchDiagCoverage', {
          hit: coverage.hit,
          near: coverage.near,
          best: Math.round(coverage.best * 100),
          min: Math.round(limits.minCoverage * 100),
        })
      : null;
    return [shape, ...(covered ? [covered] : []), '→ ' + i18n.t(DECISIONS[decision])];
  }

  /** One event: `touch #7 34×29 p1.00 b1 move×12 → palm ✎` (`*`: size from Touch Events). */
  private static line(entry: InputLogEntry): string {
    const size = `${Math.round(entry.width)}×${Math.round(entry.height)}${entry.sizeFromTouch ? '*' : ''}`;
    const event = entry.count > 1 ? `${entry.event}×${entry.count}` : entry.event;
    const role = entry.role && entry.role !== entry.cls ? `/${entry.role}` : '';
    return [
      entry.pointerType.padEnd(5),
      `#${entry.pointerId}`,
      size,
      `p${entry.pressure.toFixed(2)}`,
      `b${entry.buttons}`,
      event,
      `→ ${entry.cls}${role}`,
      entry.session ? '✎' : '',
    ]
      .join(' ')
      .trimEnd();
  }
}
