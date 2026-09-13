// @ts-check
// v1.72: /api/analyze-meal がエラーコード(error)を返したとき、サーバーの message
// （日本語決め打ち）をそのまま画面に出さず、error コードごとの辞書の文言を出す。
// 知らないコード／コード無しは ui.ana.serverError にフォールバックする。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers.js');

function mockAnalyzeError(page, status, body) {
  return Promise.all([
    page.route('**/api/device', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ deviceId: 'testdevice.testsignature' }) });
    }),
    page.route('**/api/analyze-meal', async (route) => {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    }),
  ]);
}

// 食事タブ→テキストで記録→解析する、までの共通手順（analyze-lang.spec.js と同じ経路）
async function runTextMealAnalysis(page) {
  await page.locator('nav.footer button[data-tab="meals"]').click();
  await page.locator('.photo-add-btn').first().click();
  await page.locator('#addChoiceText').click();
  await page.locator('#mealNote').fill('焼き鮭とご飯');
  await page.locator('#mealFul button').first().click();
  await page.locator('#mealRun').click();
  // 解析は非同期。モーダルは即座に閉じ、失敗すると写真タイルが「⚠ 再試行」に変わる
  await page.waitForTimeout(300);
  await page.locator('.meal-ana-btn.error').first().click();   // 再度開いてメッセージを見る
}

const SECRET = '__サーバーの生message（画面に出てはいけない）__';

const CASES = [
  { error: 'bad_device_id', status: 400, key: 'ui.ana.err.badDevice' },
  { error: 'bad_request', status: 400, key: 'ui.ana.err.badRequest' },
  { error: 'bad_image', status: 400, key: 'ui.ana.err.badImage' },
  { error: 'server_config', status: 500, key: 'ui.ana.err.serverConfig' },
  { error: 'anthropic_rate_limited', status: 503, key: 'ui.ana.err.rateLimited' },
  { error: 'anthropic_error', status: 502, key: 'ui.ana.err.upstream' },
  { error: 'internal', status: 500, key: null },        // マップに無いコード → 汎用メッセージ
  { error: 'something_new', status: 500, key: null },   // 本当に未知のコード → 汎用メッセージ
];

for (const c of CASES) {
  test(`サーバーが ${c.error} を返すと辞書の文言が出て、生のmessageは出ない`, async ({ page }) => {
    await mockAnalyzeError(page, c.status, { error: c.error, message: SECRET });
    await skipOnboarding(page);
    await page.goto('/index.html');

    await runTextMealAnalysis(page);

    const expected = await page.evaluate((k) => t(k || 'ui.ana.serverError'), c.key);
    await expect(page.locator('#mealMsg')).toContainText(expected);
    const msg = await page.locator('#mealMsg').textContent();
    expect(msg).not.toContain(SECRET);
  });
}

test('英語設定でも辞書の英語文言が出て、生のmessageは出ない', async ({ page }) => {
  await mockAnalyzeError(page, 400, { error: 'bad_image', message: SECRET });
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('en'));

  await runTextMealAnalysis(page);

  await expect(page.locator('#mealMsg')).toContainText('different one');
  const msg = await page.locator('#mealMsg').textContent();
  expect(msg).not.toContain(SECRET);
});
