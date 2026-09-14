// @ts-check
// v1.72: zh(簡体字中国語)・ms(マレー語)の訳を投入した後、主要な画面に
// 日本語(かな)の取り残しが無いか、msは漢字・全角記号も残っていないかを機械的に確認する。
// 対象: ホーム・食事・記録・設定・ミッション選択・チュートリアルの言語選択画面。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers');

// ひらがな・カタカナ（scripts/i18n-check.mjs の LEAK_RE と同じ範囲）
const KANA_RE = /[぀-ヿ]/;
// ms側は漢字・全角記号（CJK統合漢字・全角句読点・全角英数記号）も残っていてはいけない
const CJK_MS_RE = /[　-〿㐀-鿿＀-￯]/;

// 言語名の自称表記など、常に元の文字で出す意図的な例外（scripts/i18n-scan.mjs の ALLOW と同じ思想）
const EXEMPT_SELECTORS = ['#setLang', '.tut-choices'];

/** 画面に「今見えている」要素のテキスト・title・placeholder・aria-labelを集める */
async function collectVisibleTexts(page, exemptSelectors) {
  return page.evaluate((exempt) => {
    const out = [];
    function isVisible(el) {
      if (el.hidden) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    }
    function isExempt(el) {
      return exempt.some((sel) => el.closest(sel));
    }
    function walk(el) {
      if (!isVisible(el)) return;
      if (isExempt(el)) return;
      if (el.title) out.push(el.title);
      if ('placeholder' in el && el.placeholder) out.push(el.placeholder);
      const aria = el.getAttribute && el.getAttribute('aria-label');
      if (aria) out.push(aria);
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child.textContent.trim();
          if (t) out.push(t);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      }
    }
    walk(document.body);
    return out;
  }, exemptSelectors);
}

function assertNoLeak(texts, lang, re, label) {
  const bad = texts.filter((t) => re.test(t));
  expect(bad, `${lang}: ${label} が残っている: ${JSON.stringify(bad)}`).toEqual([]);
}

for (const lang of ['zh', 'ms']) {
  test(`${lang}: ホーム/食事/記録/設定/ミッション選択の画面に日本語(かな)が残らない`, async ({ page }) => {
    await skipOnboarding(page);
    await page.goto('/index.html');
    await page.evaluate((l) => setLang(l), lang);

    // ホーム
    let texts = await collectVisibleTexts(page, EXEMPT_SELECTORS);
    assertNoLeak(texts, lang, KANA_RE, 'ホーム画面にかな');
    if (lang === 'ms') assertNoLeak(texts, lang, CJK_MS_RE, 'ホーム画面に漢字・全角記号');

    // 食事タブ
    await page.locator('nav.footer button[data-tab="meals"]').click();
    texts = await collectVisibleTexts(page, EXEMPT_SELECTORS);
    assertNoLeak(texts, lang, KANA_RE, '食事タブにかな');
    if (lang === 'ms') assertNoLeak(texts, lang, CJK_MS_RE, '食事タブに漢字・全角記号');

    // 記録タブ
    await page.locator('nav.footer button[data-tab="records"]').click();
    texts = await collectVisibleTexts(page, EXEMPT_SELECTORS);
    assertNoLeak(texts, lang, KANA_RE, '記録タブにかな');
    if (lang === 'ms') assertNoLeak(texts, lang, CJK_MS_RE, '記録タブに漢字・全角記号');

    // 設定タブ（#setLangの選択肢は例外として除外済み）
    await page.locator('nav.footer button[data-tab="settings"]').click();
    texts = await collectVisibleTexts(page, EXEMPT_SELECTORS);
    assertNoLeak(texts, lang, KANA_RE, '設定タブにかな');
    if (lang === 'ms') assertNoLeak(texts, lang, CJK_MS_RE, '設定タブに漢字・全角記号');

    // ミッション選択（ホームへ戻ってから開く）
    await page.locator('nav.footer button[data-tab="home"]').click();
    await page.locator('#btnEditMissions').click();
    await expect(page.locator('#pickModal')).toHaveClass(/open/);
    texts = await collectVisibleTexts(page, EXEMPT_SELECTORS);
    assertNoLeak(texts, lang, KANA_RE, 'ミッション選択画面にかな');
    if (lang === 'ms') assertNoLeak(texts, lang, CJK_MS_RE, 'ミッション選択画面に漢字・全角記号');
  });

  test(`${lang}: チュートリアルの言語選択画面自体には、選択中の言語（見出し等）にかなが残らない`, async ({ page }) => {
    await page.goto('/index.html');   // まっさらな状態。最初に言語選択が出る
    await expect(page.locator('#tutorial')).toBeVisible();
    // .tut-choices の選択肢ラベル自体（日本語, 中文（简体）等）は意図的な例外なので除外して見る
    const texts = await collectVisibleTexts(page, EXEMPT_SELECTORS);
    // 言語選択前は既定でjaの可能性があるため、選んでから見出し等を確認する
    await page.locator('.tut-choice', { hasText: lang === 'zh' ? '中文（简体）' : 'Bahasa Melayu' }).click();
    const textsAfter = await collectVisibleTexts(page, EXEMPT_SELECTORS);
    assertNoLeak(textsAfter, lang, KANA_RE, 'チュートリアル(言語選択後)にかな');
    if (lang === 'ms') assertNoLeak(textsAfter, lang, CJK_MS_RE, 'チュートリアル(言語選択後)に漢字・全角記号');
    void texts; // 選択前の画面は意図的に例外だらけなので検証対象外（記録のみ）
  });
}
