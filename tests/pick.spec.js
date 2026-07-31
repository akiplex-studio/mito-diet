// @ts-check
const { test, expect } = require('@playwright/test');
const { skipOnboarding, expandAllPick, pickItems, finishTutorial } = require('./helpers');

// v1.49: デイリーミッションの選び直し（機序ごとの代替選択）とオンボーディング。
//
// 一番大事なのは「選び直しても過去の育成結果が変わらない」こと。
// このアプリは匹数・活性を記録ログ全期間から毎回再計算するので、素朴に項目を
// 差し替えると過去まで巻き添えになる。項目は消さず有効期間を閉じることで防いでいる。

test('選択画面は3つの区分で表示される', async ({ page }) => {
  await page.goto('/index.html');   // まっさらな状態
  await finishTutorial(page);       // v1.55: 先にチュートリアルが出るので終わらせる
  // v1.56: チュートリアルの最後で選ばせるのはやめたので、設定から開く
  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await expect(page.locator('#pickModal')).toHaveClass(/open/);

  // v1.51: 運動は折りたたみブロックの見出し、残り2区分はセクション見出しで出る
  await expect(page.locator('.pick-mech-name').first()).toHaveText('運動');
  const heads = page.locator('.pick-section-name');
  await expect(heads).toHaveCount(2);
  await expect(heads.nth(0)).toHaveText('そのほかのミッション');
  await expect(heads.nth(1)).toHaveText('自動で判定するもの');

  // 運動を全部外しても閉じられる（歩数が自動で取れるため任意）
  await page.evaluate(() => {
    catalogByMech('biogenesis').forEach(c => unpickItem(DB.items, c.id, today));
    commit(); renderPickBody();
  });
  await page.locator('#pickDone').click();
  await expect(page.locator('#pickModal')).not.toHaveClass(/open/);
});

test('自動判定の項目は外せず、強度だけを選べる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await expandAllPick(page);

  // 歩数の目標を8,000歩に変える
  await page.locator('.pick-row-main', { hasText: '8,000歩' }).click();
  expect(await page.evaluate(() => DB.items.find(i => i.id === 'walk').threshold)).toBe(8000);

  // 睡眠は必要時間を選べる（一律6時間ではない）
  await page.locator('.pick-row-main', { hasText: '8時間' }).click();
  expect(await page.evaluate(() => DB.items.find(i => i.id === 'sleeplack').threshold)).toBe(8);

  // 自動判定の項目は外す手段が無い（トグルではなく強度の選択肢しか出ない）
  const walkStillOn = await page.evaluate(() => isItemActiveOn(DB.items.find(i => i.id === 'walk'), today));
  expect(walkStillOn).toBe(true);
});

test('目標歩数を上げても、過去の達成が取り消されない', async ({ page }) => {
  // 3,000歩で達成していた日がある既存ユーザー
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', items: null, onboarded: true,
      days: { '2026-07-01': { steps: 3500 }, '2026-07-02': { steps: 3200 } },
    }));
  });
  await page.goto('/index.html');
  const before = await page.evaluate(() => computeState(DB, '2026-07-02').mito);

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await expandAllPick(page);
  await page.locator('.pick-row-main', { hasText: '10,000歩' }).click();

  const after = await page.evaluate(() => ({
    mito: computeState(DB, '2026-07-02').mito,
    threshold: DB.items.find(i => i.id === 'walk').threshold,
  }));
  expect(after.threshold).toBe(10000);
  // 過去は当時の基準(3,000歩)のまま判定される
  expect(after.mito).toBe(before);
});

test('既存ユーザーにはオンボーディングが出ない', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', items: null,
      days: { '2026-07-01': { checked: ['juice'] } },   // 記録が1日でもあれば既存ユーザー
    }));
  });
  await page.goto('/index.html');

  await expect(page.locator('#pickModal')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => DB.onboarded)).toBe(true);
});

