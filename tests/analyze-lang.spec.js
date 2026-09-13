// @ts-check
// v1.73: /api/analyze-meal のリクエストに、解析を実行した時点の表示言語(lang)を付けるようにした。
// 付け忘れがあると、英語設定でも結果（良い点・アドバイス等）が日本語のまま返ってくる。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers.js');

function mockAnalyzeApi(page, captured) {
  return Promise.all([
    page.route('**/api/device', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ deviceId: 'testdevice.testsignature' }) });
    }),
    page.route('**/api/analyze-meal', async (route) => {
      captured.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          analysis: {
            dishes: [{ name: '焼き鮭', amount: '約100g' }],
            nutrition: { calories_kcal: 300, protein_g: 25, fat_g: 10, carbs_g: 5 },
            mito_score: 80,
            good_points: ['ok'],
            advice: 'ok',
            caution: '',
            confidence: 'high',
          },
          meta: { model: 'test', est_cost_usd: 0, remaining: 5, limit: 6 },
        }),
      });
    }),
  ]);
}

// 食事タブ→テキストで記録→解析する、までの共通手順（critical-path.spec.js と同じ経路）
async function runTextMealAnalysis(page) {
  await page.locator('nav.footer button[data-tab="meals"]').click();
  await page.locator('.photo-add-btn').first().click();
  await page.locator('#addChoiceText').click();
  await page.locator('#mealNote').fill('焼き鮭とご飯');
  await page.locator('#mealFul button').first().click();
  await page.locator('#mealRun').click();
  // 解析は非同期でモーダルを閉じてから行われる。リクエストが飛ぶまで少し待つ
  await page.waitForTimeout(300);
}

test('日本語設定では lang:"ja" が送られる', async ({ page }) => {
  const captured = [];
  await mockAnalyzeApi(page, captured);
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('ja'));

  await runTextMealAnalysis(page);

  expect(captured.length).toBeGreaterThan(0);
  expect(captured[0].lang).toBe('ja');
});

test('英語設定では lang:"en" が送られる', async ({ page }) => {
  const captured = [];
  await mockAnalyzeApi(page, captured);
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('en'));

  await runTextMealAnalysis(page);

  expect(captured.length).toBeGreaterThan(0);
  expect(captured[0].lang).toBe('en');
});
