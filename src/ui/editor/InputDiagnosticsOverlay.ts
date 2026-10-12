import { PALM_SIZE_PX } from '../../core/constants';
import { byId } from '../../core/utils/dom';
import type { I18n } from '../../i18n/I18n';
import { InputLog, type InputLogEntry, type InputSample } from '../../input/InputLog';

/**
 * Hidden "input diagnostics" overlay: the last pointer events with their type, id, contact size,
 * pressure, buttons and how the router classified them, to tune palm rejection on a real tablet.
 *
 * Opened by a long press on "Draw with finger" in the editor's ⋯ menu. Off by default, never
 * stored, plain text only (`textContent`); nothing leaves the device.
 */
export class InputDiagnosticsOverlay {
  private readonly node = byId('inputDiag');
  private readonly log = new InputLog();
  private frame = 0;

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
    this.node.textContent = [...head, ...this.log.entries.map(InputDiagnosticsOverlay.line)].join('\n');
  }

  /** Cancels a pending redraw. */
  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
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
