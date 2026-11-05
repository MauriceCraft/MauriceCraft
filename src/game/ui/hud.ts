/** Status HUD, inventory hotbar and feedback messages.
 * All world/player state remains owned by gameplay; this module only displays it.
 */
export interface HudDependencies {
  hotbar: number[];
  inventory: Record<number, number>;
  names: Readonly<Record<number, string>>;
  atlasCanvas: HTMLCanvasElement;
  tileOf: (blockId: number) => number | undefined;
  tools: Readonly<Record<number, { kind: string; tier: number }>>;
  toolMax: readonly number[];
  toolWear: Readonly<Record<number, number>>;
  getMode: () => string;
  getSelected: () => number;
  setSelected: (slot: number) => void;
  getHunger: () => number;
  getHealth: () => number;
  canInteract: () => boolean;
  maxHealth: number;
}

export function heartLevel(value: number, index: number): 'full' | 'half' | 'empty' {
  const remaining = value - index * 2;
  return remaining >= 2 ? 'full' : remaining >= 1 ? 'half' : 'empty';
}

export function createHud(deps: HudDependencies) {
  function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error('Missing game HUD element #' + id);
    return found;
  }
  const hotbarEl = element('hotbar');
  const blockName = element('blockname');
  const heartsEl = element('hearts');
  const foodEl = element('food');
  const flashEl = element('flash');
  const mineBar = element('mineBar');
  type SlotButton = HTMLButtonElement & {
    countElement: HTMLElement;
    durabilityElement: HTMLElement;
    context2d: CanvasRenderingContext2D;
  };
  const slotButtons: SlotButton[] = [];
  for (let slot = 0; slot < deps.hotbar.length; slot++) {
    const blockId = deps.hotbar[slot];
    const button = document.createElement('button') as SlotButton;
    button.type = 'button';
    button.className = 'slot';
    button.setAttribute('aria-label', (blockId ? deps.names[blockId] : 'Empty') + ', slot ' + (slot + 1));
    const canvas = document.createElement('canvas');
    canvas.width = 36;
    canvas.height = 36;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('HUD item icons need a 2D canvas');
    context.imageSmoothingEnabled = false;
    if (blockId) context.drawImage(deps.atlasCanvas, (deps.tileOf(blockId) ?? 0) * 16, 0, 16, 16, 0, 0, 36, 36);
    const number = document.createElement('span');
    number.className = 'num';
    number.textContent = String(slot + 1);
    const count = document.createElement('span');
    count.className = 'cnt';
    const durability = document.createElement('i');
    durability.className = 'dur';
    button.append(canvas, number, count, durability);
    button.context2d = context;
    button.countElement = count;
    button.durabilityElement = durability;
    button.addEventListener('click', () => {
      if (!deps.canInteract()) return;
      deps.setSelected(slot);
      updateHotbar(true);
    });
    hotbarEl.appendChild(button);
    slotButtons.push(button);
  }
  let nameTimer: ReturnType<typeof setTimeout> | undefined;
  function flashName(message: string): void {
    blockName.textContent = message;
    blockName.style.opacity = '1';
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => { blockName.style.opacity = '0'; }, 1600);
  }
  function updateHotbar(showName: boolean): void {
    const survival = deps.getMode() === 'survival';
    const selected = deps.getSelected();
    for (let slot = 0; slot < slotButtons.length; slot++) {
      const button = slotButtons[slot];
      const itemId = deps.hotbar[slot];
      button.context2d.clearRect(0, 0, 36, 36);
      if (itemId) button.context2d.drawImage(deps.atlasCanvas, (deps.tileOf(itemId) ?? 0) * 16, 0, 16, 16, 0, 0, 36, 36);
      button.setAttribute('aria-label', (itemId ? deps.names[itemId] : 'Empty') + ', slot ' + (slot + 1));
      button.classList.toggle('on', slot === selected);
      button.countElement.textContent = survival ? String(deps.inventory[itemId] || '') : '';
      const tool = deps.tools[itemId];
      if (survival && tool && deps.toolWear[itemId] > 0) {
        const durabilityRatio = 1 - deps.toolWear[itemId] / deps.toolMax[tool.tier];
        button.durabilityElement.style.display = 'block';
        button.durabilityElement.style.width = 'calc((100% - 6px) * ' + durabilityRatio + ')';
        button.durabilityElement.style.background = durabilityRatio > 0.5 ? '#43c34a' :
          durabilityRatio > 0.2 ? '#e3c42f' : '#d9372b';
      } else button.durabilityElement.style.display = 'none';
      button.classList.toggle('empty', !itemId || (survival && !(deps.inventory[itemId] > 0)));
    }
    if (showName) {
      blockName.textContent = deps.hotbar[selected] ? deps.names[deps.hotbar[selected]] : '';
      blockName.style.opacity = '1';
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => { blockName.style.opacity = '0'; }, 1400);
    }
  }
  function updateFood(): void {
    const hunger = deps.getHunger();
    let markup = '';
    for (let index = 0; index < 10; index++) {
      markup += '<span class="food ' + heartLevel(hunger, index) + '">🍗</span>';
    }
    foodEl.innerHTML = markup;
    foodEl.setAttribute('aria-label', 'Hunger ' + hunger + ' of 20');
  }
  function updateHearts(): void {
    const health = deps.getHealth();
    let markup = '';
    for (let index = 0; index < 10; index++) {
      markup += '<span class="heart ' + heartLevel(health, index) + '">♥</span>';
    }
    heartsEl.innerHTML = markup;
    heartsEl.setAttribute('aria-label', 'Health ' + health + ' of ' + deps.maxHealth);
  }
  return { hotbarEl, heartsEl, foodEl, flashEl, mineBar,
    updateHotbar, flashName, updateFood, updateHearts };
}
