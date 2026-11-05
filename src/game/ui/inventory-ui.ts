import { createRecipeMatcher, type Recipe } from '../crafting/recipes';

export type Trade = { give: [number, number]; heal: true; get?: never } |
  { give: [number, number]; get: [number, number]; heal?: false };
export interface TradingMob { job: string; x: number; y: number; z: number }
export interface InventoryUiState {
  selected: number; playing: boolean;
  invOpen: boolean; tradeOpen: boolean; craftOpen: boolean; cmdOpen: boolean;
  mining: boolean; placing: boolean; drag: unknown; touchJump: boolean;
  stick: unknown; lookT: unknown;
}
export interface InventoryUiDependencies {
  state: InventoryUiState;
  atlasCanvas: HTMLCanvasElement;
  tileOf: (block: number) => number | undefined;
  inventory: Record<string, number>;
  hotbar: number[];
  allBlocks: readonly number[];
  names: Readonly<Record<number, string>>;
  recipes: readonly Recipe[];
  itemIds: Record<'HAY' | 'WOOL' | 'BONE' | 'EMERALD' | 'COOKED' | 'BED' | 'BEEF' | 'PORK' | 'CHICKEN' | 'LEATHER' | 'COBBLE' | 'STONEBRICK' | 'SANDSTONE' | 'BRICK' | 'COPPER_INGOT' | 'GUNPOWDER' | 'TORCH' | 'FLINT' | 'DYNAMITE' | 'TNT' | 'IRON_INGOT' | 'COAL' | 'GOLD' | 'DIAMOND', number>;
  jobNames: Readonly<Record<string, string>>;
  keys: Record<string, boolean>;
  touchMove: { x: number; z: number };
  getMode: () => string;
  getModeLabel: () => string;
  getFallback: () => boolean;
  isTouch: boolean;
  getHealth: () => number;
  setHealth: (health: number) => void;
  maxHealth: number;
  updateHearts: () => void;
  updateHotbar: (showName: boolean) => void;
  showHint: (message: string, milliseconds: number) => void;
  playSound: (event: string) => void;
  playSoundAt: (event: string, x: number, y: number, z: number) => void;
  requestPointerLock: () => void;
  pauseGame: () => void;
  getCommandBar: () => HTMLElement;
}

