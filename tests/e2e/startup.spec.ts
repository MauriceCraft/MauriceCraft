import { test, expect } from '@playwright/test';

// Surface startup exceptions in GitHub Actions logs before the test times out.
// This is particularly useful when headless Chromium cannot start WebGL.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => console.error(`[browser uncaught] ${err.stack ?? err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`[browser console] ${msg.text()}`);
  });
});

test('production build loads the game menu without startup exceptions', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'MauriceCraft' })).toBeVisible();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator('#newworld')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test('new worlds use versioned biomes and weather settings persist across reloads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#newworld').click();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator('.world')).toHaveCount(2);
  const cloudy = page.locator('.wmode[data-weather="cloudy"]');
  await cloudy.click();
  await expect(cloudy).toHaveClass(/on/);
  const readWorlds = () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcraft-worlds');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<{ seed: number; generatorVersion?: number; weather?: { w: string } }>>((resolve, reject) => {
        const request = database.transaction('worlds', 'readonly').objectStore('worlds').getAll();
        request.onsuccess = () => resolve(request.result as Array<{ seed: number; generatorVersion?: number; weather?: { w: string } }>);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
  await expect.poll(async () => (await readWorlds()).filter(w => w.weather?.w === 'cloudy').length, {
    timeout: 15_000,
  }).toBe(1);
  const before = await readWorlds();
  expect(before).toHaveLength(2);
  for (const world of before) {
    expect(world.generatorVersion).toBe(3);
    expect(world.seed).toBeGreaterThanOrEqual(0);
    expect(world.seed).toBeLessThan(0x100000000);
  }
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  expect(await readWorlds()).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('new worlds accept a specified seed and preserve it across reloads', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#newworld')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#worldSeed').fill('123456789');
  await page.locator('#newworld').click();
  await expect(page.locator('.world')).toHaveCount(2);
  await expect(page.locator('.world').first()).toContainText('Seed 123456789');
  await expect(page.locator('#worldSeed')).toHaveValue('');
  await page.reload();
  await expect(page.locator('#newworld')).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator('.world').first()).toContainText('Seed 123456789');
  await page.locator('#worldSeed').fill('4294967296');
  await page.locator('#newworld').click();
  await expect(page.locator('.world')).toHaveCount(2);
  await expect(page.locator('#worldSeed')).toHaveJSProperty('validationMessage', 'Seed must be between -2147483648 and 4294967295.');
});

test('desktop and mobile can start playing', async ({ page, isMobile }) => {
  await page.goto('./');
  const play = page.locator('#play');
  await expect(play).toBeEnabled({ timeout: 15_000 });
  await play.click();
  await expect(page.locator('#overlay')).toBeHidden();
  if (isMobile) {
    await expect(page.locator('#btnJump')).toBeVisible();
    await expect(page.locator('#btnPlace')).toBeVisible();
    // The game handles touchstart and prevents its synthetic click; use a real touch gesture.
    await page.locator('#btnInv').tap();
    await expect(page.locator('#inv')).toBeVisible();
    await page.locator('#invClose').click();
    await expect(page.locator('#inv')).toBeHidden();
  } else {
    await page.keyboard.press('t');
    await expect(page.locator('#cmdinput')).toBeVisible();
  }
});

test('the in-game portal command builds a frame without exceptions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('./');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#play').click();
  await expect(page.locator('#overlay')).toBeHidden();
  // Both desktop and mobile can invoke the command bar through the DOM;
  // on mobile we use the visible Cmd button.
  if (await page.locator('#btnCmd').isVisible()) {
    await page.locator('#btnCmd').tap();
  } else {
    await page.keyboard.press('t');
  }
  const input = page.locator('#cmdinput');
  await expect(input).toBeVisible();
  await input.fill('/portal build');
  await input.press('Enter');
  await expect(page.locator('#chatlog')).toContainText('Built an obsidian Nether portal frame');

  // Validate the actual IndexedDB metadata, not just a success message.
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcraft-worlds');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const worlds = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction('worlds', 'readonly').objectStore('worlds').getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error);
      });
      return worlds.some(world => {
        if (!world || typeof world !== 'object') return false;
        const portals = (world as { portals?: unknown }).portals;
        return Array.isArray(portals) && portals.some((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return false;
          const portal = entry as { dimension?: unknown; axis?: unknown };
          return portal.dimension === 'overworld' && portal.axis === 'x';
        });
      });
    } finally {
      db.close();
    }
  }), { timeout: 15_000 }).toBe(true);

  // A reload must still be able to open the old database and the saved world.
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  expect(errors).toEqual([]);
});



test('time-of-day survives the weather refactor and can be changed in game', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto('./');
  // Bootstrap must have initialized, not merely rendered its static Loading button.
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#play').click();
  await expect(page.locator('#overlay')).toBeHidden();

  async function enterCommand(command: string): Promise<void> {
    if (await page.locator('#btnCmd').isVisible()) {
      await page.locator('#btnCmd').tap();
    } else {
      await page.keyboard.press('t');
    }
    const input = page.locator('#cmdinput');
    await expect(input).toBeVisible();
    await input.fill(command);
    await input.press('Enter');
  }

  await enterCommand('/time query');
  await expect(page.locator('#chatlog')).toContainText('ticks into the day');
  await enterCommand('/time set night');
  await expect(page.locator('#chatlog')).toContainText('Time set to 13000 ticks');
  await enterCommand('/time query');
  await expect(page.locator('#chatlog')).toContainText('night');
  expect(runtimeErrors).toEqual([]);
});

test('game canvas remains sized to the viewport after resizing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  const view = page.locator('#view');
  await expect(view).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => view.evaluate(canvas => {
    const element = canvas as HTMLCanvasElement;
    const bounds = element.getBoundingClientRect();
    return Math.abs(bounds.width - window.innerWidth) < 2 &&
      Math.abs(bounds.height - window.innerHeight) < 2 && element.width > 0 && element.height > 0;
  })).toBe(true);
  expect(errors).toEqual([]);
});

test('a device without WebGL shows a safe retry rather than Loading forever', async ({ page }) => {
  // A real mobile browser can fail WebGL setup even when desktop Chromium passes.
  // Simulate that missing browser capability before the game module initializes.
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => null,
    });
  });
  await page.goto('./');
  const retry = page.getByRole('button', { name: 'Retry loading' });
  await expect(retry).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator('#sub')).toContainText('saved worlds have not been deleted');
  await expect(page.locator('#newworld')).toBeDisabled();
  await expect(page.locator('#overlay')).toBeVisible();
});

test('unavailable WebGL reveals safe startup recovery instead of infinite Loading', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return Reflect.apply(original, this, [type, ...rest]) as ReturnType<typeof original>;
    } as typeof original;
  });
  await page.goto('./');
  await expect(page.locator('#play')).toHaveText('Retry loading', { timeout: 15_000 });
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#sub')).toContainText('saved worlds');
});
