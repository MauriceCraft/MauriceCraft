/** Minecraft-style absolute and tilde-relative command coordinates. */
export function coord(tok: string | undefined, base: number): number {
  if (tok === undefined) throw new Error('Missing a coordinate');
  if (tok.charAt(0) === '~') {
    const off = tok.length > 1 ? parseFloat(tok.slice(1)) : 0;
    if (!isFinite(off)) throw new Error('"' + tok + '" is not a number');
    return base + off;
  }
  const v = parseFloat(tok);
  if (!isFinite(v)) throw new Error('"' + tok + '" is not a number');
  return v;
}
