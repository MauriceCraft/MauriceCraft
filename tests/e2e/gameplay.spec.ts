import { expect, test, type Page } from '@playwright/test';

async function startWorld(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#play').click();
  await expect(page.locator('#overlay')).toBeHidden();
  await expect(page.locator('#info')).toContainText('X ');
}

async function runCommand(page: Page, command: string): Promise<void> {
  if (await page.locator('#btnCmd').isVisible()) {
    await page.locator('#btnCmd').tap();
  } else {
    await page.keyboard.press('t');
  }
  const input = page.locator('#cmdinput');
  await expect(input).toBeVisible();
  await input.fill(command);
  await input.press('Enter');
  await expect(input).toBeHidden();
}

async function playerPosition(page: Page): Promise<{ x: number; y: number; z: number }> {
  const status = await page.locator('#info').innerText();
  const match = /X (-?\d+\.\d+)\s+Y (-?\d+\.\d+)\s+Z (-?\d+\.\d+)/.exec(status);
  if (!match) throw new Error('Player position missing from the running game HUD: ' + status);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

test('a loaded world simulates player movement on desktop and touch devices', async ({ page, isMobile }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await startWorld(page);
  const before = await playerPosition(page);
  if (isMobile) {
    // Exercise the actual touchstart/move/end controls rather than a keyboard
    // shortcut on a mobile viewport. Synthetic touches are enough for the
    // game's canvas handlers, and keep the test deterministic.
    await page.evaluate(async () => {
      const canvas = document.querySelector<HTMLCanvasElement>('#view');
      if (!canvas) throw new Error('The game canvas is missing');
      function emit(type: string, x: number, y: number): void {
        const touch = new Touch({ identifier: 1, target: canvas!, clientX: x, clientY: y });
        const event = new TouchEvent(type, {
          touches: type === 'touchend' ? [] : [touch],
          targetTouches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch], bubbles: true, cancelable: true,
        });
        canvas!.dispatchEvent(event);
      }
      emit('touchstart', 48, 240);
      emit('touchmove', 48, 160);
      await new Promise(resolve => setTimeout(resolve, 850));
      emit('touchend', 48, 160);
    });
  } else {
    await page.keyboard.down('w');
    await page.waitForTimeout(850);
    await page.keyboard.up('w');
  }
  await expect.poll(async () => {
    const after = await playerPosition(page);
    return Math.hypot(after.x - before.x, after.z - before.z);
  }, { timeout: 5_000 }).toBeGreaterThan(0.3);
  expect(browserErrors).toEqual([]);
});

test('placing a block in a game world persists through save and full reload', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await startWorld(page);

  // Use the actual game command to mutate the loaded chunk. Block 3 (Stone)
  // is an established saved-world ID, never an arbitrary test-only value.
  await runCommand(page, '/setblock 0 45 0 stone');
  await expect(page.locator('#chatlog')).toContainText('Set 0 45 0 to Stone');
  await runCommand(page, '/save');

  async function persistedBlock(): Promise<number | null> {
    return page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('blockcraft-worlds');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const worlds = await new Promise<Array<{ id: string }>>((resolve, reject) => {
          const request = database.transaction('worlds', 'readonly').objectStore('worlds').getAll();
          request.onsuccess = () => resolve(request.result as Array<{ id: string }>);
          request.onerror = () => reject(request.error);
        });
        if (worlds.length !== 1) throw new Error('Expected one isolated test world');
        const record = await new Promise<{ data: Uint8Array } | undefined>((resolve, reject) => {
          const request = database.transaction('chunks', 'readonly')
            .objectStore('chunks').get(worlds[0].id + ':0,0');
          request.onsuccess = () => resolve(request.result as { data: Uint8Array } | undefined);
          request.onerror = () => reject(request.error);
        });
        return record?.data[(45 * 16) * 16] ?? null;
      } finally {
        database.close();
      }
    });
  }
  await expect.poll(persistedBlock, { timeout: 15_000 }).toBe(3);
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  expect(await persistedBlock()).toBe(3);
  await page.locator('#play').click();
  await expect(page.locator('#overlay')).toBeHidden();
  expect(browserErrors).toEqual([]);
});

test('switching dimensions preserves live gameplay and the saved world', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await startWorld(page);
  await runCommand(page, '/dimension nether');
  await expect(page.locator('#chatlog')).toContainText('Entered the nether');
  await expect(page.locator('#info')).toContainText('X ');
  await runCommand(page, '/dimension overworld');
  await expect(page.locator('#chatlog')).toContainText('Entered the overworld');
  await runCommand(page, '/save');
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
