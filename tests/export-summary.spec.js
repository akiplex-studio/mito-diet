// @ts-check
// 「記録だけ書き出す（写真なし）」の検証。
// 落ちたファイルの中身を実際に読む（本番と同じ経路を通す）。
// この書き出しは Obsidian への取り込みと、将来の Claude共有の両方の土台になる。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers.js');

test('記録だけ書き出す：写真を含まず、栄養と達成項目が入る', async ({ page }) => {
  await skipOnboarding(page);
  await page.addInitScript(() => {
    const meal = (k,p,f,c,full) => ({ analysis:{ nutrition:{ calories_kcal:k, protein_g:p, fat_g:f, carbs_g:c } }, fullness:full });
    const d = JSON.parse(localStorage.getItem('mito-data'));
    d.startDate = '2026-08-20';
    d.days = {
      '2026-08-20': { checked:['juice'], steps:6499,
        photos:{ breakfast:[{data:'data:image/jpeg;base64,AAAA'}], lunch:[], dinner:[] },
        mealAnalysis:{ breakfast: meal(420,18,12,55,'腹七分目くらい'), lunch: meal(760,32,28,88,'ふつう'), dinner:null } },
      '2026-08-21': { checked:[], photos:{breakfast:[],lunch:[],dinner:[]},
        mealAnalysis:{breakfast:null,lunch:null,dinner:null} },
    };
    localStorage.setItem('mito-data', JSON.stringify(d));
  });
  await page.goto('/index.html');
  await page.locator('nav.footer button[data-tab="settings"]').click();
  // ボタンを実際に押し、**落ちたファイルの中身**を読む（本番と同じ経路を通す）
  const [dl0] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btnExportSummary'),
  ]);
  const fs = require('fs');
  const payload = JSON.parse(fs.readFileSync(await dl0.path(), 'utf-8'));
  console.log('ファイル名:', dl0.suggestedFilename());
  console.log(JSON.stringify(payload, null, 2));
  const raw = JSON.stringify(payload);
  expect(raw).not.toContain('base64');          // 写真が混ざっていない
  expect(payload.days['2026-08-20'].meal_kcal).toBe(1180);
  expect(payload.days['2026-08-20'].protein_g).toBe(50);
  expect(payload.days['2026-08-20'].meals_recorded).toBe(2);
  expect(payload.days['2026-08-20'].hara7_meals).toBe(1);
  expect(payload.days['2026-08-20'].mito_done).toContain('野菜ジュースを飲む');
  expect(payload.days['2026-08-21'].meal_kcal).toBeUndefined();  // 解析なしの日は栄養キーを出さない

  expect(dl0.suggestedFilename()).toMatch(/^mito-summary-\d{4}-\d{2}-\d{2}\.json$/);
});
