/**
 * The path commands brush geometry emits. `Path2D` implements it; unit tests pass a recorder,
 * so the geometry can be checked without a canvas.
 */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  closePath(): void;
}

/** One piece of a stroke's shape, filled with its own opacity (the pencil uses several). */
export interface ShapePart<P extends PathSink = PathSink> {
  path: P;
  alpha: number;
}
