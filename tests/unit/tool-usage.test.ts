import { describe, expect, it, vi } from 'vitest';
import { createToolUsage, type ToolUsageDependencies } from '../../src/game/items/tool-usage';

function fixture() {
  let mode = 'survival';
  let selectedItem = 100;
  const inventory: Record<number, number> = { 100: 1, 17: 2 };
  const wear: Record<number, number> = {};
  const flashName = vi.fn();
  const showHint = vi.fn();
  const playSound = vi.fn();
  const updateHotbar = vi.fn();
  const exert = vi.fn();
  const deps: ToolUsageDependencies = {
    getMode: () => mode,
    getSelectedItem: () => selectedItem,
    inventory, wear,
    tools: { 100: { kind: 'pickaxe', tier: 1 }, 101: { kind: 'sword', tier: 0 } },
    names: { 100: 'Stone Pickaxe', 101: 'Wooden Sword', 17: 'Torch' },
    maxWear: [40, 90],
    toolLevels: [0, 1],
    toolSpeeds: [2.4, 4],
    toolDamages: { pickaxe: [4, 6], sword: [6, 8] },
    requiresPick: { 3: 0, 30: 2 },
    updateHotbar, flashName, showHint, playSound, exert,
  };
  const actions = createToolUsage(deps);
  return {
    actions, inventory, wear, flashName, showHint, playSound, updateHotbar, exert,
    select: (id: number) => { selectedItem = id; }, setMode: (next: string) => { mode = next; },
  };
}

describe('selected tool and inventory rules', () => {
  it('restricts survival mining to owned tools with enough tier', () => {
    const f = fixture();
    expect(f.actions.heldTool()).toEqual({ id: 100, kind: 'pickaxe', tier: 1 });
    expect(f.actions.canCollect(3)).toBe(true);
    expect(f.actions.canCollect(30)).toBe(false);
    expect(f.actions.canCollect(6)).toBe(true);
    f.inventory[100] = 0;
    expect(f.actions.heldTool()).toBeNull();
    expect(f.actions.canCollect(3)).toBe(false);
    f.setMode('creative');
    expect(f.actions.heldTool()?.tier).toBe(1);
    f.setMode('spectator');
    expect(f.actions.heldTool()).toBeNull();
  });

  it('keeps the same block mining speed and sword leaf shortcut', () => {
    const f = fixture();
    expect(f.actions.toolSpeed(3)).toBe(4);
    f.select(101);
    f.inventory[101] = 1;
    expect(f.actions.toolSpeed(6)).toBe(2);
    expect(f.actions.toolSpeed(3)).toBe(1);
  });

  it('damages and breaks a worn tool without deleting unrelated inventory', () => {
    const f = fixture();
    f.wear[100] = 89;
    expect(f.actions.attackDamage()).toBe(6);
    expect(f.wear[100]).toBe(0);
    expect(f.inventory[100]).toBe(0);
    expect(f.inventory[17]).toBe(2);
    expect(f.flashName).toHaveBeenCalledWith('Your stone pickaxe broke!');
    expect(f.playSound).toHaveBeenCalledWith('die');
    expect(f.exert).toHaveBeenCalledWith(0.08);
    expect(f.updateHotbar).toHaveBeenCalled();
  });

  it('consumes items only in survival and explains missing inventory', () => {
    const f = fixture();
    expect(f.actions.spendItem(17)).toBe(true);
    expect(f.inventory[17]).toBe(1);
    f.inventory[17] = 0;
    expect(f.actions.spendItem(17)).toBe(false);
    expect(f.showHint).toHaveBeenCalledWith('You have no torch.', 1500);
    f.setMode('creative');
    expect(f.actions.spendItem(17)).toBe(true);
    expect(f.inventory[17]).toBe(0);
    expect(f.actions.attackDamage()).toBe(20);
  });
});
