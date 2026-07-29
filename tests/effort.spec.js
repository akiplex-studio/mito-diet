// @ts-check
const { test, expect } = require('@playwright/test');
const { skipOnboarding, pickItems } = require('./helpers');

// v1.49: がんばり度（5段階）と、既存ユーザーのデータが壊れないことの担保。
//
// このアプリは匹数・活性を「日次記録ログから毎回再計算する」設計なので、
// 項目の効果値を変えると過去の育成結果まで遡って変わってしまう。
// そのため新しい効果値（がんばり度つき）は新規ユーザーだけに適用し、
// 既存ユーザーの保存済み項目（例: 自重トレ inc:15）はそのまま維持する。
// ここではその両方を実際のブラウザで確認する。
//
// セレクタは index.html を読んで確認した実在要素のみ:
//   - がんばり度モーダル: #effortModal / #effortList .effort-btn
//   - やることカード:     .todo-card

test('新規ユーザー: 運動項目をチェックするとがんばり度を聞かれ、選んだ段階が匹数に反映される', async ({ page }) => {
  /** @type {string[]} */
  const pageErrors = [];
  page.on('pageerror', (err) => { pageErrors.push(err.message); });

  await skipOnboarding(page);
  await page.goto('/index.html');
  await pickItems(page, ['bodyweight']);   // v1.53: 自重トレは推奨セットから外れたので明示的に選ぶ

  const before = await page.evaluate(() => computed.mito);

  // 自重トレのカードを押す → がんばり度モーダルが開く
  await page.getByText('自重トレ', { exact: true }).first().click();
  await expect(page.locator('#effortModal')).toHaveClass(/open/);

  // 5段階そろっていること
  const choices = page.locator('#effortList .effort-btn');
  await expect(choices).toHaveCount(5);

  // 最大段階（追い込んだ = +8匹）を選ぶ
  await choices.nth(4).click();
  await expect(page.locator('#effortModal')).not.toHaveClass(/open/);

  const after = await page.evaluate(() => ({
    mito: computed.mito,
    effort: DB.days[today].effort.bodyweight,
    checked: DB.days[today].checked,
  }));

  expect(after.checked).toContain('bodyweight');
  expect(after.effort).toBe(4);                 // 選んだ段階が記録されている
  // 活性+6で基礎+1、がんばり度「追い込んだ」で+8 → 合計+9
  expect(after.mito - before).toBe(9 - 1);      // before には当日の基礎+1が既に入っているため

  expect(pageErrors, `pageerror が発生: ${pageErrors.join(' / ')}`).toEqual([]);
});

test('チェックを外すときはがんばり度を聞かない', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await pickItems(page, ['bodyweight']);

  await page.getByText('自重トレ', { exact: true }).first().click();
  await page.locator('#effortList .effort-btn').nth(2).click();
  // 達成ダイアログが被るので閉じる
  await page.evaluate(() => document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')));

  await page.getByText('自重トレ', { exact: true }).first().click();

  await expect(page.locator('#effortModal')).not.toHaveClass(/open/);
  const checked = await page.evaluate(() => DB.days[today].checked);
  expect(checked).not.toContain('bodyweight');
});

test('既存ユーザー: 保存済みの効果値(inc:15)が維持され、がんばり度も聞かれない', async ({ page }) => {
  // v1.48以前の保存データを再現する
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5,
      startDate: '2026-07-01',
      items: [
        { id: 'bodyweight', name: '自重トレ（腕立て・スクワット等）', short: '自重トレ',
          act: 6, inc: 15, order: 4, inTodo: true },
      ],
      days: { '2026-07-01': { checked: ['bodyweight'] } },
    }));
  });

  await page.goto('/index.html');

  // 保存済みの効果値がカタログの新しい値(inc:4)で上書きされていないこと
  const item = await page.evaluate(() => {
    const bw = DB.items.find(i => i.id === 'bodyweight');
    return { act: bw.act, inc: bw.inc, hasEfforts: !!bw.efforts };
  });
  expect(item.inc).toBe(15);
  expect(item.act).toBe(6);
  expect(item.hasEfforts).toBe(false);

  // efforts を持たないのでがんばり度は聞かれず、そのままチェックされる
  await page.getByText('自重トレ', { exact: true }).first().click();
  await expect(page.locator('#effortModal')).not.toHaveClass(/open/);
  const checked = await page.evaluate(() => DB.days[today].checked);
  expect(checked).toContain('bodyweight');
});
