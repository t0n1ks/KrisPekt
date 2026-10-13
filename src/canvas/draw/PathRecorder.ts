import type { PathSink } from '../brushes/PathSink';

/** One recorded path command, in the coordinates it was given. */
export type PathCommand =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'Q'; cpx: number; cpy: number; x: number; y: number }
  | { op: 'A'; x: number; y: number; r: number; start: number; end: number; ccw: boolean }
  | { op: 'Z' };

/**
 * A path kept as data: the vector PDF backend replays it into PDF operators, and tests
 * inspect it. Commands are stored exactly as the geometry emitted them (arcs stay arcs).
 */
export class PathRecorder implements PathSink {
  readonly commands: PathCommand[] = [];

  moveTo(x: number, y: number): void {
    this.commands.push({ op: 'M', x, y });
  }

  lineTo(x: number, y: number): void {
    this.commands.push({ op: 'L', x, y });
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.commands.push({ op: 'Q', cpx, cpy, x, y });
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.commands.push({ op: 'A', x, y, r: radius, start: startAngle, end: endAngle, ccw: counterclockwise });
  }

  closePath(): void {
    this.commands.push({ op: 'Z' });
  }

  /** Whether every coordinate is a finite number. */
  isFinite(): boolean {
    return this.commands.every((c) =>
      Object.values(c).every((v) => typeof v !== 'number' || Number.isFinite(v)),
    );
  }
}