/** Crafting, inventory and villager trading DOM controls. */
export function createInventoryUi(deps: InventoryUiDependencies) {
  const { state, atlasCanvas, tileOf, hotbar, keys, touchMove, isTouch,
    updateHearts, updateHotbar, showHint } = deps;
  const inv = deps.inventory;
  const ALL_BLOCKS = deps.allBlocks, NAMES = deps.names, recipes = deps.recipes;
  const { HAY, WOOL, BONE, EMERALD, COOKED, BED, BEEF, PORK, CHICKEN, LEATHER, COBBLE, STONEBRICK, SANDSTONE, BRICK, COPPER_INGOT, GUNPOWDER, TORCH, FLINT, DYNAMITE, TNT, IRON_INGOT, COAL, GOLD, DIAMOND } = deps.itemIds;
  const JOB_NAMES = deps.jobNames;
  const MAXHP = deps.maxHealth;
  const getMode = deps.getMode, getModeLabel = deps.getModeLabel;
  const getFallback = deps.getFallback, getCommandBar = deps.getCommandBar;
  const getHealth = deps.getHealth, setHealth = deps.setHealth;
  const sfx = deps.playSound, sfxAt = deps.playSoundAt;
  const requestLock = deps.requestPointerLock, pause = deps.pauseGame;
  function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error('Missing inventory UI element: ' + id);
    return found;
  }

  /* ---------- Inventory ---------- */
  const invEl = element('inv');
  const invGrid = element('invGrid');
  const invTitle = element('invTitle');
  const invHelp = element('invHelp');
  const invMsg = element('invMsg');
  const craftEl = element('craft');
  const invHot = element('invHotbar');
  const RECIPES = recipes;
  function iconCanvas(b: number, size: number): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const g = c.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable for inventory icons');
    g.imageSmoothingEnabled = false;
    g.drawImage(atlasCanvas, (tileOf(b) ?? 0) * 16, 0, 16, 16, 0, 0, size, size);
    return c;
  }
  /* ---------- Crafting grid (2x2 anywhere, 3x3 at a crafting table) ---------- */
  const craftUi = element('craftui'), craftTitle = element('craftTitle'), craftHelp = element('craftHelp');
  const craftMsg = element('craftMsg'), cgrid = element('cgrid'), cres = element('cres');
  const craftBtn = element('craftBtn') as HTMLButtonElement;
  const craftItems = element('craftItems');
  const craftBook = element('craftBook');
  const craftState: { size: number; grid: number[]; sel: number } = { size: 2, grid: [0, 0, 0, 0, 0, 0, 0, 0, 0], sel: 0 };
  const { recipePattern, recipeCounts, matchRecipe } = createRecipeMatcher(RECIPES);
  function gridCounts(size: number): Record<number, number> {
    const c: Record<number, number> = {};
    for (let i = 0; i < size * size; i++) { const v = craftState.grid[i]; if (v) c[v] = (c[v] || 0) + 1; }
    return c;
  }
  function hasAll(counts: Record<number, number>): boolean { for (const k in counts) if ((inv[k] || 0) < counts[k]) return false; return true; }
  function doCraft(): void {
    const m = matchRecipe(craftState.grid, craftState.size), counts = gridCounts(craftState.size);
    if (!m) return;
    if (!hasAll(counts)) { craftMsg.textContent = 'You are missing some of those items.'; sfx('no'); return; }
    for (const k in counts) inv[k] -= counts[k];
    inv[m.out] = (inv[m.out] || 0) + m.n;
    craftMsg.textContent = 'Crafted ' + m.n + ' ' + NAMES[m.out].toLowerCase() + '.';
    sfx('pop'); updateHotbar(false); renderCraft();
  }
  function placeCraftItem(id: number): void {
    const size = craftState.size, used = gridCounts(size)[id] || 0;
    if (used >= (inv[id] || 0)) { craftMsg.textContent = 'You have no more ' + NAMES[id].toLowerCase() + '.'; return; }
    craftState.grid[craftState.sel] = id;
    for (let k = 1; k <= size * size; k++) { const j = (craftState.sel + k) % (size * size); if (!craftState.grid[j]) { craftState.sel = j; break; } }
    craftMsg.textContent = '';
    renderCraft();
  }
  function fillRecipe(r: Recipe): void {
    const size = craftState.size, g = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (r.shapeless) {
      if (r.shapeless.length > size * size) { craftMsg.textContent = 'That needs a crafting table (3\u00d73 grid).'; return; }
      r.shapeless.forEach(function (id, i) { g[i] = id; });
    } else {
      const pat = recipePattern(r);
      if (pat.length > size || pat[0].length > size) { craftMsg.textContent = 'That needs a crafting table (3\u00d73 grid).'; return; }
      pat.forEach(function (row, ri) { row.forEach(function (id, ci) { g[ri * size + ci] = id; }); });
    }
    craftState.grid = g; craftMsg.textContent = ''; renderCraft();
  }
  function renderCraft(): void {
    const size = craftState.size, g = craftState.grid;
    craftTitle.textContent = size === 3 ? 'Crafting Table' : 'Crafting';
    craftHelp.textContent = 'Pick a square, then click an item below to put it there. Click a filled square again to empty it, or press Fill on a recipe.';
    cgrid.style.gridTemplateColumns = 'repeat(' + size + ', 58px)';
    cgrid.innerHTML = '';
    for (let i = 0; i < size * size; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ccell' + (craftState.sel === i ? ' on' : '');
      b.setAttribute('aria-label', 'Grid square ' + (i + 1) + (g[i] ? ', ' + NAMES[g[i]] : ', empty'));
      if (g[i]) b.appendChild(iconCanvas(g[i], 40));
      b.addEventListener('click', function () { if (craftState.sel === i && g[i]) craftState.grid[i] = 0; else craftState.sel = i; renderCraft(); });
      cgrid.appendChild(b);
    }
    const m = matchRecipe(g, size), ok = !!m && hasAll(gridCounts(size));
    cres.innerHTML = '';
    if (m) { cres.appendChild(iconCanvas(m.out, 40)); const t = document.createElement('span'); t.textContent = m.n + ' \u00d7 ' + NAMES[m.out]; cres.appendChild(t); }
    else cres.appendChild(document.createTextNode('No recipe'));
    craftBtn.disabled = !ok;
    craftItems.innerHTML = '';
    let nItems = 0;
    ALL_BLOCKS.forEach(function (b) {
      const n = inv[b] || 0;
      if (n <= 0) return;
      nItems++;
      const t = document.createElement('button'); t.type = 'button'; t.className = 'itile';
      t.setAttribute('aria-label', NAMES[b] + ', ' + n + ' owned');
      t.appendChild(iconCanvas(b, 40));
      const l = document.createElement('span'); l.className = 'iname'; l.textContent = NAMES[b]; t.appendChild(l);
      const c = document.createElement('span'); c.className = 'icount'; c.textContent = String(n); t.appendChild(c);
      t.addEventListener('click', function () { placeCraftItem(b); });
      craftItems.appendChild(t);
    });
    if (!nItems) { const e = document.createElement('p'); e.textContent = 'Your backpack is empty. Mine blocks and collect items first.'; craftItems.appendChild(e); }
    craftBook.innerHTML = '';
    RECIPES.forEach(function (r) {
      const counts = recipeCounts(r), have = hasAll(counts);
      const row = document.createElement('div'); row.className = 'recipe'; if (!have) row.style.opacity = '0.6';
      const left = document.createElement('span'); left.style.display = 'inline-flex'; left.style.alignItems = 'center'; left.style.gap = '6px'; left.style.flexWrap = 'wrap';
      const ic = iconCanvas(r.out, 24); ic.style.width = '24px'; ic.style.height = '24px'; ic.style.imageRendering = 'pixelated'; left.appendChild(ic);
      left.appendChild(document.createTextNode(r.n + ' \u00d7 ' + NAMES[r.out] + ' \u2190 ' + Object.keys(counts).map(function (k) { return counts[Number(k)] + ' ' + NAMES[Number(k)].toLowerCase(); }).join(', ')));
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = 'Fill';
      btn.addEventListener('click', function () { fillRecipe(r); });
      row.appendChild(left); row.appendChild(btn); craftBook.appendChild(row);
    });
  }
  function openCraft(size: number): void {
    if (getMode() !== 'survival') { showHint('Creative mode already has every item. Open the inventory with I.', 2400); return; }
    craftState.size = size; craftState.grid = [0, 0, 0, 0, 0, 0, 0, 0, 0]; craftState.sel = 0;
    state.craftOpen = true; state.invOpen = true; state.playing = false; state.mining = state.placing = false; state.drag = null;
    for (const k in keys) keys[k] = false;
    touchMove.x = 0; touchMove.z = 0; state.touchJump = false; state.stick = null; state.lookT = null;
    invEl.classList.add('hidden'); tradeEl.classList.add('hidden');
    craftMsg.textContent = '';
    renderCraft();
    craftUi.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    sfx('click');
  }
  craftBtn.addEventListener('click', doCraft);
  element('craftClear').addEventListener('click', function () { craftState.grid = [0, 0, 0, 0, 0, 0, 0, 0, 0]; craftState.sel = 0; craftMsg.textContent = ''; renderCraft(); });
  element('craftClose').addEventListener('click', function () { closeInventory(true); });
  window.addEventListener('keydown', function (e) { if (e.code === 'KeyC' && !e.repeat && state.playing && !state.invOpen) openCraft(2); });
  function assignSlot(b: number): void {
    if (getMode() === 'survival' && !(inv[b] > 0)) { invMsg.textContent = 'You have no ' + NAMES[b].toLowerCase() + ' yet. Mine some first.'; return; }
    const j = hotbar.indexOf(b);
    if (j >= 0 && j !== state.selected) hotbar[j] = hotbar[state.selected];
    hotbar[state.selected] = b;
    invMsg.textContent = NAMES[b] + ' is now in slot ' + (state.selected + 1) + '.';
    updateHotbar(false); renderInventory();
  }
  function renderInventory(): void {
    const surv = getMode() === 'survival';
    invTitle.textContent = surv ? 'Backpack' : 'Creative inventory';
    invHelp.textContent = (surv ? 'Everything you have collected.' : 'Every block and item, free to use.') + ' Choose a hotbar slot below (or press 1\u20139), then click a block to put it there.';
    invGrid.innerHTML = '';
    ALL_BLOCKS.forEach(function (b) {
      const t = document.createElement('button'); t.type = 'button';
      t.className = 'itile' + (surv && !(inv[b] > 0) ? ' empty' : '') + (hotbar[state.selected] === b ? ' cur' : '');
      t.setAttribute('aria-label', NAMES[b] + (surv ? ', ' + (inv[b] || 0) + ' owned' : ''));
      t.appendChild(iconCanvas(b, 40));
      const l = document.createElement('span'); l.className = 'iname'; l.textContent = NAMES[b]; t.appendChild(l);
      if (surv) { const c = document.createElement('span'); c.className = 'icount'; c.textContent = String(inv[b] || 0); t.appendChild(c); }
      t.addEventListener('click', function () { assignSlot(b); });
      invGrid.appendChild(t);
    });
    craftEl.innerHTML = '';
    if (surv) {
      const h = document.createElement('div'); h.className = 'invsub'; h.textContent = 'Crafting'; craftEl.appendChild(h);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = 'Open crafting grid (C)';
      b.style.marginBottom = '14px';
      b.addEventListener('click', function () { openCraft(2); });
      craftEl.appendChild(b);
    }
    invHot.innerHTML = '';
    hotbar.forEach(function (b, i) {
      const s = document.createElement('button'); s.type = 'button';
      s.className = 'slot' + (i === state.selected ? ' on' : '') + (!b || (surv && !(inv[b] > 0)) ? ' empty' : '');
      s.setAttribute('aria-label', (b ? NAMES[b] : 'Empty') + ', slot ' + (i + 1));
      if (b) s.appendChild(iconCanvas(b, 36));
      const n = document.createElement('span'); n.className = 'num'; n.textContent = String(i + 1); s.appendChild(n);
      if (surv && inv[b]) { const c = document.createElement('span'); c.className = 'cnt'; c.textContent = String(inv[b]); s.appendChild(c); }
      s.addEventListener('click', function () { state.selected = i; updateHotbar(false); renderInventory(); });
      invHot.appendChild(s);
    });
  }
  function openInventory(): void {
    if (getMode() !== 'creative' && getMode() !== 'survival') { showHint('There is no inventory in ' + getModeLabel() + ' mode.', 1800); return; }
    state.invOpen = true; state.playing = false; state.mining = state.placing = false; state.drag = null;
    for (const k in keys) keys[k] = false;
    touchMove.x = 0; touchMove.z = 0; state.touchJump = false; state.stick = null; state.lookT = null;
    invMsg.textContent = '';
    renderInventory();
    invEl.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeInventory(resume: boolean): void {
    state.invOpen = false; invEl.classList.add('hidden'); tradeEl.classList.add('hidden'); state.tradeOpen = false; craftUi.classList.add('hidden'); state.craftOpen = false; getCommandBar().classList.add('hidden'); state.cmdOpen = false;
    if (resume) { state.playing = true; if (!isTouch && !getFallback()) requestLock(); }
    else pause();
  }
  // Villager trading (Survival only)
  const tradeEl = element('trade'), tradeTitle = element('tradeTitle'), tradeSub = element('tradeSub');
  const tradeList = element('tradeList'), tradeMsg = element('tradeMsg');
  let tradeMob: TradingMob | null = null;
  const TRADES: Record<string, Trade[]> = {
    farmer: [{ give: [HAY, 3], get: [EMERALD, 1] }, { give: [WOOL, 2], get: [EMERALD, 1] }, { give: [BONE, 4], get: [EMERALD, 1] }, { give: [EMERALD, 1], get: [COOKED, 4] }, { give: [EMERALD, 2], get: [BED, 1] }],
    butcher: [{ give: [BEEF, 4], get: [EMERALD, 1] }, { give: [PORK, 4], get: [EMERALD, 1] }, { give: [CHICKEN, 5], get: [EMERALD, 1] }, { give: [EMERALD, 1], get: [LEATHER, 3] }],
    mason: [{ give: [COBBLE, 8], get: [EMERALD, 1] }, { give: [EMERALD, 1], get: [STONEBRICK, 8] }, { give: [EMERALD, 1], get: [SANDSTONE, 8] }, { give: [EMERALD, 2], get: [BRICK, 8] }, { give: [COPPER_INGOT, 4], get: [EMERALD, 1] }],
    blacksmith: [{ give: [GUNPOWDER, 3], get: [EMERALD, 1] }, { give: [EMERALD, 1], get: [TORCH, 8] }, { give: [EMERALD, 1], get: [FLINT, 1] }, { give: [EMERALD, 2], get: [DYNAMITE, 2] }, { give: [EMERALD, 3], get: [TNT, 1] }, { give: [EMERALD, 2], get: [134, 1] }, { give: [EMERALD, 2], get: [137, 1] }, { give: [IRON_INGOT, 3], get: [EMERALD, 1] }, { give: [COAL, 10], get: [EMERALD, 1] }, { give: [EMERALD, 3], get: [143, 1] }],
    cleric: [{ give: [GOLD, 1], get: [EMERALD, 3] }, { give: [EMERALD, 8], get: [GOLD, 1] }, { give: [EMERALD, 1], heal: true }, { give: [DIAMOND, 1], get: [EMERALD, 6] }]
  };
  function tradeCell(pair?: readonly [number, number]): HTMLElement {
    const w = document.createElement('span'); w.style.display = 'inline-flex'; w.style.alignItems = 'center'; w.style.gap = '4px';
    if (pair) { const ic = iconCanvas(pair[0], 28); ic.style.width = '28px'; ic.style.height = '28px'; ic.style.imageRendering = 'pixelated'; w.appendChild(ic); w.appendChild(document.createTextNode(pair[1] + ' ' + NAMES[pair[0]])); }
    return w;
  }
  function renderTrade(): void {
    if (!tradeMob) return;
    const job = tradeMob.job;
    tradeTitle.textContent = JOB_NAMES[job];
    tradeSub.textContent = 'Emeralds are the currency. Sell things to earn them.';
    tradeList.innerHTML = '';
    TRADES[job].forEach(function (t) {
      const ok = (inv[t.give[0]] || 0) >= t.give[1];
      const row = document.createElement('div'); row.className = 'recipe';
      const left = document.createElement('span'); left.style.display = 'inline-flex'; left.style.alignItems = 'center'; left.style.gap = '8px'; left.style.flexWrap = 'wrap';
      left.appendChild(tradeCell(t.give)); left.appendChild(document.createTextNode('\u2192'));
      if (t.heal) left.appendChild(document.createTextNode('Full health')); else left.appendChild(tradeCell(t.get));
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = 'Trade'; btn.disabled = !ok;
      btn.addEventListener('click', function () { doTrade(t); });
      row.appendChild(left); row.appendChild(btn); tradeList.appendChild(row);
    });
  }
  function doTrade(t: Trade): void {
    if ((inv[t.give[0]] || 0) < t.give[1]) { tradeMsg.textContent = 'You do not have enough.'; sfx('no'); return; }
    if (t.heal) { if (getHealth() >= MAXHP) { tradeMsg.textContent = 'You are already at full health.'; sfx('no'); return; } setHealth(MAXHP); updateHearts(); }
    inv[t.give[0]] -= t.give[1];
    if (!t.heal) inv[t.get[0]] = (inv[t.get[0]] || 0) + t.get[1];
    updateHotbar(false); renderTrade();
    tradeMsg.textContent = t.heal ? 'You feel much better.' : 'Trade complete.';
    sfx('yes');
  }
  function openTrade(m: TradingMob): void {
    if (getMode() !== 'survival') { sfxAt('villager', m.x, m.y + 1, m.z); showHint('The villager nods at you. Trading works in Survival mode.', 2400); return; }
    state.invOpen = true; state.tradeOpen = true; tradeMob = m; state.playing = false; state.mining = state.placing = false; state.drag = null;
    for (const k in keys) keys[k] = false;
    touchMove.x = 0; touchMove.z = 0; state.touchJump = false; state.stick = null; state.lookT = null;
    tradeMsg.textContent = '';
    renderTrade();
    tradeEl.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    sfxAt('villager', m.x, m.y + 1, m.z);
  }
  element('tradeClose').addEventListener('click', function () { closeInventory(true); });
  element('invClose').addEventListener('click', function () { closeInventory(true); });
  window.addEventListener('keydown', function (e) {
    if (e.code === 'KeyI' || e.code === 'Tab') {
      if (e.repeat) { if (state.invOpen || state.playing) e.preventDefault(); return; }
      if (state.invOpen) { e.preventDefault(); closeInventory(true); }
      else if (state.playing) { e.preventDefault(); openInventory(); }
    } else if (state.invOpen) {
      if (e.code === 'Escape') closeInventory(false);
      else if ((e.code === 'KeyE' || e.code === 'KeyC') && (state.tradeOpen || state.craftOpen)) closeInventory(true);
      else if (e.code.indexOf('Digit') === 0 && !state.tradeOpen && !state.craftOpen) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) { state.selected = n - 1; updateHotbar(false); renderInventory(); }
      }
    }
  });
  return { openCraft, renderCraft, openInventory, closeInventory,
    renderInventory, openTrade, renderTrade };
}
