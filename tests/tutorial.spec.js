// @ts-check
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers');

// v1.55: 初回チュートリアル。
// 一番大事なのは「からだのプロフィールがここで必ず埋まること」。
// 身長・年齢・性別・体重が欠けると calcTargets が null を返し、
// 必要カロリーもタンパク質の目安も出せないままアプリが使われてしまう。

/** 数値の質問に答えて次へ */
async function answerNum(page, value) {
  await page.locator('#tutBody input[type="number"]').fill(String(value));
  await page.locator('#tutNext').click();
}
/** 選択肢の質問に答える（選ぶと自動で次へ進む） */
async function answerChoice(page, label) {
  await page.locator('.tut-choice', { hasText: label }).click();
}

test('初回起動でチュートリアルが出て、答えた内容が保存される', async ({ page }) => {
  await page.goto('/index.html');   // まっさらな状態

  await expect(page.locator('#tutorial')).toBeVisible();
  await expect(page.locator('#tutBody')).toContainText('ぼくはマイト');
  await page.locator('#tutNext').click();          // ようこそ → 最初の質問

  await answerNum(page, 172);                      // 身長
  await answerNum(page, 45);                       // 年齢
  await answerChoice(page, '男性');                // 性別
  await answerNum(page, 79.7);                     // 今の体重
  await answerNum(page, 68);                       // 目標体重
  await answerChoice(page, 'よく動く');            // 活動量

  // tips 3枚
  await expect(page.locator('#tutImg')).toBeVisible();
  await page.locator('#tutNext').click();
  await page.waitForTimeout(400);
  await page.locator('#tutNext').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#tutNext')).toHaveText('はじめる');
  await page.locator('#tutNext').click();

  // v1.56: 最後にミッションを選ばせない。閉じたらそのままホームで始まる
  await expect(page.locator('#tutorial')).toBeHidden();
  await expect(page.locator('#pickModal')).not.toHaveClass(/open/);
  await expect(page.locator('#todoCard')).toBeVisible();
  expect(await page.evaluate(() => DB.onboarded)).toBe(true);
  // 推奨セットのまま始まる（ウォーキングも既定で入っている）
  const missions = await page.evaluate(() =>
    DB.items.filter(it => isItemActiveOn(it, today) && it.inTodo).map(it => it.id).sort());
  expect(missions).toEqual(['nightfast', 'stretch', 'sugarCtrl', 'walking']);

  const saved = await page.evaluate(() => ({
    profile: DB.profile,
    goal: DB.goalWeight,
    weight: DB.days[today].weight,
    // 入力がそろったので必要カロリーが計算できる
    targets: !!calcTargets(DB.profile, DB.days[today].weight),
  }));
  expect(saved.profile.heightCm).toBe(172);
  expect(saved.profile.age).toBe(45);
  expect(saved.profile.sex).toBe('male');
  expect(saved.profile.activity).toBe(1.55);
  expect(saved.goal).toBe(68);
  expect(saved.weight).toBe(79.7);
  expect(saved.targets).toBe(true);
});

test('tipsは「次へ」で1枚ずつめくれ、最後だけボタンが変わる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  // 設定から図解だけを開く
  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnReadTips').click();
  await expect(page.locator('#tutorial')).toBeVisible();

  const src1 = await page.locator('#tutImg').getAttribute('src');
  await expect(page.locator('#tutNext')).toHaveText('次へ');
  await page.locator('#tutNext').click();
  await page.waitForTimeout(400);
  const src2 = await page.locator('#tutImg').getAttribute('src');
  expect(src2).not.toBe(src1);              // 絵が入れ替わっている

  await page.locator('#tutNext').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#tutNext')).toHaveText('とじる');   // 3枚目
  await page.locator('#tutNext').click();
  await expect(page.locator('#tutorial')).toBeHidden();
  // 図解を読んだだけではミッションの確認は出ない
  await expect(page.locator('#pickModal')).not.toHaveClass(/open/);
});

test('ブラウザ版では連携の画面を出さない', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#tutNext').click();   // ようこそ → 次

  // ネイティブ専用なので、いきなり最初の質問になる
  await expect(page.locator('#tutBody')).toContainText('身長');
  await expect(page.locator('#tutBody')).not.toContainText('ヘルスデータ');
});

test('途中でやめたら、次に開いたときまた出る', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#tutNext').click();
  await answerNum(page, 170);

  // 質問の途中でリロード（＝アプリを閉じた）
  await page.reload();
  await expect(page.locator('#tutorial')).toBeVisible();
  const done = await page.evaluate(() => DB.onboarded);
  expect(done).toBe(false);
  // 中途半端な入力は保存していない
  expect(await page.evaluate(() => DB.profile.heightCm)).toBe(null);
});

test('既存ユーザーにはチュートリアルが出ない', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', items: null,
      days: { '2026-07-01': { checked: ['juice'] } },
    }));
  });
  await page.goto('/index.html');
  await expect(page.locator('#tutorial')).toBeHidden();
});
