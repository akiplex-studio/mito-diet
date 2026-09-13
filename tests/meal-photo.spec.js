// @ts-check
// v1.71: 2026-09-05 (74bdb26) でネイティブアプリの写真は { file: '置き場所' } 形式に変わり、
// { data: 'data:image/...' } は保存時に消える（writePhotoFile / migratePhotosToFiles）。
// 食事解析ポップアップの写真ストリップが2箇所とも e.data をそのまま <img src> に使っていたため、
// file形式の写真は src="undefined" になり、壊れた画像アイコンが出ていた（不具合1）。
// もう1件、解析結果画面の「閉じる」ボタンが辞書に存在しない ui.common.close2 を参照しており、
// 日英どちらでもラベルが空になっていた（不具合2）。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers.js');

// テスト用の1x1 JPEG（macOSのsipsで1x1画像として読めることを確認済み）。
// ネイティブFilesystemプラグインのreadFileが返すbase64として使う。
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

// アプリ側の fmtDate(new Date()) と同じ組み立て方で「今日」のキーを作る（helpers.js の skipOnboarding と同じ流儀）
function todayIso() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// ネイティブアプリの Capacitor Filesystem プラグインを最小限だけ偽装する。
// nativeFilesystem() は window.Capacitor.isNativePlatform() / .Plugins.Filesystem を見るだけなので、
// Health / LocalNotifications / Share は用意しない（自動起動処理が「プラグイン無し」として素通りする）。
async function mockNativeFilesystem(page) {
  await page.addInitScript((b64) => {
    // @ts-ignore テスト用のCapacitorモック
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        Filesystem: {
          readFile: async () => ({ data: b64 }),
          writeFile: async () => ({ uri: 'file://mock' }),
          deleteFile: async () => {},
        },
      },
    };
  }, TINY_JPEG_BASE64);
}

test('不具合1: file形式の写真は解析フォームで壊れた画像にならない', async ({ page }) => {
  await skipOnboarding(page);
  await mockNativeFilesystem(page);
  await page.addInitScript((iso) => {
    const d = JSON.parse(localStorage.getItem('mito-data'));
    d.days = {
      [iso]: {
        checked: [], photos: { breakfast: [], lunch: [{ file: 'photos/test.jpg' }], dinner: [] },
        mealAnalysis: { breakfast: null, lunch: null, dinner: null },
      },
    };
    localStorage.setItem('mito-data', JSON.stringify(d));
  }, todayIso());
  await page.goto('/index.html');
  await page.evaluate(() => setLang('ja'));

  // @ts-ignore アプリ側のグローバル
  await page.evaluate(() => openMealModal('lunch'));
  const img = page.locator('#mealBody .meal-strip img');
  await expect(img).toHaveCount(1);
  // setPhotoSrc は Filesystem.readFile を待ってから src を差し込む非同期処理。
  // 壊れていれば naturalWidth は 0 のまま（1x1のテスト画像は読めれば naturalWidth=1 になる）
  await expect(img).toHaveJSProperty('naturalWidth', 1, { timeout: 5000 });
  const src = await img.getAttribute('src');
  expect(src).toMatch(/^data:image\//);
});

test('不具合2: 解析結果の閉じるボタンに文字が出る（日英とも）', async ({ page }) => {
  await skipOnboarding(page);
  await page.addInitScript((iso) => {
    const d = JSON.parse(localStorage.getItem('mito-data'));
    d.days = {
      [iso]: {
        checked: [], photos: { breakfast: [], lunch: [], dinner: [] },
        mealAnalysis: {
          breakfast: null,
          lunch: {
            analysis: {
              mito_score: 80, confidence: 'high',
              dishes: [{ name: '唐揚げ', amount: '150g' }],
              nutrition: { calories_kcal: 600, protein_g: 20, fat_g: 15, carbs_g: 70 },
              good_points: [],
            },
            photoCount: 0, fullness: null, note: null,
          },
          dinner: null,
        },
      },
    };
    localStorage.setItem('mito-data', JSON.stringify(d));
  }, todayIso());
  await page.goto('/index.html');

  // 日本語：「とじる」が出る（既存の ui.common.close キーを流用しているはず）
  await page.evaluate(() => setLang('ja'));
  // @ts-ignore アプリ側のグローバル
  await page.evaluate(() => openMealModal('lunch'));
  const closeBtnJa = page.locator('#mealBody button[data-close].btn-primary');
  await expect(closeBtnJa).toHaveText('とじる');

  // 英語：「Close」が出る
  await page.evaluate(() => setLang('en'));
  // @ts-ignore アプリ側のグローバル
  await page.evaluate(() => openMealModal('lunch'));
  const closeBtnEn = page.locator('#mealBody button[data-close].btn-primary');
  await expect(closeBtnEn).toHaveText('Close');
});
