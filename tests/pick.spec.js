// @ts-check
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers');

// v1.49: やることの選び直し（機序ごとの代替選択）とオンボーディング。
//
// 一番大事なのは「選び直しても過去の育成結果が変わらない」こと。
// このアプリは匹数・活性を記録ログ全期間から毎回再計算するので、素朴に項目を
// 差し替えると過去まで巻き添えになる。項目は消さず有効期間を閉じることで防いでいる。

test('初回起動ではオンボーディングが開き、3つの区分で表示される', async ({ page }) => {
  await page.goto('/index.html');   // まっさらな状態

  await expect(page.locator('#pickModal')).toHaveClass(/open/);
  // 逃げ道（閉じるボタン）は隠れている
  await expect(page.locator('#pickModal .sheet-close')).toBeHidden();

  // 運動 / そのほかのやること / 自動で判定するもの の3区分
  const heads = page.locator('.pick-section-name');
  await expect(heads).toHaveCount(3);
  await expect(heads.nth(0)).toHaveText('運動');
  await expect(heads.nth(1)).toHaveText('そのほかのやること');
  await expect(heads.nth(2)).toHaveText('自動で判定するもの');

  // 運動を選ばなくても閉じられる（歩数が自動で取れるため任意になった）
  await page.evaluate(() => {
    catalogByMech('biogenesis').forEach(c => unpickItem(DB.items, c.id, today));
    commit(); renderPickBody();
  });
  await page.locator('#pickDone').click();
  await expect(page.locator('#pickModal')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => DB.onboarded)).toBe(true);
});

test('自動判定の項目は外せず、強度だけを選べる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();

  // 歩数の目標を8,000歩に変える
  await page.locator('.pick-row-main', { hasText: '8,000歩' }).click();
  expect(await page.evaluate(() => DB.items.find(i => i.id === 'walk').threshold)).toBe(8000);

  // 睡眠は必要時間を選べる（一律6時間ではない）
  await page.locator('.pick-row-main', { hasText: '8時間' }).click();
  expect(await page.evaluate(() => DB.items.find(i => i.id === 'sleeplack').threshold)).toBe(8);

  // 自動判定の項目は外す手段が無い（トグルではなく強度の選択肢しか出ない）
  const walkStillOn = await page.evaluate(() => isItemActiveOn(DB.items.find(i => i.id === 'walk'), today));
  expect(walkStillOn).toBe(true);
});

test('目標歩数を上げても、過去の達成が取り消されない', async ({ page }) => {
  // 3,000歩で達成していた日がある既存ユーザー
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', items: null, onboarded: true,
      days: { '2026-07-01': { steps: 3500 }, '2026-07-02': { steps: 3200 } },
    }));
  });
  await page.goto('/index.html');
  const before = await page.evaluate(() => computeState(DB, '2026-07-02').mito);

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await page.locator('.pick-row-main', { hasText: '10,000歩' }).click();

  const after = await page.evaluate(() => ({
    mito: computeState(DB, '2026-07-02').mito,
    threshold: DB.items.find(i => i.id === 'walk').threshold,
  }));
  expect(after.threshold).toBe(10000);
  // 過去は当時の基準(3,000歩)のまま判定される
  expect(after.mito).toBe(before);
});

test('既存ユーザーにはオンボーディングが出ない', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', items: null,
      days: { '2026-07-01': { checked: ['juice'] } },   // 記録が1日でもあれば既存ユーザー
    }));
  });
  await page.goto('/index.html');

  await expect(page.locator('#pickModal')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => DB.onboarded)).toBe(true);
});

test('禁酒を休肝日に入れ替えても、過去に禁酒でためた匹数が変わらない', async ({ page }) => {
  // 7/1〜7/3 に禁酒をチェックして育てた既存ユーザー
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', items: null, onboarded: true,
      days: {
        '2026-07-01': { checked: ['nosake', 'juice'] },
        '2026-07-02': { checked: ['nosake'] },
        '2026-07-03': { checked: ['nosake', 'juice'] },
      },
    }));
  });
  await page.goto('/index.html');

  const before = await page.evaluate(() => {
    const s = computeState(DB, '2026-07-03');
    return { mito: s.mito, act: s.activation };
  });

  // 設定タブ →「やることを選ぶ」→ 禁酒を外して休肝日にする
  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await expect(page.locator('#pickModal')).toHaveClass(/open/);
  await page.locator('.pick-row-main', { hasText: '禁酒' }).click();
  await page.locator('.pick-row-main', { hasText: '休肝日' }).click();
  await page.locator('#pickDone').click();

  const after = await page.evaluate(() => {
    const s = computeState(DB, '2026-07-03');
    const nosake = DB.items.find(i => i.id === 'nosake');
    const restday = DB.items.find(i => i.id === 'restday');
    return {
      mito: s.mito, act: s.activation,
      禁酒は残っている: !!nosake,
      禁酒は今日から無効: !isItemActiveOn(nosake, today),
      禁酒は過去には有効: isItemActiveOn(nosake, '2026-07-03'),
      休肝日が有効: isItemActiveOn(restday, today),
    };
  });

  // 過去の集計は1ミリも動かない
  expect(after.mito).toBe(before.mito);
  expect(after.act).toBe(before.act);
  // 項目は消さずに有効期間を閉じている
  expect(after.禁酒は残っている).toBe(true);
  expect(after.禁酒は今日から無効).toBe(true);
  expect(after.禁酒は過去には有効).toBe(true);
  expect(after.休肝日が有効).toBe(true);
});

test('選び直すとホームの「今日やること」も入れ替わる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  // 既定では禁酒がやることに出ている
  await expect(page.locator('#todoRowManual')).toContainText('禁酒');
  await expect(page.locator('#todoRowManual')).not.toContainText('休肝日');

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await page.locator('.pick-row-main', { hasText: '禁酒' }).click();
  await page.locator('.pick-row-main', { hasText: '休肝日' }).click();
  await page.locator('#pickDone').click();

  await page.locator('nav.footer button[data-tab="home"]').click();

  // 外した項目は消え、選んだ項目が出ている
  await expect(page.locator('#todoRowManual')).toContainText('休肝日');
  await expect(page.locator('#todoRowManual')).not.toContainText('禁酒');
});

test('選択画面に一行説明が出て、ⓘで詳しい解説が読める', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();

  // 名前だけでなく、何をするのかの一行説明が添えられている
  const hiit = page.locator('.pick-row', { hasText: 'HIIT' });
  await expect(hiit).toContainText('短時間で最も効率がいい');

  // ⓘは選択と誤爆せず、解説だけを開く
  await hiit.locator('.pick-row-info').click();
  await expect(page.locator('#infoModal')).toHaveClass(/open/);
  await expect(page.locator('#infoBody')).toContainText('ミトコンドリアを増やす司令');
  // 解説を開いただけでは選択は変わらない
  expect(await page.evaluate(() => activePickIds())).not.toContain('hiit');
});

test('選べる数の上限を超えて選べない', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();

  // ストレス枠は最大1つ。既定で呼吸瞑想が選ばれているので、入浴は選べないはず
  await page.locator('.pick-row-main', { hasText: '入浴' }).click();
  await expect(page.locator('#pickWarn')).toContainText('最大1つ');

  const ids = await page.evaluate(() => activePickIds());
  expect(ids).not.toContain('bath');
});
