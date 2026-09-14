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

// v1.72: 研究メモをお酒・糖分・入浴・瞑想・睡眠・運動（HIIT含む）にも追加。
// 研究メモの無い項目（bodyweight・gymtrain・lightex）では、説明シートに研究メモが出ないことを確認する。
for (const id of ['bodyweight', 'gymtrain', 'lightex']) {
  test(`研究メモの無い項目（${id}）では、説明シートに研究メモが出ない`, async ({ page }) => {
    await skipOnboarding(page);
    await page.goto('/index.html');
    await page.evaluate((itemId) => {
      // @ts-ignore
      openInfo(catalogById(itemId));
    }, id);
    await expect(page.locator('#infoModal')).toHaveClass(/open/);
    await expect(page.locator('#infoBody .info-note')).toHaveCount(0);
    const bodyText = await page.locator('#infoBody').textContent();
    expect(bodyText).not.toContain('研究メモ');
  });
}

// v1.72: 新しく追加した研究メモ（お酒・睡眠・運動・HIIT・歩数など）が、なぜ効くかの下・実践のコツの上に出る。
// 代表として nosake・sleeplack・walking・hiit を ja/en 両方で確認する。
const NEW_NOTE_IDS = {
  nosake: {
    ja: '長年たくさん飲んできた人の筋肉でも、ミトコンドリアの働きに差は見られませんでした',
    en: 'a study of long-term heavy drinkers found no difference in how their muscle mitochondria worked',
  },
  sleeplack: {
    ja: '若い健康な男性が寝る時間を4時間にして5夜過ごすと、ミトコンドリアの量は変わらないまま、働きが2割近く落ちました',
    en: 'their mitochondria worked nearly 20% less while the amount stayed the same',
  },
  walking: {
    ja: '353の研究（計5,973人）をまとめた2025年の分析では、筋肉のミトコンドリアの量が平均で約2〜3割増えていました',
    en: 'A 2025 analysis of 353 studies (5,973 people) found muscle mitochondrial content rose by about 23–27% on average',
  },
  hiit: {
    ja: 'かけた時間あたりでは短く強いインターバルのほうが効率よく増えていました',
    en: 'per hour spent, short hard intervals were more efficient',
  },
};

for (const [id, expected] of Object.entries(NEW_NOTE_IDS)) {
  test(`${id}(ja)の説明シートに研究メモが出る`, async ({ page }) => {
    await skipOnboarding(page);
    await page.goto('/index.html');
    await page.evaluate((itemId) => {
      // @ts-ignore
      openInfo(catalogById(itemId));
    }, id);
    const pos = await labelOrder(page);
    expect(pos.why).toBeGreaterThan(-1);
    expect(pos.note).toBeGreaterThan(pos.why);
    expect(pos.tips).toBeGreaterThan(pos.note);
    await expect(page.locator('#infoBody .info-note')).toContainText(expected.ja);
  });

  test(`${id}(en)の説明シートに研究メモが出る`, async ({ page }) => {
    await skipOnboarding(page);
    await page.goto('/index.html');
    await page.evaluate((itemId) => {
      // @ts-ignore
      setLang('en');
      // @ts-ignore
      openInfo(catalogById(itemId));
    }, id);
    const pos = await labelOrder(page);
    expect(pos.why_en).toBeGreaterThan(-1);
    expect(pos.note_en).toBeGreaterThan(pos.why_en);
    expect(pos.tips_en).toBeGreaterThan(pos.note_en);
    await expect(page.locator('#infoBody .info-note')).toContainText(expected.en);
  });
}

// v1.72: 研究メモの文字サイズは本文（なぜ効くか／実践のコツ）と同じにする（老眼配慮で小さくしすぎない）。
test('研究メモの文字サイズは、なぜ効くかの本文と同じ', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => {
    // @ts-ignore
    openInfo(catalogById('nosake'));
  });
  const noteSize = await page.locator('#infoBody .info-note p').evaluate(
    (el) => getComputedStyle(el).fontSize
  );
  const whySize = await page.locator('#infoBody .info-block p').first().evaluate(
    (el) => getComputedStyle(el).fontSize
  );
  expect(noteSize).toBe(whySize);
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

// v1.72翻訳投入の回帰テスト: 修正前（I18N.zhにこのキーが無い）はここが必ず英語へフォールバックし
// "Research note" になって落ちる。翻訳投入後は中国語の訳文になる。
test('zh表示では、腹七分目の研究メモが中国語の訳文で出る（英語へフォールバックしない）', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/index.html');
  await page.evaluate(() => {
    // @ts-ignore
    setLang('zh');
    openInfo(catalogById('hara7'));
  });
  const note = page.locator('#infoBody .info-note');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText('研究附注');
  await expect(note).toContainText('饥饿会促进线粒体自噬');
  const bodyText = await page.locator('#infoBody').textContent();
  expect(bodyText).not.toContain('Research note');
  expect(bodyText).not.toMatch(/[ぁ-んァ-ヴ]/);
});

// v1.72: zh/ms でも研究メモがその言語で出る（腹七分目・睡眠の2項目を代表として確認）。
// 修正前（I18N.zh/I18N.ms にこれらのキーが無い）は英語へフォールバックし "Research note" になって落ちる。
const ZH_MS_NOTE_CHECK = {
  hara7: {
    zh: '饥饿会促进线粒体自噬',
    ms: 'Mitofagi yang dipercepat oleh rasa lapar',
  },
  sleeplack: {
    zh: '这一点已在人体肌肉中直接测量过',
    ms: 'Ini telah diukur secara langsung pada otot manusia',
  },
};
const NOTE_LABEL_BY_LANG = { zh: '研究附注', ms: 'Nota kajian' };

for (const [id, byLang] of Object.entries(ZH_MS_NOTE_CHECK)) {
  for (const [lang, expectedNote] of Object.entries(byLang)) {
    test(`${id}(${lang})の説明シートに研究メモがその言語で出る（"Research note"は出ない）`, async ({ page }) => {
      await skipOnboarding(page);
      await page.goto('/index.html');
      await page.evaluate(({ itemId, l }) => {
        // @ts-ignore
        setLang(l);
        // @ts-ignore
        openInfo(catalogById(itemId));
      }, { itemId: id, l: lang });
      await expect(page.locator('#infoModal')).toHaveClass(/open/);
      const note = page.locator('#infoBody .info-note');
      await expect(note).toHaveCount(1);
      await expect(note.locator('.lbl')).toContainText(NOTE_LABEL_BY_LANG[lang]);
      await expect(note).toContainText(expectedNote);
      const bodyText = await page.locator('#infoBody').textContent();
      expect(bodyText).not.toContain('Research note');
    });
  }
}
