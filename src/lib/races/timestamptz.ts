/** True when two timestamptz wire values refer to the same instant (Z vs +00:00). */
export function sameTimestamptzInstant(left: string, right: string): boolean {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}
