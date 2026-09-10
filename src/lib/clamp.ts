/** NaN collapses to `min` rather than propagating — a NaN fraction paints an empty bar. */
export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return n < min ? min : n > max ? max : n;
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

export function clampMin(n: number, min: number): number {
  if (Number.isNaN(n)) return min;
  return n < min ? min : n;
}
