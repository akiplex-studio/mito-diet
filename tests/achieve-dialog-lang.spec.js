// @ts-check
// v1.73: 達成ポップアップの見出し(#achieveTitle)が openAchieveDialog 内で item.name を直接出しており、
// 英語設定でも保存データ（日本語）の名前がそのまま表示されていた。itemName(item) 経由に直す。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers.js');

test('達成ポップアップの見出しは、why に「||」が無い項目では itemName() 経由で言語に従う', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('en'));

  // colorveg は WHY_VARIANTS を持たず info.colorveg.why（"||" を含まない）にフォールバックするため、
  // openAchieveDialog は bar<0 の分岐＝itemName(item) を必ず通る（Math.random に依存しない）
  await page.evaluate(() => {
    // @ts-ignore アプリ側のグローバル
    openAchieveDialog({ id: 'colorveg', name: '色の濃い野菜を一品食べる' }, null);
  });

  await expect(page.locator('#achieveModal')).toHaveClass(/open/);
  const title = await page.locator('#achieveTitle').textContent();
  expect(title).toBe('Eat one deeply coloured vegetable');
  expect(title).not.toMatch(/[ぁ-んァ-ヴ一-龥]/);
});

test('達成ポップアップの見出しは、日本語設定では日本語のままで出る', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('ja'));

  await page.evaluate(() => {
    // @ts-ignore アプリ側のグローバル
    openAchieveDialog({ id: 'colorveg', name: '色の濃い野菜を一品食べる' }, null);
  });

  await expect(page.locator('#achieveModal')).toHaveClass(/open/);
  const title = await page.locator('#achieveTitle').textContent();
  expect(title).toBe('色の濃い野菜を一品食べる');
});
