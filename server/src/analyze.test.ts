import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnalyzeRequestParams, type AnalyzeInput } from "./analyze.js";
import type Anthropic from "@anthropic-ai/sdk";

/*
 * v1.7x 言語対応の回帰テスト。
 *
 * 下の ORIGINAL_SYSTEM_PROMPT / ORIGINAL_MEAL_SCHEMA / ORIGINAL_PARTS_* は、
 * 「言語対応より前」の analyze.ts（SYSTEM_PROMPT / MEAL_SCHEMA 定数、およびanalyzeMeal内の
 * parts組み立てロジック）から一字一句コピーした固定値である。
 * 変更後のコード（buildAnalyzeRequestParams）から逆算した値と比べてしまうと同義反復になり
 * 「変更前と同じ」を保証できないため、必ずこの固定値と比較すること。
 */

const ORIGINAL_SYSTEM_PROMPT = `あなたは「ミトコンドリア・ダイエット」アプリの栄養解析アシスタントです。
ユーザーの食事（写真・テキスト説明・またはその両方）を解析し、指定されたJSONスキーマに従って結果だけを返します。

## 解析の方針
- 写真がある場合は写真から料理を特定し、一般的な1人前の量を基準に栄養素を推定する（断定できないものは confidence を下げる）
- テキスト説明のみの場合は、料理名・店名（チェーン店のメニュー等）の一般的な栄養データに基づいて推定する。
  盛り（大盛り・特盛など）やサイドメニューの記述は量に反映する
- ユーザー申告の「満腹度」が添えられた場合は、量（総カロリー）の推定に反映する
  （例:「食べ過ぎ」なら多め、「軽め」なら少なめに補正。写真の見た目と矛盾する場合は満腹度を優先）
- 写真とテキスト説明の両方がある場合、テキストは補足情報である。料理の特定は写真から行い、テキストは量（大盛り等）・写真に写っていない品・追加情報の反映に使う。テキストだけで料理を特定できなくても、写真から必ず特定を試みること
- 数値はすべて概算でよい。日本の家庭料理・外食の一般的な栄養データを基準にする
- 食事と判断できる情報が無い場合は dishes を空配列にし、advice でその旨をやさしく伝える

## mito_score（ミトコンドリアに良い食事か、0〜100）の基準
- 加点: 野菜・色の濃い食材（抗酸化物質）／魚・肉・卵・大豆などのタンパク質／適量（腹七分目）／発酵食品
- 減点: 砂糖の多い飲料・菓子／揚げ物や脂質過多／明らかな食べ過ぎ／野菜がほぼ無い
- 50を普通の食事とし、良い要素で加点・悪い要素で減点する

## ミトコンドリア観点の知識（この範囲で褒める・指摘する）

### 最重要の大前提（絶対に破らない）
- ミトコンドリアの「数」を増やせるのは運動だけ。**食事の役割は「質を整える・守る・支える」**。
- したがって「この食材でミトコンドリアが増える／数が増える」とは絶対に書かない。
  正しい言い回し:「酸化ストレス（サビ）から守る」「発電所や筋肉の材料になる」「働きを支える」「質を保つ」。
- レスベラトロール（ブドウ皮・ベリー）・PQQ（パセリ・ピーマン）・断食は「数を増やす」とは書かない。
  レスベラトロールは「有望」トーンに留め断言しない。

### 褒める切り口（good_points はミトコンドリア観点で結ぶ）
- 良質なタンパク質（肉・魚・卵・大豆・乳製品）＝ミトコンドリアと、発電所が多く宿る筋肉の材料になる
- 青魚の脂・オメガ3（サバ・イワシ・サーモン・アジ）＝良質な脂として働きを支える
- 色の濃い野菜（緑黄色野菜・βカロテン・ビタミンC・ポリフェノール）＝抗酸化成分がサビから守る
- 良い脂（オリーブオイル・アボカド・素焼きナッツ・くるみ）＝細胞膜の材料として支える
- 発酵食品（納豆・味噌・ヨーグルト・キムチ）＝腸内環境を整え、体全体を通じて支える
- 未精製の炭水化物（玄米・雑穀・いも・豆・果物）＝体を動かす燃料。食物繊維で血糖の波を穏やかに
- ※「タンパク質が豊富」で止めず「発電所と筋肉の材料になる」まで結ぶこと

### やさしく指摘したいもの（caution。あれば1つだけ・無ければ空文字）
- 砂糖・甘い飲料＝最も控える価値が高い。血糖の波が代謝の柔軟性を落としやすい、と穏やかに
- 超加工食品＝エネルギーは高いがミトコンドリアを支える栄養が乏しい
- 揚げ物・脂質過多＝量が多いと負担。次は蒸す・焼くも、と提案の形で
- 明らかな食べ過ぎ＝「腹七分目」を穏やかに。責めない
- 主食（大盛りご飯・麺のみ）＝量より「おかず（タンパク質・野菜）と一緒に」を勧める
- お酒＝分解時のアセトアルデヒドや睡眠の質に軽く触れ、休肝日を穏やかに

## トーンの方針
- 順序は「まず褒める → 次に一つ提案」。いきなり指摘・命令をしない
- good_points（褒め）は0〜3個・ミトコンドリア観点で。advice（1〜2文）は次に活かせる前向きな提案
- caution は悪い点のやさしい指摘を1つだけ。無理にひねり出さず、良い食事なら空文字にする。責めない・全否定しない
- 良いものが無い食事は、責めずに「次に足すと良い一品」を advice で提案する
- 「増やす」と書かない（食事は守る・支える・材料・整える）
- 医療的な断定はしない。数値はあくまで目安であることを前提とした書きぶりにする`;

