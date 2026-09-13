// @ts-check
// v1.72: 4言語対応の土台（zh/ms は辞書が空。翻訳は別工程）。
// ここで確認するのは仕組みだけ：<html lang>の切り替え、フォールバック（zh/ms→en）、
// 端末の言語からの判定（zh-TW/ms-MY/ko-KR等）、解析APIへ送るlang。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers');

/** ページ読み込み前に navigator.language / navigator.languages を差し替える。
    同じpageで複数回呼ぶと登録したスクリプトが積み重なって毎回のgoto前に全部走るため、
    後から上書きできるよう configurable:true にしておく（最後に登録したものが最終的に勝つ） */
function mockDeviceLanguage(page, lang) {
  return page.addInitScript((l) => {
    Object.defineProperty(navigator, 'language', { get: () => l, configurable: true });
    Object.defineProperty(navigator, 'languages', { get: () => [l], configurable: true });
  }, lang);
}

test('setLang("zh") で <html lang> が zh-Hans になる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('zh'));
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-Hans');
});

test('setLang("ms") で <html lang> が ms になる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('ms'));
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ms');
});

test('setLang("en") / setLang("ja") では <html lang> がそれぞれ en / ja のまま（zh-Hansにならない）', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('en'));
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await page.evaluate(() => setLang('ja'));
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ja');
});

test('zh表示は簡体字フォントのスタックに切り替わる（日本語フォントと混ざらない）', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  const before = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(before).toContain('Noto Sans JP');
  await page.evaluate(() => setLang('zh'));
  const after = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(after).toContain('Noto Sans SC');
  expect(after).not.toContain('Noto Sans JP');
});

test('zh/msは辞書が空でも、画面に日本語ではなく英語が出る（en へのフォールバック）', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  const JA = /[ぁ-んァ-ヴ一-龥]/;

  for (const lang of ['zh', 'ms']) {
    const texts = await page.evaluate((l) => {
      setLang(l);
      return {
        home: document.querySelector('#todoCard h2').textContent,
        editBtn: document.getElementById('btnEditMissions').textContent,
        name: itemName({ id: 'bodyweight' }),
        appName: appName(),
      };
    }, lang);
    for (const [k, v] of Object.entries(texts)) {
      expect(JA.test(v), `${lang}: ${k} に日本語が出ている: ${v}`).toBe(false);
    }
    // en の実際の文言と一致する（フォールバックが機能している証拠）
    expect(texts.home).toContain('Daily missions');
    expect(texts.appName).toBe('Mito Life');
  }
});

test('tOrのfallback（保存名）も、zh/msではenを優先しjaへは落ちない', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  const r = await page.evaluate(() => {
    setLang('zh');
    // item.bodyweight.name は en辞書にあるので、zh(空)→enの順で "Bodyweight..." が返るはず
    return itemName({ id: 'bodyweight', name: '自重トレ（家でできる腕立て・スクワット）' });
  });
  expect(r).toContain('Bodyweight');
});

test('端末の言語からappLang()を判定する（zh-TW→zh / ms-MY→ms / ko-KR→en）', async ({ page }) => {
  for (const [device, expected] of [['zh-TW', 'zh'], ['zh-CN', 'zh'], ['ms-MY', 'ms'], ['ko-KR', 'en'], ['fr-FR', 'en']]) {
    await mockDeviceLanguage(page, device);
    await page.goto('/index.html');
    const lang = await page.evaluate(() => appLang());
    expect(lang, `device=${device}`).toBe(expected);
  }
});

test('DB.langが不正値(ko等)や未対応言語のときは端末の言語にフォールバックする', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', items: null, days: {}, onboarded: true, lang: 'ko',
    }));
  });
  await mockDeviceLanguage(page, 'ms-MY');
  await page.goto('/index.html');
  const lang = await page.evaluate(() => appLang());
  expect(lang).toBe('ms');   // 'ko' は対応言語でないため無視され、端末の言語(ms-MY)を見る
});

test('解析APIへは zh/ms のときもその言語コードが送られる', async ({ page }) => {
  const captured = [];
  await page.route('**/api/device', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ deviceId: 'testdevice.testsignature' }) });
  });
  await page.route('**/api/analyze-meal', async (route) => {
    captured.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        analysis: { dishes: [{ name: 'x', amount: 'y' }], nutrition: { calories_kcal: 1, protein_g: 1, fat_g: 1, carbs_g: 1 },
          mito_score: 1, good_points: [], advice: '', caution: '', confidence: 'high' },
        meta: { model: 'test', est_cost_usd: 0, remaining: 5, limit: 6 },
      }),
    });
  });
  await skipOnboarding(page);
  await page.goto('/index.html');

  const langs = ['zh', 'ms'];
  for (let i = 0; i < langs.length; i++) {
    await page.evaluate((l) => setLang(l), langs[i]);
    await page.locator('nav.footer button[data-tab="meals"]').click();
    // 食事ごとに別スロット（breakfast/lunch）を使う。同じ食事を2回使うと
    // 1回目の解析結果が残って2回目はフォームでなく結果画面が開いてしまうため
    await page.locator('.photo-add-btn').nth(i).click();
    await page.locator('#addChoiceText').click();
    await page.locator('#mealNote').fill('test note');
    await page.locator('#mealFul button').first().click();
    await page.locator('#mealRun').click();
    await page.waitForTimeout(300);
  }
  expect(captured.length).toBe(2);
  expect(captured[0].lang).toBe('zh');
  expect(captured[1].lang).toBe('ms');
});
