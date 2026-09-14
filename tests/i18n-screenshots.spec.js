// @ts-check
// v1.72: zh/ms の訳を平井さんに見せるためのスクリーンショットを撮る。
// 390x844（iPhone相当）で、ホーム・食事・ミッション選択・腹七分目の説明画面。
// 出力先は作業用スクラッチパッド（プロジェクト外・git管理外）。
const { test } = require('@playwright/test');
const { skipOnboarding } = require('./helpers');

const OUT_DIR = '/private/tmp/claude-501/-Users-hirai-claude/e13059a7-b148-4768-964b-0156ef84bb42/scratchpad/i18n_shots';

for (const lang of ['zh', 'ms']) {
  test(`${lang}: スクリーンショット（ホーム/食事/ミッション選択/腹七分目の説明）`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await skipOnboarding(page);
    await page.goto('/index.html');
    await page.evaluate((l) => setLang(l), lang);

    await page.screenshot({ path: `${OUT_DIR}/${lang}_home.png` });

    await page.locator('nav.footer button[data-tab="meals"]').click();
    await page.screenshot({ path: `${OUT_DIR}/${lang}_meals.png` });

    await page.locator('nav.footer button[data-tab="home"]').click();
    await page.locator('#btnEditMissions').click();
    await page.locator('#pickModal').waitFor({ state: 'visible' });
    await page.screenshot({ path: `${OUT_DIR}/${lang}_pick.png` });
    await page.locator('#pickModal .sheet-close').click();
    await page.locator('#pickModal').waitFor({ state: 'hidden' });

    await page.evaluate(() => {
      // @ts-ignore アプリ側のグローバル
      openInfo(catalogById('hara7'));
    });
    await page.locator('#infoModal').waitFor({ state: 'visible' });
    await page.screenshot({ path: `${OUT_DIR}/${lang}_hara7_info.png` });
  });
}
