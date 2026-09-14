// @ts-check
// v1.72: 中国語・マレー語の訳を入れたので、ミッションカードの名前（.tc-name、2行までで
// -webkit-line-clamp:2 により切れる）が幅360pxで ja/en より多く切れていないかを確認する。
// 既定のミッション一式（DEFAULT_ITEMS。skipOnboardingの items:null が読み込む）で測る。
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers');

/** 現在の言語で #todoCard 内の .tc-name のうち、2行に収まらず切れている項目を返す */
async function truncatedCards(page, lang) {
  return page.evaluate((l) => {
    // @ts-ignore アプリ側のグローバル
    setLang(l);
    const cards = Array.from(document.querySelectorAll('#todoCard .tc-name'));
    return cards
      .map((el) => {
        const wrap = el.closest('[data-id]');
        return {
          id: wrap ? wrap.getAttribute('data-id') : null,
          text: el.textContent,
          truncated: el.scrollHeight > el.clientHeight + 1,
        };
      })
      .filter((c) => c.truncated);
  }, lang);
}

test('360px幅: 既定のミッション一式で、カード名の切れる件数は zh/ms が ja 以下', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await skipOnboarding(page);
  await page.goto('/index.html');

  /** @type {Record<string, {id:string|null, text:string}[]>} */
  const truncated = {};
  for (const lang of ['ja', 'en', 'zh', 'ms']) {
    truncated[lang] = await truncatedCards(page, lang);
  }

  const describe = (lang) => JSON.stringify(truncated[lang]);
  expect(truncated.zh.length, `zh: ${describe('zh')} / ja: ${describe('ja')}`)
    .toBeLessThanOrEqual(truncated.ja.length);
  expect(truncated.ms.length, `ms: ${describe('ms')} / ja: ${describe('ja')}`)
    .toBeLessThanOrEqual(truncated.ja.length);

  // 「寝る前2時間」(item.nightfast.short) はms訳が長め（"2j sebelum tidur"）なので個別に確認する
  const nightfastTruncated = (lang) => truncated[lang].some((c) => c.id === 'nightfast');
  expect(nightfastTruncated('ms'), `ms nightfast: ${describe('ms')}`).toBe(false);
  expect(nightfastTruncated('zh'), `zh nightfast: ${describe('zh')}`).toBe(false);
});
