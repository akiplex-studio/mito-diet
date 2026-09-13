// @ts-check
// v1.72: 説明画面（ⓘ）に「研究メモ」を追加。info.<id>.note キーを持つ項目だけ、
// 「なぜ効くか」ブロックの下に出す（キーが無い項目は何も出さない）。
// あわせて腹七分目(hara7)の文言も、マイトファジーを断定しすぎない表現に直した。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers.js');

/** #infoBody の中身から、ラベル文字列の出現位置（無ければ -1）を返す */
async function labelOrder(page) {
  const html = await page.locator('#infoBody').innerHTML();
  return {
    why: html.indexOf('なぜミトコンドリアに効くの'),
    why_en: html.indexOf('Why it helps your mitochondria'),
    note: html.indexOf('研究メモ'),
    note_en: html.indexOf('Research note'),
    tips: html.indexOf('実践のコツ'),
    tips_en: html.indexOf('How to do it'),
  };
}

test('腹七分目(ja)の説明シートは、なぜ効くかの下・実践のコツの上に研究メモが出る', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => {
    // @ts-ignore アプリ側のグローバル
    openInfo(catalogById('hara7'));
  });
  await expect(page.locator('#infoModal')).toHaveClass(/open/);

  const pos = await labelOrder(page);
  expect(pos.why).toBeGreaterThan(-1);
  expect(pos.note).toBeGreaterThan(pos.why);
  expect(pos.tips).toBeGreaterThan(pos.note);

  await expect(page.locator('#infoBody .info-note')).toContainText(
    '空腹でマイトファジーが進むことは主に細胞や動物で示されたもので、ヒトの筋肉ではまだ直接確かめられていません'
  );

  // hara7の文言修正: 「AMPKやサーチュインを介して」の断定表現は削除されている
  const bodyText = await page.locator('#infoBody').textContent();
  expect(bodyText).not.toContain('AMPKやサーチュインを介して');
  expect(bodyText).toContain('負担になるとみられています');
});

test('腹七分目(en)の説明シートでも研究メモが出て、日本語は残らない', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => {
    // @ts-ignore
    setLang('en');
    openInfo(catalogById('hara7'));
  });

  const pos = await labelOrder(page);
  expect(pos.why_en).toBeGreaterThan(-1);
  expect(pos.note_en).toBeGreaterThan(pos.why_en);
  expect(pos.tips_en).toBeGreaterThan(pos.note_en);

  await expect(page.locator('#infoBody .info-note')).toContainText(
    'hasn’t yet been confirmed directly in human muscle'
  );

  const bodyText = await page.locator('#infoBody').textContent();
  expect(bodyText).not.toMatch(/[ぁ-んァ-ヴ一-龥]/);
  expect(bodyText).toContain('is thought to become a burden on your mitochondria instead');
});

test('研究メモの無い項目（walking）では、説明シートに研究メモが出ない', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => {
    // @ts-ignore
    openInfo(catalogById('walking'));
  });
  await expect(page.locator('#infoModal')).toHaveClass(/open/);
  await expect(page.locator('#infoBody .info-note')).toHaveCount(0);
  const bodyText = await page.locator('#infoBody').textContent();
  expect(bodyText).not.toContain('研究メモ');
});

test('達成ポップアップ（openAchieveDialog）には研究メモを出さない', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => {
    // @ts-ignore アプリ側のグローバル
    openAchieveDialog({ id: 'hara7', name: '腹七分目を守る' }, null);
  });
  const bodyText = await page.locator('#achieveModal').textContent();
  expect(bodyText).not.toContain('研究メモ');
});

test('zh表示（辞書が空）でも、腹七分目の研究メモは日本語にならずenへフォールバックする', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => {
    // @ts-ignore
    setLang('zh');
    openInfo(catalogById('hara7'));
  });
  const note = page.locator('#infoBody .info-note');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText('Research note');
  await expect(note).toContainText('hasn’t yet been confirmed directly in human muscle');
  const bodyText = await page.locator('#infoBody').textContent();
  expect(bodyText).not.toMatch(/[ぁ-んァ-ヴ]/);
});