const ORIGINAL_MEAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dishes", "nutrition", "mito_score", "good_points", "advice", "caution", "confidence"],
  properties: {
    dishes: {
      type: "array",
      description: "写真に写っている料理のリスト",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "amount"],
        properties: {
          name: { type: "string", description: "料理名（日本語）" },
          amount: { type: "string", description: "推定量（例: 1杯、約150g）" },
        },
      },
    },
    nutrition: {
      type: "object",
      additionalProperties: false,
      required: ["calories_kcal", "protein_g", "fat_g", "carbs_g"],
      properties: {
        calories_kcal: { type: "integer", description: "推定カロリー（kcal）" },
        protein_g: { type: "integer", description: "推定タンパク質（g）" },
        fat_g: { type: "integer", description: "推定脂質（g）" },
        carbs_g: { type: "integer", description: "推定炭水化物（g）" },
      },
    },
    mito_score: { type: "integer", description: "ミトコンドリアに良い食事度 0〜100（50が普通）" },
    good_points: { type: "array", items: { type: "string" }, description: "この食事の良い点（0〜3個・日本語）" },
    advice: { type: "string", description: "次に活かせるひとことアドバイス（1〜2文・日本語・前向きに。良いものが無ければ次に足すと良い一品を提案）" },
    caution: { type: "string", description: "ミトコンドリア観点でやさしく指摘したい点を1つだけ（日本語・責めない）。指摘が無ければ空文字にする" },
    confidence: { type: "string", enum: ["low", "medium", "high"], description: "推定の確信度" },
  },
};

/** 変更前のanalyzeMeal内にあったparts組み立てロジックを、そのまま関数化したもの（比較の基準用） */
function originalParts(imageCount: number, text?: string, fullness?: string): string[] {
  const parts: string[] = [];
  if (imageCount > 1) {
    parts.push(`写真は${imageCount}枚ありますが、すべて同じ1回の食事を写したものです。重複して数えず、全体で1つの食事として解析してください。`);
  }
  if (text) parts.push(imageCount ? `ユーザーによる補足（写真の食事に関する追加情報）：「${text}」` : `ユーザーによる食事の説明：「${text}」`);
  if (fullness) parts.push(`ユーザー申告の満腹度：「${fullness}」（量の推定に反映してください）`);
  parts.push(imageCount ? "この食事を解析してください。" : "この食事内容を解析してください。");
  return parts;
}

/** テスト用のダミー画像content block（sharpによる実際のリサイズは経由しない） */
function dummyImageBlock(tag: string): Anthropic.ContentBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: `dummy-${tag}` } };
}

function systemText(params: Anthropic.MessageCreateParamsNonStreaming): string {
  const sys = params.system;
  assert.ok(Array.isArray(sys), "systemは配列のはず");
  const block = (sys as Anthropic.TextBlockParam[])[0];
  assert.equal(block.type, "text");
  return block.text;
}

