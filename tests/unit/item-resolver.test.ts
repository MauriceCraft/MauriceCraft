import { describe, expect, it } from 'vitest';
import { createItemResolver } from '../../src/game/commands/item-resolver';

const names: Record<number, string> = {
  3: 'Stone', 19: 'Bed', 29: 'Iron Ore', 31: 'Iron Block',
  111: 'Flint & Steel', 151: 'Iron Ingot', 152: 'Diamond',
};

describe('item command resolution', () => {
  const { slug, findItem, itemMap } = createItemResolver(names, 19);
  it('accepts spaces, underscores, and uppercase names', () => {
    expect(slug('Flint & Steel')).toBe('flint_steel');
    expect(findItem('FLINT_STEEL')).toBe(111);
    expect(findItem('ironingot')).toBe(151);
    expect(findItem('iron ingot')).toBe(151);
    expect(itemMap().stone).toBe(3);
  });
  it('allows unique prefixes but reports ambiguous names', () => {
    expect(findItem('flint')).toBe(111);
    expect(() => findItem('iron')).toThrow('Did you mean');
    expect(() => findItem('not_an_item')).toThrow('Unknown item');
  });
  it('limits world-changing commands to actual placeable blocks', () => {
    expect(findItem('stone', true)).toBe(3);
    expect(() => findItem('bed', true)).toThrow('Unknown block');
    expect(() => findItem('iron_ingot', true)).toThrow('Unknown block');
  });
});
