import { blockKind } from '../world/block-kind';

export interface ToolUsageDependencies {
  getMode: () => string;
  getSelectedItem: () => number;
  inventory: Record<number, number>;
  wear: Record<number, number>;
  tools: Readonly<Record<number, { kind: string; tier: number }>>;
  names: Readonly<Record<number, string>>;
  maxWear: readonly number[];
  toolLevels: readonly number[];
  toolSpeeds: readonly number[];
  toolDamages: Readonly<Record<string, readonly number[]>>;
  requiresPick: Readonly<Record<number, number>>;
  updateHotbar: () => void;
  flashName: (message: string) => void;
  showHint: (message: string, ms: number) => void;
  playSound: (sound: string) => void;
  exert: (amount: number) => void;
}

/** Item use and mining rules, independent of input and Three.js. */
export function createToolUsage(deps: ToolUsageDependencies) {
  const { inventory, wear, tools, names } = deps;

  function heldTool() {
    const id = deps.getSelectedItem();
    const tool = tools[id];
    if (!tool || deps.getMode() === 'adventure' || deps.getMode() === 'spectator') return null;
    if (deps.getMode() === 'survival' && !(inventory[id] > 0)) return null;
    return { id, kind: tool.kind, tier: tool.tier };
  }

  function toolSpeed(block: number): number {
    const tool = heldTool();
    if (!tool) return 1;
    if (tool.kind === blockKind(block)) return deps.toolSpeeds[tool.tier];
    if (tool.kind === 'sword' && (block === 6 || block === 13)) return 2;
    return 1;
  }

  function canCollect(block: number): boolean {
    if (!(block in deps.requiresPick)) return true;
    const tool = heldTool();
    return !!tool && tool.kind === 'pickaxe' &&
      deps.toolLevels[tool.tier] >= deps.requiresPick[block];
  }

  function wearTool(id: number, amount: number): void {
    if (deps.getMode() !== 'survival') return;
    wear[id] = (wear[id] || 0) + amount;
    if (wear[id] >= deps.maxWear[tools[id].tier]) {
      wear[id] = 0;
      inventory[id] = Math.max(0, (inventory[id] || 0) - 1);
      deps.flashName('Your ' + names[id].toLowerCase() + ' broke!');
      deps.playSound('die');
    }
    deps.updateHotbar();
  }

  function attackDamage(): number {
    if (deps.getMode() === 'creative') return 20;
    deps.exert(0.08);
    const tool = heldTool();
    if (!tool) return 3;
    wearTool(tool.id, 1);
    return deps.toolDamages[tool.kind][tool.tier];
  }

  function spendItem(id: number): boolean {
    if (deps.getMode() !== 'survival') return true;
    if (!(inventory[id] > 0)) {
      deps.showHint('You have no ' + names[id].toLowerCase() + '.', 1500);
      return false;
    }
    inventory[id]--;
    deps.updateHotbar();
    return true;
  }

  return { heldTool, toolSpeed, canCollect, wearTool, attackDamage, spendItem };
}
