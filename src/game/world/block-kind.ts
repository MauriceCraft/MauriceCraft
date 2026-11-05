export type ToolKind = 'pickaxe' | 'axe' | 'shovel';
/** Use canonical IDs so mining speed and tool requirements stay stable. */
export function blockKind(b: number): ToolKind | null {
  if (b === 3 || b === 8 || b === 9 || b === 10 || b === 11 || b === 14 || b === 15 || (b >= 27 && b <= 33)) return 'pickaxe';
  if (b === 5 || b === 6 || b === 38 || b === 40 || (b >= 41 && b <= 47) || b === 7 || b === 13 || b === 18) return 'axe';
  if (b === 1 || b === 2 || b === 4 || b === 12 || b === 37 || b === 39 || b === 48 || b === 49) return 'shovel';
  return null;
}
