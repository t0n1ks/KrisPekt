import type { Camera } from './Camera';

/** Sizes the stage canvases to the camera's viewport at the device pixel ratio. */
export class StageCanvas {
  constructor(private readonly canvases: readonly HTMLCanvasElement[]) {}

  /** Matches backing-store size to CSS size × dpr (capped at 2 by the camera). */
  fit(camera: Camera): void {
    for (const canvas of this.canvases) {
      canvas.width = Math.round(camera.width * camera.dpr);
      canvas.height = Math.round(camera.height * camera.dpr);
      canvas.style.width = camera.width + 'px';
      canvas.style.height = camera.height + 'px';
    }
  }
}
