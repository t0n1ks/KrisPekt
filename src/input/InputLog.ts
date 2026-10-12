import { INPUT_LOG_SIZE } from '../core/constants';
import type { TouchRole } from '../domain/TouchClassifier';

/** How the input router treated a pointer event. */
export type InputClass = 'pen' | 'mouse' | 'finger' | 'palm' | 'ignored';

/** One pointer event as seen by the input router, for the diagnostics overlay. */
export interface InputSample {
  pointerType: string;
  pointerId: number;
  /** `down`, `move`, `up`, `cancel`, `hover`. */
  event: string;
  width: number;
  height: number;
  /** The size came from `TouchEvent.radiusX/Y` because the pointer event reported none. */
  sizeFromTouch: boolean;
  pressure: number;
  buttons: number;
  cls: InputClass;
  /** The touch role behind `cls`, for touches. */
  role: TouchRole | null;
  /** A writing session was active. */
  session: boolean;
}

/** A logged sample; `count` consecutive events of the same kind were merged into it. */
export interface InputLogEntry extends InputSample {
  count: number;
}

/**
 * The last {@link INPUT_LOG_SIZE} pointer events, newest last. Kept in memory only.
 *
 * Consecutive events of the same pointer, kind and class are merged into one entry (showing
 * the latest values and a count), so a long pen stroke or hover does not push the palm's
 * events out of view.
 */
export class InputLog {
  private readonly samples: InputLogEntry[] = [];

  constructor(private readonly size = INPUT_LOG_SIZE) {}

  /** Adds a sample, merging it into the newest entry when it continues it. */
  push(sample: InputSample): void {
    const last = this.samples[this.samples.length - 1];
    if (last && InputLog.continues(last, sample)) {
      this.samples[this.samples.length - 1] = { ...sample, count: last.count + 1 };
      return;
    }
    this.samples.push({ ...sample, count: 1 });
    if (this.samples.length > this.size) this.samples.splice(0, this.samples.length - this.size);
  }

  private static continues(entry: InputLogEntry, sample: InputSample): boolean {
    return (
      entry.pointerId === sample.pointerId &&
      entry.pointerType === sample.pointerType &&
      entry.event === sample.event &&
      entry.cls === sample.cls &&
      entry.role === sample.role &&
      entry.session === sample.session
    );
  }

  get entries(): readonly InputLogEntry[] {
    return this.samples;
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** The class shown for a pointer type and (for touches) its role. */
  static classify(pointerType: string, role: TouchRole | null): InputClass {
    if (pointerType === 'pen') return 'pen';
    if (pointerType === 'mouse') return 'mouse';
    if (role === 'palm') return 'palm';
    if (role === null || role === 'grip' || role === 'held') return 'ignored';
    return 'finger';
  }
}
