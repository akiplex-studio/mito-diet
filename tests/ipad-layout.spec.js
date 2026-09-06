// @ts-check
const { test, expect } = require('@playwright/test');
const { skipOnboarding, pickItems } = require('./helpers');

for (const [width, height] of [[820,1180], [1180,820], [1024,1366], [1366,1024], [744,1133], [1133,744], [507,820], [375,667], [1024,600]]) {
  test(`layout ${width}×${height}: tabs, dialogs and rotation`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await skipOnboarding(page);
    await page.addInitScript(lang => {
      const saved = JSON.parse(localStorage.getItem('mito-data'));
      saved.lang = lang;
      localStorage.setItem('mito-data', JSON.stringify(saved));
    }, testInfo.project.name.includes('en') ? 'en' : 'ja');
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }));
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#hdrCount')).toHaveText(/\d/);
    const assertFits = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    };
    await assertFits();
    const stage = await page.locator('.mito-stage').boundingBox();
    const missions = await page.locator('#todoCard').boundingBox();
    const footer = await page.locator('nav.footer').boundingBox();
    expect(missions.y + missions.height).toBeLessThanOrEqual(footer.y + 1);
    if (width >= 1024) expect(stage.x + stage.width).toBeLessThan(missions.x);
    else expect(stage.y + stage.height).toBeLessThanOrEqual(missions.y + 1);
    for (const tab of ['meals', 'records', 'settings', 'home']) {
      await page.locator(`nav.footer button[data-tab="${tab}"]`).click();
      await assertFits();
    }
    // A busy mission list must wrap, remain operable, and survive rotation.
    await pickItems(page, ['bodyweight', 'nosake', 'morninglight', 'colorveg']);
    await page.locator('#btnEditMissions').click();
    await expect(page.locator('#pickModal')).toHaveClass(/open/);
    const sheet = await page.locator('#pickModal .sheet').boundingBox();
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.y).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(width + 1);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(height + 1);
    await page.locator('#pickDone').click();
    await page.setViewportSize({ width:height, height:width });
    await expect(page.locator('#tabHome')).toBeVisible();
    await assertFits();
    expect(errors).toEqual([]);
  });
}
