// @ts-check
// v1.73: @capacitor/app の backButton を、Google Core app quality guidelines に沿って処理する。
// ①開いているモーダルを1つ閉じる → ②ホーム以外のタブならホームへ戻す → ③ホームで何も開いていなければ
// タスクをバックグラウンドへ送る（minimizeApp）。以前は @capacitor/app 自体が依存に無く、
// モーダルを開いていても戻るボタンでアプリごと閉じてしまっていた（テスターからの報告）。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers.js');

// Capacitorのネイティブ環境と @capacitor/app プラグインを最小限だけ偽装する。
// addListener('backButton', cb) で受け取ったハンドラを window.__appBackHandler に控えておき、
// テスト側から window.__appBackHandler() を直接呼んで「戻るボタンが押された」を再現する。
async function mockCapacitorApp(page) {
  await page.addInitScript(() => {
    // @ts-ignore テスト用のCapacitorモック
    window.__appBackHandler = null;
    // @ts-ignore
    window.__minimizeAppCalled = 0;
    // @ts-ignore
    window.__exitAppCalled = 0;
    // @ts-ignore
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        App: {
          addListener: (event, cb) => {
            // @ts-ignore
            if (event === 'backButton') window.__appBackHandler = cb;
            return { remove: () => {} };
          },
          minimizeApp: async () => { window.__minimizeAppCalled++; },
          exitApp: async () => { window.__exitAppCalled++; },
        },
      },
    };
  });
}

test('モーダルが開いていれば戻るボタンでモーダルだけ閉じる（アプリは閉じない）', async ({ page }) => {
  await mockCapacitorApp(page);
  await skipOnboarding(page);
  await page.goto('/index.html');

  // 食事タブへ→「＋」→追加口モーダルを開く（addChoiceModal）
  await page.locator('nav.footer button[data-tab="meals"]').click();
  await page.locator('.photo-add-btn').first().click();
  await expect(page.locator('#addChoiceModal')).toHaveClass(/open/);

  await page.evaluate(() => {
    // @ts-ignore
    window.__appBackHandler();
  });

  await expect(page.locator('#addChoiceModal')).not.toHaveClass(/open/);
  const counts = await page.evaluate(() => ({
    // @ts-ignore
    minimize: window.__minimizeAppCalled, exit: window.__exitAppCalled,
  }));
  expect(counts).toEqual({ minimize: 0, exit: 0 });
});

test('別タブにいれば戻るボタンでホームタブへ戻る', async ({ page }) => {
  await mockCapacitorApp(page);
  await skipOnboarding(page);
  await page.goto('/index.html');

  await page.locator('nav.footer button[data-tab="meals"]').click();
  await expect(page.locator('#tabMeals')).toBeVisible();

  await page.evaluate(() => {
    // @ts-ignore
    window.__appBackHandler();
  });

  await expect(page.locator('#tabHome')).toBeVisible();
  const counts = await page.evaluate(() => ({
    // @ts-ignore
    minimize: window.__minimizeAppCalled, exit: window.__exitAppCalled,
  }));
  expect(counts).toEqual({ minimize: 0, exit: 0 });
});

test('ホームタブで何も開いていなければ戻るボタンでバックグラウンドへ送る（minimizeApp）', async ({ page }) => {
  await mockCapacitorApp(page);
  await skipOnboarding(page);
  await page.goto('/index.html');
  await expect(page.locator('#tabHome')).toBeVisible();

  await page.evaluate(() => {
    // @ts-ignore
    window.__appBackHandler();
  });

  const counts = await page.evaluate(() => ({
    // @ts-ignore
    minimize: window.__minimizeAppCalled, exit: window.__exitAppCalled,
  }));
  expect(counts).toEqual({ minimize: 1, exit: 0 });
});

test('初回起動のチュートリアル中は戻るボタンで丸ごと閉じない（先頭ステップでは何も起きない）', async ({ page }) => {
  await mockCapacitorApp(page);
  // skipOnboarding は使わない。オンボーディングが自動で始まる状態のまま確かめる
  await page.goto('/index.html');
  await expect(page.locator('#tutorial')).toBeVisible();

  await page.evaluate(() => {
    // @ts-ignore
    window.__appBackHandler();
  });

  // 先頭ステップのままアプリは終了/バックグラウンド化されない
  await expect(page.locator('#tutorial')).toBeVisible();
  const counts = await page.evaluate(() => ({
    // @ts-ignore
    minimize: window.__minimizeAppCalled, exit: window.__exitAppCalled,
  }));
  expect(counts).toEqual({ minimize: 0, exit: 0 });
});
