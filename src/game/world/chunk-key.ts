/** Keep the original 32-bit chunk key encoding for save compatibility. */
export function ckey(cx: number, cz: number): number {
  return ((cx & 0xffff) << 16) | (cz & 0xffff);
}
