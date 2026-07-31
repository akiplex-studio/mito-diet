// @ts-check
// v1.49: テスト共通のセットアップ。
// 初回起動時は「やることを選ぶ」オンボーディングが自動で開き、画面全体を覆う。
// オンボーディング自体を検証するテスト以外は、済んだ状態から始めたいのでこれを使う。

/**
 * オンボーディング済みの状態にしてからページを開けるようにする。
 * page.goto の前に呼ぶこと。
 * @param {import('@playwright/test').Page} page
 */
async function skipOnboarding(page) {
  await page.addInitScript(() => {
    const raw = localStorage.getItem('mito-data');
    if (raw) {
      try {
        const d = JSON.parse(raw);
        d.onboarded = true;
        d.lang = d.lang || 'ja';   // v1.63: 端末が英語でもテストは日本語で始める
        localStorage.setItem('mito-data', JSON.stringify(d));
        return;
      } catch { /* 壊れていたら下で作り直す */ }
    }
    const t = new Date();
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    // items を空にしておくと load() が DEFAULT_ITEMS で初期化してくれる
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: iso, items: null, days: {}, onboarded: true, lang: 'ja',
    }));
  });
}

/**
 * v1.51: 選択画面（デイリーミッションを選ぶ）は枠ごとに折りたたまれていて、
 * 初期状態では選択肢が出ていない。選択肢を操作するテストは先にこれで全部開く。
 * @param {import('@playwright/test').Page} page
 */
async function expandAllPick(page) {
  await page.evaluate(() => {
    // @ts-ignore アプリ側のグローバル
    MECHANISMS.forEach(m => pickOpen.add('mech:' + m.id));
    // @ts-ignore
    autoCatalog().forEach(a => pickOpen.add('auto:' + a.id));
    // @ts-ignore
    renderPickBody();
  });
}

/**
 * v1.53: 推奨セットは最小構成（糖分・夜は食べない・ストレッチ）になったので、
 * 特定の項目を前提にするテストは、その項目を明示的に選んでから始める。
 * @param {import('@playwright/test').Page} page
 * @param {string[]} ids
 */
async function pickItems(page, ids) {
  await page.evaluate((list) => {
    // @ts-ignore アプリ側のグローバル
    list.forEach(id => { const c = catalogById(id); if (c) pickItem(DB.items, c, today); });
    // @ts-ignore
    commit();
  }, ids);
}

/**
 * v1.55: 初回起動ではチュートリアルが先に出る。
 * 選択画面そのものを見たいテストのために、チュートリアルだけ手早く終わらせる。
 * @param {import('@playwright/test').Page} page
 */
async function finishTutorial(page) {
  await page.evaluate(() => {
    // @ts-ignore アプリ側のグローバル
    if (typeof tut !== 'undefined' && tut) tutFinish();
  });
}

module.exports = { skipOnboarding, expandAllPick, pickItems, finishTutorial };