test('禁酒を休肝日に入れ替えても、過去に禁酒でためた匹数が変わらない', async ({ page }) => {
  // 7/1〜7/3 に禁酒をチェックして育てた既存ユーザー
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', items: null, onboarded: true,
      days: {
        '2026-07-01': { checked: ['nosake', 'juice'] },
        '2026-07-02': { checked: ['nosake'] },
        '2026-07-03': { checked: ['nosake', 'juice'] },
      },
    }));
  });
  await page.goto('/index.html');
  await pickItems(page, ['nosake']);   // v1.53: 禁酒は推奨セットから外れたので明示的に選ぶ
  // 当時から続けていた状態にする（このテストの主題は「入れ替えても過去が動かない」こと）
  await page.evaluate(() => {
    const it = DB.items.find(i => i.id === 'nosake');
    it.periods = [{ from: '2026-07-01', until: null }];
    commit();
  });

  const before = await page.evaluate(() => {
    const s = computeState(DB, '2026-07-03');
    return { mito: s.mito, act: s.activation };
  });

  // 設定タブ →「やることを選ぶ」→ 禁酒を外して休肝日にする
  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await expect(page.locator('#pickModal')).toHaveClass(/open/);
  await expandAllPick(page);
  await page.locator('.pick-row-main', { hasText: 'お酒を飲まない' }).click();
  await page.locator('.pick-row-main', { hasText: '休肝日をつくる' }).click();
  await page.locator('#pickDone').click();

  const after = await page.evaluate(() => {
    const s = computeState(DB, '2026-07-03');
    const nosake = DB.items.find(i => i.id === 'nosake');
    const restday = DB.items.find(i => i.id === 'restday');
    return {
      mito: s.mito, act: s.activation,
      禁酒は残っている: !!nosake,
      禁酒は今日から無効: !isItemActiveOn(nosake, today),
      禁酒は過去には有効: isItemActiveOn(nosake, '2026-07-03'),
      休肝日が有効: isItemActiveOn(restday, today),
    };
  });

  // 過去の集計は1ミリも動かない
  expect(after.mito).toBe(before.mito);
  expect(after.act).toBe(before.act);
  // 項目は消さずに有効期間を閉じている
  expect(after.禁酒は残っている).toBe(true);
  expect(after.禁酒は今日から無効).toBe(true);
  expect(after.禁酒は過去には有効).toBe(true);
  expect(after.休肝日が有効).toBe(true);
});

test('選び直すとホームのデイリーミッションも入れ替わる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await pickItems(page, ['nosake']);   // v1.53: 禁酒は推奨セットから外れたので明示的に選ぶ

  // 選ぶと禁酒がミッションに出ている
  await expect(page.locator('#todoRowManual')).toContainText('禁酒');
  await expect(page.locator('#todoRowManual')).not.toContainText('休肝日');

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await expandAllPick(page);
  await page.locator('.pick-row-main', { hasText: 'お酒を飲まない' }).click();
  await page.locator('.pick-row-main', { hasText: '休肝日をつくる' }).click();
  await page.locator('#pickDone').click();

  await page.locator('nav.footer button[data-tab="home"]').click();

  // 外した項目は消え、選んだ項目が出ている
  await expect(page.locator('#todoRowManual')).toContainText('休肝日');
  await expect(page.locator('#todoRowManual')).not.toContainText('禁酒');
});

test('選択画面に一行説明が出て、ⓘで詳しい解説が読める', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await expandAllPick(page);

  // 名前だけでなく、何をするのかの一行説明が添えられている
  const hiit = page.locator('.pick-row', { hasText: 'HIIT' });
  await expect(hiit).toContainText('20秒全力');

  // ⓘは選択と誤爆せず、解説だけを開く
  await hiit.locator('.pick-row-info').click();
  await expect(page.locator('#infoModal')).toHaveClass(/open/);
  await expect(page.locator('#infoBody')).toContainText('AMPKの反応が強く出て');
  // v1.53: 「どれくらいやるか」が解説に必ず入っている
  await expect(page.locator('#infoBody')).toContainText('20秒全力＋10秒休みを8本');
  // 解説を開いただけでは選択は変わらない
  expect(await page.evaluate(() => activePickIds())).not.toContain('hiit');
});

