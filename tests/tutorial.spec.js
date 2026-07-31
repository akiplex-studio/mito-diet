// @ts-check
const { test, expect } = require('@playwright/test');
const { skipOnboarding } = require('./helpers');

// v1.55: 初回チュートリアル。
// 一番大事なのは「からだのプロフィールがここで必ず埋まること」。
// 身長・年齢・性別・体重が欠けると calcTargets が null を返し、
// 必要カロリーもタンパク質の目安も出せないままアプリが使われてしまう。

/** 数値の質問に答えて次へ */
async function answerNum(page, value) {
  await page.locator('#tutBody input[type="number"]').fill(String(value));
  await page.locator('#tutNext').click();
}
/** 選択肢の質問に答える（選ぶと自動で次へ進む） */
/** v1.63: 先頭の言語選択を日本語で通す（端末の言語に左右されないようにする） */
async function chooseJa(page) {
  await page.locator('.tut-choice', { hasText: '日本語' }).click();
}
async function answerChoice(page, label) {
  await page.locator('.tut-choice', { hasText: label }).click();
}

test('初回起動でチュートリアルが出て、答えた内容が保存される', async ({ page }) => {
  await page.goto('/index.html');   // まっさらな状態

  await expect(page.locator('#tutorial')).toBeVisible();
  await chooseJa(page);
  await expect(page.locator('#tutBody')).toContainText('ぼくはマイト');
  await page.locator('#tutNext').click();          // ようこそ → 呼び名
  await page.locator('#tutBody input[type="text"]').fill('ひらい');
  await page.locator('#tutNext').click();
  await page.locator('#tutNext').click();          // 名前を呼ぶあいさつ → 最初の質問

  await answerNum(page, 172);                      // 身長
  await answerNum(page, 45);                       // 年齢
  await answerChoice(page, '男性');                // 性別
  await answerNum(page, 79.7);                     // 今の体重
  await answerNum(page, 68);                       // 目標体重
  await answerChoice(page, 'よく動く');            // 活動量

  // tips 3枚
  await expect(page.locator('#tutImg')).toBeVisible();
  await page.locator('#tutNext').click();
  await page.waitForTimeout(400);
  await page.locator('#tutNext').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#tutNext')).toHaveText('はじめる');
  await page.locator('#tutNext').click();

  // v1.56: 最後にミッションを選ばせない。閉じたらそのままホームで始まる
  await expect(page.locator('#tutorial')).toBeHidden();
  await expect(page.locator('#pickModal')).not.toHaveClass(/open/);
  await expect(page.locator('#todoCard')).toBeVisible();
  expect(await page.evaluate(() => DB.onboarded)).toBe(true);
  // 推奨セットのまま始まる（ウォーキングも既定で入っている）
  const missions = await page.evaluate(() =>
    DB.items.filter(it => isItemActiveOn(it, today) && it.inTodo).map(it => it.id).sort());
  expect(missions).toEqual(['nightfast', 'stretch', 'sugarCtrl', 'walking']);

  const saved = await page.evaluate(() => ({
    profile: DB.profile,
    goal: DB.goalWeight,
    weight: DB.days[today].weight,
    // 入力がそろったので必要カロリーが計算できる
    targets: !!calcTargets(DB.profile, DB.days[today].weight),
  }));
  expect(saved.profile.name).toBe('ひらい');
  expect(saved.profile.heightCm).toBe(172);
  expect(saved.profile.age).toBe(45);
  expect(saved.profile.sex).toBe('male');
  expect(saved.profile.activity).toBe(1.55);
  expect(saved.goal).toBe(68);
  expect(saved.weight).toBe(79.7);
  expect(saved.targets).toBe(true);
});

test('tipsは「次へ」で1枚ずつめくれ、最後だけボタンが変わる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  // 設定から図解だけを開く
  await page.locator('nav.footer button[data-tab="settings"]').click();
  await page.locator('#btnReadTips').click();
  await expect(page.locator('#tutorial')).toBeVisible();

  const src1 = await page.locator('#tutImg').getAttribute('src');
  await expect(page.locator('#tutNext')).toHaveText('次へ');
  await page.locator('#tutNext').click();
  await page.waitForTimeout(400);
  const src2 = await page.locator('#tutImg').getAttribute('src');
  expect(src2).not.toBe(src1);              // 絵が入れ替わっている

  await page.locator('#tutNext').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#tutNext')).toHaveText('とじる');   // 3枚目
  await page.locator('#tutNext').click();
  await expect(page.locator('#tutorial')).toBeHidden();
  // 図解を読んだだけではミッションの確認は出ない
  await expect(page.locator('#pickModal')).not.toHaveClass(/open/);
});

