import { createHud, type HudDependencies } from './hud';
import { createInventoryUi, type InventoryUiDependencies } from './inventory-ui';
import { createInputControls, type InputControlDependencies } from '../input/game-controls';
import { createRecipeCatalog, type RecipeItemIds } from '../crafting/recipe-catalog';

export interface GameUiCompositionDependencies {
  state: InputControlDependencies['state'] & InventoryUiDependencies['state'];
  player: InputControlDependencies['player'];
  canvas: HTMLCanvasElement;
  atlasCanvas: HTMLCanvasElement;
  tileOf: HudDependencies['tileOf'];
  inventory: Record<number, number>;
  hotbar: number[];
  allBlocks: readonly number[];
  names: HudDependencies['names'];
  tools: HudDependencies['tools'];
  toolMax: readonly number[];
  toolWear: HudDependencies['toolWear'];
  recipeItems: RecipeItemIds;
  itemIds: InventoryUiDependencies['itemIds'];
  toolTiers: readonly string[];
  toolId: (tier: number, kind: number) => number;
  jobNames: InventoryUiDependencies['jobNames'];
  keys: Record<string, boolean>;
  touchMove: { x: number; z: number };
  isTouch: boolean;
  maxHealth: number;
  getMode: () => string;
  getModeLabel: () => string;
  getSelected: () => number;
  setSelected: (slot: number) => void;
  getHealth: () => number;
  setHealth: (health: number) => void;
  getHunger: () => number;
  canInteract: () => boolean;
  getFallback: () => boolean;
  showHint: (message: string, ms: number) => void;
  playSound: (event: string) => void;
  playSoundAt: (event: string, x: number, y: number, z: number) => void;
  requestPointerLock: () => void;
  pauseGame: () => void;
  getCommandBar: () => HTMLElement;
  openCommand: (command: string) => void;
}

/** UI composition only: game state and world rules stay in the gameplay runtime. */
export function createGameUiComposition(deps: GameUiCompositionDependencies) {
  const hud = createHud({
    hotbar: deps.hotbar, inventory: deps.inventory, names: deps.names,
    atlasCanvas: deps.atlasCanvas, tileOf: deps.tileOf,
    tools: deps.tools, toolMax: deps.toolMax, toolWear: deps.toolWear,
    getMode: deps.getMode, getSelected: deps.getSelected, setSelected: deps.setSelected,
    getHunger: deps.getHunger, getHealth: deps.getHealth,
    canInteract: deps.canInteract, maxHealth: deps.maxHealth,
  });
  const recipes = createRecipeCatalog({
    items: deps.recipeItems, toolTiers: deps.toolTiers, toolId: deps.toolId,
  });
  const inventory = createInventoryUi({
    state: deps.state, atlasCanvas: deps.atlasCanvas, tileOf: deps.tileOf,
    inventory: deps.inventory, hotbar: deps.hotbar, allBlocks: deps.allBlocks,
    names: deps.names, recipes, itemIds: deps.itemIds, jobNames: deps.jobNames,
    keys: deps.keys, touchMove: deps.touchMove, isTouch: deps.isTouch,
    getMode: deps.getMode, getModeLabel: deps.getModeLabel,
    getFallback: deps.getFallback,
    getHealth: deps.getHealth, setHealth: deps.setHealth,
    maxHealth: deps.maxHealth, updateHearts: hud.updateHearts,
    updateHotbar: hud.updateHotbar, showHint: deps.showHint,
    playSound: deps.playSound, playSoundAt: deps.playSoundAt,
    requestPointerLock: deps.requestPointerLock, pauseGame: deps.pauseGame,
    getCommandBar: deps.getCommandBar,
  });
  const controls = createInputControls({
    canvas: deps.canvas, keys: deps.keys, touchMove: deps.touchMove,
    player: deps.player, state: deps.state, isTouch: deps.isTouch,
    getMode: deps.getMode, canInteract: deps.canInteract,
    updateHotbar: hud.updateHotbar, showHint: deps.showHint,
    openInventory: inventory.openInventory, openCommand: deps.openCommand,
    pause: deps.pauseGame,
  });
  return { ...hud, ...inventory, ...controls };
}