test('選べる数の上限を超えて選べない', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await pickItems(page, ['meditate']);
  await page.locator('#btnPickItems').click();
  await expandAllPick(page);

  // ストレス枠は最大1つ。呼吸瞑想が選ばれている状態では、入浴は選べないはず
  await page.locator('.pick-row-main', { hasText: '湯船につかる' }).click();
  await expect(page.locator('#pickWarn')).toContainText('最大1つ');

  const ids = await page.evaluate(() => activePickIds());
  expect(ids).not.toContain('bath');
});

test('選択画面は折りたたまれて開き、開いた枠は選んでも閉じない', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  await pickItems(page, ['meditate']);   // v1.53: ストレス枠の既定は空なので選んでおく
  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();

  // 最初はどの枠も閉じている（選択肢は出ていない）
  await expect(page.locator('#pickBody .pick-opts:not([hidden])')).toHaveCount(0);
  // たたんだままでも「いま選んでいるもの」は見える
  const stress = page.locator('.pick-mech', { hasText: 'ストレスをおろす' });
  await expect(stress.locator('.pick-mech-cur')).toContainText('呼吸瞑想');

  // 開くと選択肢が出る
  await stress.locator('.pick-mech-toggle').click();
  await expect(stress.locator('.pick-opts')).toBeVisible();

  // 選び直し（＝renderPickBodyでの作り直し）をしても開いたまま
  await stress.locator('.pick-row-main', { hasText: '呼吸瞑想' }).click();
  await expect(stress.locator('.pick-opts')).toBeVisible();
  await expect(stress.locator('.pick-mech-cur')).toHaveText('選択中：ストレッチをする');
});

/* --- v1.53 --- */

test('推奨セットで始まり、必須項目は外せない', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  // 初期状態の手動ミッションは最小構成（糖分・夜は食べない・ストレッチ）
  const manual = await page.evaluate(() =>
    DB.items.filter(it => isItemActiveOn(it, today) && it.inTodo).map(it => it.id).sort());
  expect(manual).toEqual(['nightfast', 'stretch', 'sugarCtrl', 'walking']);

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await expandAllPick(page);

  // 必須項目は「外せない」表示が出て、押しても外れない
  const sugar = page.locator('.pick-row', { hasText: '糖分' });
  await expect(sugar).toContainText('外せない');
  await sugar.locator('.pick-row-main').click();
  await expect(page.locator('#pickWarn')).toContainText('外せません');
  expect(await page.evaluate(() => activePickIds())).toContain('sugarCtrl');
});

test('自分で決める枠は名前をつけて追加でき、名前が保存される', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnPickItems').click();
  await expandAllPick(page);

  await page.locator('.pick-row-main', { hasText: '自分で決める枠' }).first().click();
  await expect(page.locator('#nameModal')).toHaveClass(/open/);
  await page.locator('#nameInput').fill('ヨガ');
  await page.locator('#nameOk').click();

  const saved = await page.evaluate(() => {
    const it = DB.items.find(i => i.id === 'custom1');
    return { name: it && it.name, active: !!it && isItemActiveOn(it, today) };
  });
  expect(saved).toEqual({ name: 'ヨガ', active: true });

  // ホームのミッションにも自分でつけた名前で並ぶ
  await page.locator('#pickDone').click();
  await page.locator('nav.footer button[data-tab="home"]').click();
  await expect(page.locator('#todoRowManual')).toContainText('ヨガ');
});

test('過去日でも今のミッションをチェックでき、その日の記録として残る', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', items: null, onboarded: true,
      days: { '2026-07-01': {}, '2026-07-02': {} },
    }));
  });
  await page.goto('/index.html');

  // 3日前を選ぶ（項目は今日から有効なので、本来その日には並ばない）
  const past = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() - 3);
    sel = fmtDate(d); renderAll();
    return sel;
  });

  await expect(page.locator('#todoRowManual')).toContainText('ストレッチ');
  await page.locator('#todoRowManual .todo-card', { hasText: 'ストレッチ' }).click();

  const after = await page.evaluate((d) => ({
    checked: (DB.days[d] || {}).checked || [],
    activeThen: isItemActiveOn(DB.items.find(i => i.id === 'stretch'), d),
    pt: computed.perDay[d] ? computed.perDay[d].points : 0,
  }), past);
  expect(after.checked).toContain('stretch');
  expect(after.activeThen).toBe(true);   // その日まで有効期間が遡っている
  expect(after.pt).toBe(2);              // 集計にも乗る（活+2）
});

