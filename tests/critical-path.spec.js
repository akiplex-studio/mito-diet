// @ts-check
const { test, expect } = require('@playwright/test');

// クリティカルパス: 食事を記録する → ミトくんの反応（吹き出し）が表示される、の一周が通ること。
// playwright.config.js の projects により ja-JP / en-US の2ロケールで実行される。
//
// セレクタは index.html を実際に読んで確認した実在要素のみを使用:
//   - 食事タブ:        nav.footer button[data-tab="meals"]
//   - 追加(+)ボタン:    .photo-add-btn          （openAddChoice を開く）
//   - テキストで入力:   #addChoiceText          （食事モーダルをテキストモードで開く）
//   - 補足テキスト:     #mealNote
//   - 満腹度チップ:     #mealFul button         （必須）
//   - 解析する:         #mealRun                （runMealAnalysis → callAnalyzeAPI）
//   - ミトの反応:       #mitoBubble / #mitoBubbleText
//
// 解析APIは実際に叩くとClaude料金がかかり不安定なので、page.route でモックする。
// レスポンス形状はサーバー(server/src/index.ts)の /api/analyze-meal 成功レスポンスに合わせる。

test('食事を記録するとミトくんが反応する', async ({ page }) => {
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {string[]} */
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => { pageErrors.push(err.message); });

  // 解析APIをモック（実サーバー・実APIには到達させない）
  await page.route('**/api/analyze-meal', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        analysis: {
          dishes: [{ name: '焼き鮭', amount: '約100g' }],
          nutrition: { calories_kcal: 300, protein_g: 25, fat_g: 10, carbs_g: 5 },
          mito_score: 80,
          good_points: ['青魚のタンパク質が、発電所と筋肉の材料になるよ'],
          advice: '次は色の濃い野菜を一品足すと、サビから守る力が増すよ',
          caution: '',
          confidence: 'high',
        },
        meta: { model: 'test', est_cost_usd: 0, remaining: 5, limit: 6 },
      }),
    });
  });

  await page.goto('/index.html');

  // 1. 食事タブへ
  await page.locator('nav.footer button[data-tab="meals"]').click();
  await expect(page.locator('#tabMeals')).toBeVisible();

  // 2. 「＋」で追加口を開き、テキスト入力を選ぶ（写真なしのテキスト記録経路）
  await page.locator('.photo-add-btn').first().click();
  await expect(page.locator('#addChoiceModal')).toHaveClass(/open/);
  await page.locator('#addChoiceText').click();

  // 3. 食事モーダルが開く → 食べたものを入力し、満腹度（必須）を選ぶ
  await expect(page.locator('#mealModal')).toHaveClass(/open/);
  await page.locator('#mealNote').fill('焼き鮭とご飯');
  await page.locator('#mealFul button').first().click();

  // 4. 「解析する」→ モーダルが閉じ、モックの解析結果を受けてミトが反応する
  await page.locator('#mealRun').click();

  // 5. ミトの吹き出し(#mitoBubble)はホームタブのミト表示エリア内にある。
  //    記録後にホームへ戻って、ミトくんの反応が表示されることを確認する。
  await page.locator('nav.footer button[data-tab="home"]').click();
  await expect(page.locator('#tabHome')).toBeVisible();
  const bubble = page.locator('#mitoBubble');
  await expect(bubble).toBeVisible();
  await expect(page.locator('#mitoBubbleText')).not.toHaveText('');

  // 一周を通す間にエラーが出ていないこと
  expect(pageErrors, `pageerror が発生: ${pageErrors.join(' / ')}`).toEqual([]);
  expect(consoleErrors, `console.error が発生: ${consoleErrors.join(' / ')}`).toEqual([]);
});
