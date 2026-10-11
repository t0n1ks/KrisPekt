import { describe, expect, it } from 'vitest';
import { Ruler } from '../../src/tools/Ruler';

function ruler(): Ruler {
  const r = new Ruler();
  r.on = true;
  r.cx = 200;
  r.cy = 200;
  r.length = 300;
  r.angle = 0;
  return r;
}

describe('Ruler', () => {
  it('does not snap when hidden or far away', () => {
    const r = ruler();
    expect(r.snap({ x: 200, y: 100 })).toBeNull();
    expect(r.snap({ x: 500, y: 168 })).toBeNull();
    r.on = false;
    expect(r.snap({ x: 200, y: 168 })).toBeNull();
  });

  it('snaps to the nearest long edge', () => {
    const r = ruler();
    expect(r.snap({ x: 210, y: 160 })?.edge).toBe(-32);
    expect(r.snap({ x: 210, y: 245 })?.edge).toBe(32);
  });

  it('projects onto the edge, outside it by half the stroke width', () => {
    const r = ruler();
    const snap = r.snap({ x: 210, y: 160 });
    expect(snap).not.toBeNull();
    if (!snap) return;
    const p = r.project({ x: 250, y: 150 }, snap, 4);
    expect(p.x).toBeCloseTo(250);
    expect(p.y).toBeCloseTo(200 - 32 - 3);
  });

  it('snaps rotation to 45° steps within 2.5°', () => {
    expect(Ruler.snapAngle((44 * Math.PI) / 180)).toBeCloseTo(Math.PI / 4);
    expect(Ruler.snapAngle((40 * Math.PI) / 180)).toBeCloseTo((40 * Math.PI) / 180);
  });

  it('reports the angle in 0–179°', () => {
    const r = ruler();
    r.angle = -Math.PI / 4;
    expect(r.degrees).toBe(135);
  });
});