function schemaOf(params: Anthropic.MessageCreateParamsNonStreaming): unknown {
  const format = (params.output_config as { format?: { schema?: unknown } } | undefined)?.format;
  return format?.schema;
}

function userText(params: Anthropic.MessageCreateParamsNonStreaming): string {
  const content = params.messages[0].content;
  assert.ok(Array.isArray(content));
  const textBlock = (content as Anthropic.ContentBlockParam[]).find((b) => b.type === "text") as
    | Anthropic.TextBlockParam
    | undefined;
  assert.ok(textBlock, "テキストブロックが無い");
  return textBlock!.text;
}

/** スキーマのdescriptionだけを取り除いた構造を返す（言語間で構造が一致するかの比較用） */
function stripDescriptions(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripDescriptions);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "description") continue;
      out[k] = stripDescriptions(val);
    }
    return out;
  }
  return v;
}

/* --- ① lang未指定・'ja'・不正値: 変更前と完全一致 --- */

test("lang未指定: systemプロンプトが変更前のSYSTEM_PROMPTと完全一致", () => {
  const input: AnalyzeInput = { images: [], text: "test" };
  const params = buildAnalyzeRequestParams(input, []);
  assert.equal(systemText(params), ORIGINAL_SYSTEM_PROMPT);
});

test("lang='ja': systemプロンプトが変更前のSYSTEM_PROMPTと完全一致", () => {
  const input: AnalyzeInput = { images: [], text: "test", lang: "ja" };
  const params = buildAnalyzeRequestParams(input, []);
  assert.equal(systemText(params), ORIGINAL_SYSTEM_PROMPT);
});

test("lang不正値('fr'等): 変更前のSYSTEM_PROMPTと完全一致（jaとして扱われる）", () => {
  // AnalyzeInput.langの型上は'ja'|'en'だが、index.tsから渡る前提を含めて実行時の不正値耐性も確認する
  const input = { images: [], text: "test", lang: "fr" } as unknown as AnalyzeInput;
  const params = buildAnalyzeRequestParams(input, []);
  assert.equal(systemText(params), ORIGINAL_SYSTEM_PROMPT);
});

test("lang未指定・ja・不正値: MEAL_SCHEMAが変更前と完全一致（deep equal）", () => {
  for (const lang of [undefined, "ja", "fr"] as const) {
    const input = { images: [], text: "test", ...(lang !== undefined ? { lang } : {}) } as unknown as AnalyzeInput;
    const params = buildAnalyzeRequestParams(input, []);
    assert.deepStrictEqual(schemaOf(params), ORIGINAL_MEAL_SCHEMA, `lang=${String(lang)}`);
  }
});

test("lang未指定・ja・不正値: ユーザー向けテキストが変更前のロジックと完全一致（画像0枚・text・fullness無し）", () => {
  for (const lang of [undefined, "ja", "fr"] as const) {
    const input = { text: undefined, ...(lang !== undefined ? { lang } : {}) } as unknown as AnalyzeInput;
    const params = buildAnalyzeRequestParams(input, []);
    assert.equal(userText(params), originalParts(0).join("\n"));
  }
});

test("lang未指定・ja: 画像2枚+text+fullnessの組み合わせでも変更前のロジックと完全一致", () => {
  const text = "すき家でご飯大盛りの牛丼と肉皿";
  const fullness = "腹七分目くらい";
  for (const lang of [undefined, "ja"] as const) {
    const input = { text, fullness, ...(lang !== undefined ? { lang } : {}) } as unknown as AnalyzeInput;
    const params = buildAnalyzeRequestParams(input, [dummyImageBlock("a"), dummyImageBlock("b")]);
    assert.equal(userText(params), originalParts(2, text, fullness).join("\n"));
  }
});

test("lang未指定: リクエストパラメータ全体（model/max_tokens/system/output_config/messages）が変更前と同一構造", () => {
  const input: AnalyzeInput = { text: "カレーライス" };
  const params = buildAnalyzeRequestParams(input, []);
  assert.equal(params.model, "claude-haiku-4-5-20251001");
  assert.equal(params.max_tokens, 1500);
  const sys = params.system as Anthropic.TextBlockParam[];
  assert.deepStrictEqual(sys[0].cache_control, { type: "ephemeral" });
  const format = (params.output_config as { format?: { type?: string } } | undefined)?.format;
  assert.equal(format?.type, "json_schema");
});

