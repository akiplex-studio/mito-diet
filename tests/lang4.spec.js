// @ts-check
// v1.72: 4言語対応（zh/ms に全キー翻訳を投入。未収録キーは無い）。
// ここで確認するのは：<html lang>の切り替え、翻訳の反映、フォールバックの仕組み（辞書からキーを一時的に
// 消して確認。その言語→en、jaへは落ちない）、端末の言語からの判定（zh-TW/ms-MY/ko-KR等）、解析APIへ送るlang。
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

// v1.72翻訳投入の回帰テスト: 修正前（I18N.zh/I18N.ms が空）はここが必ず "Daily missions"
// （英語フォールバック）になり落ちる。翻訳投入後はzh/msそれぞれの実際の訳文になる。
test('zh/msでは翻訳された文言が画面に出る（辞書投入の回帰確認）', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  const texts = await page.evaluate(() => {
    setLang('zh');
    const home_zh = document.querySelector('#todoCard h2 span[data-i18n="ui.home.missions"]').textContent.trim();
    setLang('ms');
    const home_ms = document.querySelector('#todoCard h2 span[data-i18n="ui.home.missions"]').textContent.trim();
    return { home_zh, home_ms };
  });
  expect(texts.home_zh).toBe('每日任务');
  expect(texts.home_ms).toBe('Misi harian');
});

test('zh/msでは日本語が残らず、通常キーは翻訳・アプリ名は "Mito Life"', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  const JA = /[ぁ-んァ-ヴ]/;

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
      expect(JA.test(v), `${lang}: ${k} に日本語(かな)が出ている: ${v}`).toBe(false);
    }
    expect(texts.appName).toBe('Mito Life');
  }
});

// v1.72翻訳投入の回帰テスト: info.hara7.why はzh/msどちらにも訳が入っている。
// 修正前（I18N.zh/I18N.ms にこのキーが無い）はここが必ず英語(mitophagy)へフォールバックして落ちる。
test('infoWhy("hara7")はzh/msそれぞれの言語の訳文が出る（辞書投入の回帰確認）', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  for (const [lang, expected] of [
    ['zh', '据认为，轻微的饥饿感'],
    ['ms', 'Rasa lapar ringan'],
  ]) {
    const r = await page.evaluate(({ l }) => {
      setLang(l);
      // @ts-ignore アプリ側のグローバル
      return infoWhy('hara7');
    }, { l: lang });
    expect(r, `${lang}: infoWhy('hara7')`).toContain(expected);
  }
});

// フォールバックの仕組み自体（その言語→en、jaへは落ちない）は、辞書に全キー揃った今は
// 実データでは再現できないため、辞書からキーを一時的に消して確認する。
test('tOrのfallback: 辞書からキーを一時的に消すと、zh/msではenへ落ちる（jaへは落ちない）', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  const JA = /[ぁ-んァ-ヴ]/;
  for (const lang of ['zh', 'ms']) {
    const r = await page.evaluate((l) => {
      setLang(l);
      // @ts-ignore アプリ側のグローバル。フォールバックを確かめるため辞書から一時的にキーを消す
      const saved = I18N[l]['info.hara7.why'];
      delete I18N[l]['info.hara7.why'];
      // @ts-ignore
      const result = infoWhy('hara7');
      I18N[l]['info.hara7.why'] = saved; // 元に戻す
      return result;
    }, lang);
    expect(r, `${lang}: infoWhy('hara7')`).toContain('mitophagy');
    expect(JA.test(r), `${lang}: infoWhy('hara7') に日本語(かな)が出ている: ${r}`).toBe(false);
  }
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
