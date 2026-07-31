// @ts-check
const { test, expect } = require('@playwright/test');
const { skipOnboarding, pickItems } = require('./helpers');

// v1.49: がんばり度（5段階）と、既存ユーザーのデータが壊れないことの担保。
//
// このアプリは匹数・活性を「日次記録ログから毎回再計算する」設計なので、
// 項目の効果値を変えると過去の育成結果まで遡って変わってしまう。
// そのため新しい効果値（がんばり度つき）は新規ユーザーだけに適用し、
// 既存ユーザーの保存済み項目（例: 自重トレ inc:15・efforts無し）はそのまま維持する。
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

  // 最大段階（追い込んだ = +3.5匹。v1.61で値を下げた）を選ぶ
  await choices.nth(4).click();
  await expect(page.locator('#effortModal')).not.toHaveClass(/open/);

  const after = await page.evaluate(() => ({
    mito: computed.mito,
    effort: DB.days[today].effort.bodyweight,
    checked: DB.days[today].checked,
  }));

  expect(after.checked).toContain('bodyweight');
  expect(after.effort).toBe(4);                 // 選んだ段階が記録されている
  // 活性+6で基礎+1、がんばり度「追い込んだ」で+3.5 → 合計+4.5
  expect(after.mito - before).toBe(4.5 - 1);    // before には当日の基礎+1が既に入っているため

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

test('v1.61: 保存済みの項目にも新しい効果値が反映され、過去の匹数も下がる', async ({ page }) => {
  // 旧い効果値（自重トレ 追い込んだ=8匹）で3日ぶん育てた既存ユーザー
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', onboarded: true,
      items: [{
        id: 'bodyweight', name: '自重トレ', short: '自重トレ', act: 6, inc: 4,
        inTodo: true, order: 4, mech: 'biogenesis',
        periods: [{ from: '2026-07-01', until: null }],
        efforts: [
          { label: 'ちょっとだけ', inc: 1 }, { label: '軽め', inc: 2 }, { label: 'ふつう', inc: 4 },
          { label: 'しっかり', inc: 6 }, { label: '追い込んだ', inc: 8 },
        ],
      }],
      days: {
        '2026-07-01': { checked: ['bodyweight'], effort: { bodyweight: 4 } },
        '2026-07-02': { checked: ['bodyweight'], effort: { bodyweight: 4 } },
        '2026-07-03': { checked: ['bodyweight'], effort: { bodyweight: 4 } },
      },
    }));
  });
  await page.goto('/index.html');

  const after = await page.evaluate(() => ({
    efforts: DB.items.find(i => i.id === 'bodyweight').efforts.map(e => e.inc),
    mito: computeState(DB, '2026-07-03').mito,
  }));
  // 新しい値に置き換わっている
  expect(after.efforts).toEqual([0.5, 1, 1.5, 2.5, 3.5]);
  // 過去の匹数も新しい基準で計算し直される。
  // 旧値（追い込んだ=8匹）のままなら3日で30匹まで伸びていたところが16.5匹になる
  expect(after.mito).toBe(16.5);
});