/* --- ② lang='en': 英語指示・スキーマに「日本語」を含まない --- */

test("lang='en': systemに英語出力の指示が追加される", () => {
  const input: AnalyzeInput = { text: "curry rice", lang: "en" };
  const params = buildAnalyzeRequestParams(input, []);
  const text = systemText(params);
  assert.ok(text.startsWith(ORIGINAL_SYSTEM_PROMPT), "日本語の方針本文はそのまま先頭に維持されるはず");
  assert.match(text, /English/i);
  assert.match(text, /Do not output any Japanese text/i);
});

test("lang='en': スキーマのdescriptionに「日本語」という文字列が含まれない", () => {
  const input: AnalyzeInput = { text: "curry rice", lang: "en" };
  const params = buildAnalyzeRequestParams(input, []);
  const json = JSON.stringify(schemaOf(params));
  assert.ok(!json.includes("日本語"), `英語スキーマに「日本語」の文字列が残っている: ${json}`);
});

test("lang='en': スキーマの構造（キー・required・enum）はja版と同一で、descriptionだけが違う", () => {
  const jaParams = buildAnalyzeRequestParams({ text: "test", lang: "ja" }, []);
  const enParams = buildAnalyzeRequestParams({ text: "test", lang: "en" }, []);
  assert.deepStrictEqual(stripDescriptions(schemaOf(enParams)), stripDescriptions(schemaOf(jaParams)));
});

/* --- ③ 画像複数枚・text・fullnessの組み合わせで英語の指示文になる --- */

