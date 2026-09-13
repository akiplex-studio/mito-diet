// @ts-check
// v1.73: 月名を辞書(I18N)経由にした（以前は英語決め打ちのMONTHS_EN配列を全言語で使っており、
// マレー語(ms)でも "14 September" のように英語の月名が出ていた）。
// 月名キー(month.1〜month.12)は t(MONTH_KEYS[idx]) のように動的に組み立てて参照するため、
// scripts/i18n-check.mjs の静的スキャン（t('リテラル')しか拾えない）では実在チェックの
// 死角になる。ここで別途、キーの実在と実際の表示への反映を確認する。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers.js');

const MONTH_KEYS = Array.from({ length: 12 }, (_, i) => `month.${i + 1}`);
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

test('month.1〜month.12 が I18N.ja / I18N.en に12個ずつ実在する（連結キーの死角対策）', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  const result = await page.evaluate((keys) => {
    // @ts-ignore アプリ側のグローバル
    return { ja: keys.map((k) => I18N.ja[k]), en: keys.map((k) => I18N.en[k]) };
  }, MONTH_KEYS);

  expect(result.ja.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  expect(result.en).toEqual(EN_MONTHS);
});

test('en表示の日付見出し・年月ヘッダーは、修正前(MONTHS_EN決め打ち)と完全に同じ文字列のまま', async ({ page }) => {
  // 2026-09-15(火) 09:00 に固定。週表示の木曜(dates[3])も同じ9月に収まる日を選ぶ
  await page.clock.install({ time: new Date(2026, 8, 15, 9, 0, 0) });
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('en'));

  // 2026-09-14 は月曜
  const md = await page.evaluate(() => fmtJP('2026-09-14'));
  expect(md).toBe('September 14 (Mon)');

  const hdr = await page.locator('#hdrDate').textContent();
  expect(hdr).toBe('September 2026');
});

test('ms辞書に月名だけ目印を入れると見出しに反映される（辞書経由になった証拠。修正前は失敗する）', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 8, 15, 9, 0, 0) });
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => {
    // @ts-ignore アプリ側のグローバル: ms辞書は普段は空({})。month.9だけ目印を注入する
    I18N.ms['month.9'] = 'Sept-ms';
    // @ts-ignore
    setLang('ms');
  });

  const md = await page.evaluate(() => fmtJP('2026-09-14'));
  expect(md).toContain('Sept-ms');
  expect(md).not.toContain('September');

  const hdr = await page.locator('#hdrDate').textContent();
  expect(hdr).toContain('Sept-ms');
  expect(hdr).not.toContain('September');
});
