export const DEG = Math.PI / 180;

export function norm360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

// Normalize to (-180, 180].
export function norm180(deg: number): number {
  const d = norm360(deg);
  return d > 180 ? d - 360 : d;
}

// Signed shortest-arc difference a - b in (-180, 180].
export function angleDiff(a: number, b: number): number {
  return norm180(a - b);
}

// Mean of angles via unit vectors; NaN when all inputs are NaN.
export function circularMean(degs: ArrayLike<number>): number {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = 0; i < degs.length; i++) {
    const d = degs[i];
    if (Number.isNaN(d)) continue;
    x += Math.cos(d * DEG);
    y += Math.sin(d * DEG);
    n++;
  }
  if (n === 0) return NaN;
  return norm360(Math.atan2(y, x) / DEG);
}

// EWMA over an angle series that never averages across the 0/360 seam.
export function circularEwma(degs: ArrayLike<number>, alpha: number): Float64Array {
  const out = new Float64Array(degs.length);
  let x = NaN;
  let y = NaN;
  for (let i = 0; i < degs.length; i++) {
    const d = degs[i];
    if (Number.isNaN(d)) {
      out[i] = Number.isNaN(x) ? NaN : norm360(Math.atan2(y, x) / DEG);
      continue;
    }
    const cx = Math.cos(d * DEG);
    const cy = Math.sin(d * DEG);
    if (Number.isNaN(x)) {
      x = cx;
      y = cy;
    } else {
      x += alpha * (cx - x);
      y += alpha * (cy - y);
    }
    out[i] = norm360(Math.atan2(y, x) / DEG);
  }
  return out;
}

// Shortest-arc interpolation from a toward b by fraction f in [0,1].
export function lerpAngle(a: number, b: number, f: number): number {
  return norm360(a + angleDiff(b, a) * f);
}