test("lang='en': 画像2枚+text+fullnessの組み合わせで英語の指示文になる", () => {
  const text = "large gyudon and extra meat";
  const fullness = "pretty full";
  const input: AnalyzeInput = { text, fullness, lang: "en" };
  const params = buildAnalyzeRequestParams(input, [dummyImageBlock("a"), dummyImageBlock("b")]);
  const text2 = userText(params);
  assert.match(text2, /2 photos/);
  assert.match(text2, /same single meal/);
  assert.match(text2, /User's note/);
  assert.match(text2, /User-reported fullness/);
  assert.match(text2, /Please analyze this meal\./);
  assert.ok(text2.includes(text));
  assert.ok(text2.includes(fullness));
  // 日本語の定型文字列が混ざっていないこと
  assert.ok(!text2.includes("写真は"));
  assert.ok(!text2.includes("ユーザー"));
});

test("lang='en': 画像0枚+textのみの組み合わせでも英語の指示文になる", () => {
  const text = "a bowl of ramen";
  const input: AnalyzeInput = { text, lang: "en" };
  const params = buildAnalyzeRequestParams(input, []);
  const text2 = userText(params);
  assert.match(text2, /User's description of the meal/);
  assert.match(text2, /Please analyze this meal description\./);
  assert.ok(!text2.includes("この食事内容を解析してください"));
});

/* --- ms/zh 追加対応（'ko'は平井さんの決定で非対応・不正値扱い） --- */

/** ms/zh の①system②schema③不正値耐性③'ko'を共通化したテストを生成する */
function describeNonJaLang(
  lang: "ms" | "zh",
  langNameRegex: RegExp,
  writeInstructionRegex: RegExp
) {
  test(`lang='${lang}': systemに正しい言語名の出力指示が追加される`, () => {
    const input: AnalyzeInput = { text: "curry rice", lang };
    const params = buildAnalyzeRequestParams(input, []);
    const text = systemText(params);
    assert.ok(text.startsWith(ORIGINAL_SYSTEM_PROMPT), "日本語の方針本文はそのまま先頭に維持されるはず");
    assert.match(text, langNameRegex, `${lang}の言語名の指示が見当たらない: ${text}`);
    assert.match(text, /Do not output any Japanese text/i);
    // 「数を増やすとは書かない」最重要ルールの英語再掲がja以外すべてに入っていること
    assert.match(text, /Non-negotiable core rule, restated in English/);
    assert.match(text, /NEVER write that a food "increases mitochondria"/);
  });

  test(`lang='${lang}': スキーマのdescriptionに「日本語」という文字列が含まれない`, () => {
    const input: AnalyzeInput = { text: "curry rice", lang };
    const params = buildAnalyzeRequestParams(input, []);
    const json = JSON.stringify(schemaOf(params));
    assert.ok(!json.includes("日本語"), `${lang}のスキーマに「日本語」の文字列が残っている: ${json}`);
  });

  test(`lang='${lang}': スキーマの構造（キー・required・enum）はja版と同一で、descriptionだけが違う`, () => {
    const jaParams = buildAnalyzeRequestParams({ text: "test", lang: "ja" }, []);
    const langParams = buildAnalyzeRequestParams({ text: "test", lang }, []);
    assert.deepStrictEqual(stripDescriptions(schemaOf(langParams)), stripDescriptions(schemaOf(jaParams)));
  });

  test(`lang='${lang}': 画像2枚+text+fullnessの組み合わせで「出力は${lang}で」の指示文が英語で入る`, () => {
    const text = `sample text for ${lang}`;
    const fullness = "pretty full";
    const input: AnalyzeInput = { text, fullness, lang };
    const params = buildAnalyzeRequestParams(input, [dummyImageBlock("a"), dummyImageBlock("b")]);
    const text2 = userText(params);
    assert.match(text2, /2 photos/);
    assert.match(text2, /same single meal/);
    assert.match(text2, /User's note/);
    assert.match(text2, /User-reported fullness/);
    assert.match(text2, writeInstructionRegex, `${lang}向けの「出力は◯◯語で」の指示文が見当たらない: ${text2}`);
    assert.match(text2, /Please analyze this meal\./);
    assert.ok(text2.includes(text));
    assert.ok(text2.includes(fullness));
    assert.ok(!text2.includes("写真は"));
    assert.ok(!text2.includes("ユーザー"));
  });
}

describeNonJaLang("ms", /Bahasa Melayu/i, /Write the output in Bahasa Melayu/i);
describeNonJaLang("zh", /Simplified Chinese|简体中文/i, /Write the output in Simplified Chinese/i);

test("lang='ms': マレー語はインドネシア語にしないという注意書きが入る", () => {
  const params = buildAnalyzeRequestParams({ text: "test", lang: "ms" }, []);
  assert.match(systemText(params), /not (write )?Indonesian/i);
});

test("lang='zh': 繁体字を使わない（簡体字限定）という注意書きが入る", () => {
  const params = buildAnalyzeRequestParams({ text: "test", lang: "zh" }, []);
  assert.match(systemText(params), /not use Traditional Chinese/i);
});

/* --- 不正値の網羅: 'ko'（平井さんの決定で非対応）・'zh-TW'・大文字違い・未知の言語コードはすべてjaと同一 --- */

const INVALID_LANG_VALUES = ["ko", "KO", "zh-TW", "fr", "EN", "MS", "ZH", "", "japanese", null, 123, {}] as const;

test("不正値（'ko'含む）はすべてlang='ja'と完全に同一の結果になる", () => {
  const baseline = buildAnalyzeRequestParams({ text: "test", lang: "ja" }, []);
  for (const invalid of INVALID_LANG_VALUES) {
    const input = { text: "test", lang: invalid } as unknown as AnalyzeInput;
    const params = buildAnalyzeRequestParams(input, []);
    assert.equal(systemText(params), systemText(baseline), `lang=${JSON.stringify(invalid)} のsystemがjaと不一致`);
    assert.deepStrictEqual(schemaOf(params), schemaOf(baseline), `lang=${JSON.stringify(invalid)} のschemaがjaと不一致`);
    assert.equal(userText(params), userText(baseline), `lang=${JSON.stringify(invalid)} のuserTextがjaと不一致`);
  }
});

test("'ko'単体: systemプロンプトが変更前のORIGINAL_SYSTEM_PROMPTと完全一致（jaとして扱われる）", () => {
  const input = { text: "test", lang: "ko" } as unknown as AnalyzeInput;
  const params = buildAnalyzeRequestParams(input, []);
  assert.equal(systemText(params), ORIGINAL_SYSTEM_PROMPT);
});
