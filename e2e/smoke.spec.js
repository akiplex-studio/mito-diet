// @ts-check
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('../tests/helpers');

// スモークテスト: テスター配布前・OTA更新前に「アプリが起動するか」を一発で確認する。
// playwright.config.js の projects により ja-JP / en-US の2ロケールで実行される。
// セレクタは index.html を実際に読んで存在を確認した要素のみを使用（推測しない）。

test('ホーム画面が描画され、エラーが出ない', async ({ page }) => {
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {string[]} */
  const pageErrors = [];

  // goto より前にリスナーを張る（読み込み中に出るエラーも拾う）
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  await skipOnboarding(page);
  await page.goto('/index.html');

  // --- ホーム画面が描画されていること（index.html に実在する要素で確認） ---
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#tabHome')).toBeVisible();          // ホームタブのページ（初期表示タブ）
  await expect(page.locator('#mitoCanvas')).toBeAttached();      // ミト表示のcanvas
  await expect(page.locator('nav.footer button[data-tab="home"]')).toBeVisible();

  // 匹数(#hdrCount)が数字で描画されている＝renderHeader() が走った証拠
  await expect(page.locator('#hdrCount')).toHaveText(/\d/);

  // --- i18n 未解決キーが画面に出ていないこと ---
  // ※ まだ i18n 未導入のため、このチェックはコメントアウトで置いておく。
  //    導入後、未解決キーの表記（例: {{home.title}} や __HOME_TITLE__ 等）に合わせて有効化する。
  // const bodyText = await page.locator('body').innerText();
  // expect(bodyText, 'i18nキーが未解決のまま表示されている').not.toMatch(/\{\{[^}]+\}\}|__[A-Z0-9_]+__/);

  // --- エラーが0件であること ---
  expect(pageErrors, `pageerror が発生: ${pageErrors.join(' / ')}`).toEqual([]);
  expect(consoleErrors, `console.error が発生: ${consoleErrors.join(' / ')}`).toEqual([]);
});