test('保存済みの古い表示名がv1.53の名前に移行される', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', onboarded: true, days: { '2026-07-01': {} },
      items: [
        { id: 'nightfast', name: '夜間空白', short: '夜間空白', inTodo: true, act: 3, inc: 0,
          periods: [{ from: '2026-07-01', until: null }] },
        { id: 'custom1', name: 'ヨガ', short: 'ヨガ', customName: 'ヨガ', custom: true,
          inTodo: true, act: 5, inc: 2, periods: [{ from: '2026-07-01', until: null }] },
      ],
    }));
  });
  await page.goto('/index.html');

  const names = await page.evaluate(() => ({
    nightfast: DB.items.find(i => i.id === 'nightfast').short,
    custom1: DB.items.find(i => i.id === 'custom1').short,
  }));
  expect(names.nightfast).toBe('夜食べない');   // 旧名から移行される
  expect(names.custom1).toBe('ヨガ');           // 自分でつけた名前は守られる
});

test('ホームのカードにⓘは出ず、見出しの「編集」から選択画面を開ける', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  // v1.54: 誤タップの原因だったカード上のⓘは無い
  await expect(page.locator('#todoRowManual .tc-info')).toHaveCount(0);
  await expect(page.locator('#todoRowAuto .tc-info')).toHaveCount(0);

  // 見出し右の「編集」で選択画面が開く
  await page.locator('#btnEditMissions').click();
  await expect(page.locator('#pickModal')).toHaveClass(/open/);

  // 解説は選択画面のⓘから読める
  await expandAllPick(page);
  const row = page.locator('.pick-row', { hasText: 'ストレッチをする' });
  await row.locator('.pick-row-info').click();
  await expect(page.locator('#infoModal')).toHaveClass(/open/);
});

test('達成のセリフは画面の中央に出る', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  // セリフ側の分岐に必ず入るよう、乱数を固定してからチェックする
  await page.evaluate(() => { Math.random = () => 0.1; });
  await page.locator('#todoRowManual .todo-card', { hasText: '糖分' }).click();
  await page.waitForTimeout(1600);

  const box = await page.evaluate(() => {
    const el = document.querySelector('#mitoBubble');
    if (el.hidden) return null;
    const r = el.getBoundingClientRect();
    return { centered: el.classList.contains('centered'),
             midY: Math.round(r.top + r.height / 2), viewportH: window.innerHeight };
  });
  expect(box).not.toBeNull();
  expect(box.centered).toBe(true);
  // 画面のおおむね中央（上下10%以内）に出ている
  expect(Math.abs(box.midY - box.viewportH / 2)).toBeLessThan(box.viewportH * 0.1);
});

test('マイトは数が少ないうちは大きく描かれる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  const sizes = await page.evaluate(() => ({
    one: orbScale(1), ten: orbScale(10), twenty: orbScale(20),
    hundred: orbScale(100), many: orbScale(500),
    // 実際の半径にも効いている
    r10: planOrbs(10)[0], r100: planOrbs(100)[0],
  }));
  expect(sizes.one).toBe(3);          // 10匹以内は3倍
  expect(sizes.ten).toBe(3);
  expect(sizes.hundred).toBe(1);      // 100匹で等倍に戻る
  expect(sizes.many).toBe(1);         // それ以上は等倍のまま
  expect(sizes.r10).toBe(sizes.r100 * 3);
  expect(sizes.twenty).toBe(2.4);     // v1.60: 段ごとに0.2ずつ小さくなる

  // 10段階あり、匹数が増えるほど必ず小さく（同じか小さく）なる
  const steps = await page.evaluate(() => {
    const seen = [];
    for (let n = 1; n <= 120; n++) { const v = orbScale(n); if (seen[seen.length - 1] !== v) seen.push(v); }
    return seen;
  });
  expect(steps).toEqual([3, 2.8, 2.6, 2.4, 2.2, 2, 1.8, 1.6, 1.4, 1.2, 1]);
  const sorted = [...steps].sort((a, b) => b - a);
  expect(steps).toEqual(sorted);      // 逆戻りしない
});
