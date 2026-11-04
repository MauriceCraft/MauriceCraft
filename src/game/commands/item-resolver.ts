/**
 * Command item names support spaces, underscores and unique abbreviations.
 * Keep matching rules stable for existing /give, /fill and /setblock commands.
 */
export function createItemResolver(
  names: Readonly<Record<number, string>>,
  bedId: number,
) {
  const slug = (value: unknown): string =>
    String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  let cachedItems: Record<string, number> | null = null;
  function itemMap(): Record<string, number> {
    if (!cachedItems) {
      const map: Record<string, number> = {};
      Object.keys(names).forEach(key => { map[slug(names[Number(key)])] = Number(key); });
      cachedItems = map;
    }
    return cachedItems;
  }
  function findItem(name: string, blocksOnly = false): number {
    const map = itemMap(), q = slug(name).replace(/_/g, '');
    const keys = Object.keys(map).filter(k => !blocksOnly || (map[k] < 100 && map[k] !== bedId));
    const flat = (k: string): string => k.replace(/_/g, '');
    const exact = keys.filter(k => flat(k) === q);
    if (exact.length) return map[exact[0]];
    const pre = keys.filter(k => flat(k).indexOf(q) === 0);
    if (pre.length === 1) return map[pre[0]];
    const has = keys.filter(k => flat(k).indexOf(q) >= 0);
    if (has.length === 1) return map[has[0]];
    const cand = pre.length ? pre : has;
    throw new Error('Unknown ' + (blocksOnly ? 'block' : 'item') + ' "' + name + '"' +
      (cand.length ? '. Did you mean: ' + cand.slice(0, 6).join(', ') + '?' : ''));
  }
  return { slug, itemMap, findItem };
}
