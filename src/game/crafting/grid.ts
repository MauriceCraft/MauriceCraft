/** Trim empty crafting-grid borders before checking shaped recipes. */
export function cropGrid(grid: readonly number[], size: number): number[][] | null {
  let r0 = 99, r1 = -1, c0 = 99, c1 = -1;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r * size + c]) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
  if (r1 < 0) return null;
  const out: number[][] = [];
  for (let r = r0; r <= r1; r++) { const row: number[] = []; for (let c = c0; c <= c1; c++) row.push(grid[r * size + c]); out.push(row); }
  return out;
}
export function samePattern(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean {
  if (a.length !== b.length || a[0].length !== b[0].length) return false;
  for (let r = 0; r < a.length; r++) for (let c = 0; c < a[0].length; c++) if (a[r][c] !== b[r][c]) return false;
  return true;
}
