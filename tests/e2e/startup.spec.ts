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

test('desktop and mobile can start playing', async ({ page, isMobile }) => {
  await page.goto('./');
  const play = page.locator('#play');
  await expect(play).toBeEnabled({ timeout: 15_000 });
  await play.click();
  await expect(page.locator('#overlay')).toBeHidden();
  if (isMobile) {
    await expect(page.locator('#btnJump')).toBeVisible();
    await expect(page.locator('#btnPlace')).toBeVisible();
    await page.locator('#btnInv').click();
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
    await page.locator('#btnCmd').click();
  } else {
    await page.keyboard.press('t');
  }
  const input = page.locator('#cmdinput');
  await expect(input).toBeVisible();
  await input.fill('/portal build');
  await input.press('Enter');
  await expect(page.locator('#chatlog')).toContainText('Built an obsidian Nether portal frame');
  expect(errors).toEqual([]);
});
