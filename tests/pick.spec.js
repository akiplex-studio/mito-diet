// @ts-check
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers');

// v1.49: やることの選び直し（機序ごとの代替選択）とオンボーディング。
//
// 一番大事なのは「選び直しても過去の育成結果が変わらない」こと。
// このアプリは匹数・活性を記録ログ全期間から毎回再計算するので、素朴に項目を
// 差し替えると過去まで巻き添えになる。項目は消さず有効期間を閉じることで防いでいる。

test('初回起動ではオンボーディングが開き、運動を選ばないと閉じられない', async ({ page }) => {
  await page.goto('/index.html');   // まっさらな状態

  await expect(page.locator('#pickModal')).toHaveClass(/open/);
  // 逃げ道（閉じるボタン）は隠れている
  await expect(page.locator('#pickModal .sheet-close')).toBeHidden();

  // 運動枠（はずせない）の選択をすべて外す
  await page.evaluate(() => {
    catalogByMech('biogenesis').forEach(c => unpickItem(DB.items, c.id, today));
    commit();
    renderPickBody();
  });

  await page.locator('#pickDone').click();
  // 運動が無いままでは閉じられず、理由が出る
  await expect(page.locator('#pickModal')).toHaveClass(/open/);
  await expect(page.locator('#pickWarn')).toContainText('ミトコンドリアを増やす');

  // ひとつ選べば閉じられる
  await page.locator('.pick-row-main', { hasText: 'スイミング' }).click();
  await page.locator('#pickDone').click();
  await expect(page.locator('#pickModal')).not.toHaveClass(/open/);

  const onboarded = await page.evaluate(() => DB.onboarded);
  expect(onboarded).toBe(true);
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

  // 体内時計は最大1つ。既定では朝の光が未選択なので、選んでからもう一度別を選ぼうとする
  // ここでは「増やす」枠(最大2)で試す: 既定はウォーキング＋自重トレの2つ＝上限
  await page.locator('.pick-row-main', { hasText: 'HIIT' }).click();
  await expect(page.locator('#pickWarn')).toContainText('最大2つ');

  const ids = await page.evaluate(() => activePickIds());
  expect(ids).not.toContain('hiit');
});