test('ブラウザ版では連携の画面を出さない', async ({ page }) => {
  await page.goto('/index.html');
  await chooseJa(page);
  await page.locator('#tutNext').click();   // ようこそ → 呼び名
  await page.locator('#tutBody input[type="text"]').fill('ひらい');
  await page.locator('#tutNext').click();
  await page.locator('#tutNext').click();   // あいさつ → 次

  // ネイティブ専用なので、連携を飛ばして身長の質問になる
  await expect(page.locator('#tutBody')).toContainText('身長');
  await expect(page.locator('#tutBody')).not.toContainText('ヘルスデータ');
});

test('途中でやめたら、次に開いたときまた出る', async ({ page }) => {
  await page.goto('/index.html');
  await chooseJa(page);
  await page.locator('#tutNext').click();
  await page.locator('#tutBody input[type="text"]').fill('ひらい');
  await page.locator('#tutNext').click();
  await page.locator('#tutNext').click();
  await answerNum(page, 170);

  // 質問の途中でリロード（＝アプリを閉じた）
  await page.reload();
  await expect(page.locator('#tutorial')).toBeVisible();
  const done = await page.evaluate(() => DB.onboarded);
  expect(done).toBe(false);
  // 中途半端な入力は保存していない
  expect(await page.evaluate(() => DB.profile.heightCm)).toBe(null);
});

test('既存ユーザーにはチュートリアルが出ない', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mito-data', JSON.stringify({
      version: 5, startDate: '2026-07-01', items: null,
      days: { '2026-07-01': { checked: ['juice'] } },
    }));
  });
  await page.goto('/index.html');
  await expect(page.locator('#tutorial')).toBeHidden();
});

test('最初に呼び名を聞き、次のセリフでその名前を呼ぶ', async ({ page }) => {
  await page.goto('/index.html');
  await chooseJa(page);
  await page.locator('#tutNext').click();          // ようこそ → 呼び名

  await expect(page.locator('#tutBody')).toContainText('なんて呼べばいい');
  await page.locator('#tutBody input[type="text"]').fill('ひらい');
  await page.locator('#tutNext').click();

  // 次の画面で実際に名前を呼んでから話が続く
  await expect(page.locator('#tutBody')).toContainText('ひらいだね。よろしく');
  await expect(page.locator('#tutBody')).toContainText('ひらいがミッションをこなすたびに');

  await page.locator('#tutNext').click();
  await expect(page.locator('#tutBody')).toContainText('身長');   // 以降の質問へ続く

  expect(await page.evaluate(() => DB.profile.name)).toBe(null);  // 最後まで進むまで保存しない
});

test('図解は端末の言語で日本語版と英語版が切り替わる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');

  const r = await page.evaluate(() => {
    const ja = TIPS_IMGS_JA, en = TIPS_IMGS_EN;
    const pick = (lang) => { DB.lang = lang; const v = tipsImgs(); delete DB.lang; return v; };
    return {
      jaCount: ja.length, enCount: en.length,
      別物: ja.every((s, i) => s !== en[i]),
      ja選択: pick('ja') === ja,
      en選択: pick('en') === en,
    };
  });
  expect(r.jaCount).toBe(3);
  expect(r.enCount).toBe(3);   // 2枚目の英語版もそろっている
  expect(r.別物).toBe(true);
  expect(r.ja選択).toBe(true);
  expect(r.en選択).toBe(true);
});

/* --- v1.63: i18n（Step 1: 骨組みとUIラベル） --- */

test('最初に言語を選ぶ画面が出て、選ぶとその場で切り替わる', async ({ page }) => {
  await page.goto('/index.html');

  await expect(page.locator('#tutBody')).toContainText('Choose language');
  await page.locator('.tut-choice', { hasText: 'English' }).click();

  expect(await page.evaluate(() => DB.lang)).toBe('en');
  // 次の画面（ようこそ）に進み、下のボタンが英語になっている
  await expect(page.locator('#tutNext')).toHaveText('Start');
  await expect(page.locator('#tutSkip')).toHaveText('Skip');
  await expect(page.locator('#tutBack')).toHaveText('Back');
});

test('英語にするとホームと設定のラベルが英語になる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('en'));

  await expect(page.locator('#todoCard h2')).toContainText('Daily missions');
  await expect(page.locator('#btnEditMissions')).toContainText('Edit');
  await expect(page.locator('.todo-row-label')).toHaveText('Tracked for you');
  await expect(page.locator('nav.footer button[data-tab="home"]')).toContainText('Home');

  await page.locator('nav.footer button[data-tab="settings"]').click();
  await expect(page.locator('#btnPickItems')).toHaveText('Choose your missions');
  await expect(page.locator('#btnSaveClose')).toHaveText('Save and close');

  // 日本語に戻すと元どおり
  await page.evaluate(() => setLang('ja'));
  await expect(page.locator('#btnPickItems')).toHaveText('デイリーミッションを選ぶ');
});

test('英語では日付と曜日も英語になる', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => setLang('en'));

  await expect(page.locator('#hdrDate')).toContainText(/January|February|March|April|May|June|July|August|September|October|November|December/);
  await expect(page.locator('.cal-dow').first()).toHaveText('Mon');
});
