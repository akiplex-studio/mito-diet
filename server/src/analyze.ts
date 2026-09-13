import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

// 依頼書指定: モデルは claude-haiku-4-5-20251001 固定
const MODEL = "claude-haiku-4-5-20251001";
const MAX_EDGE = 1024; // サーバー側で長辺1024pxに縮小してから送る（コスト・通信量削減）

export class BadImageError extends Error {}

export interface MealAnalysis {
  dishes: { name: string; amount: string }[];
  nutrition: {
    calories_kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  };
  mito_score: number;
  good_points: string[];
  advice: string;
  caution: string;
  confidence: "low" | "medium" | "high";
}

export type Lang = "ja" | "en" | "ms" | "zh"; // zhはアプリが簡体字専用として送る想定（繁体字は非対応）。koは平井さんの決定で非対応（不正値としてjaに落ちる）

// アプリ（ミトコンドリア・ダイエット）の思想に沿った採点基準をシステムプロンプトに持たせる。
// 注意: Haiku 4.5 のキャッシュ可能プレフィックス下限は4096トークンのため、
// このサイズではキャッシュは実質作動しない（マーカーは依頼書指定どおり付与。将来拡張時に自動で効く）
//
// v1.7x: 言語対応（ja/en/ms/zh）。採点基準・ミトコンドリア知識・トーンの方針は日本語のまま維持し
// （lang問わず不変）、lang!=='ja' のときだけ末尾に「出力は◯◯語で」という指示ブロックを追加する方式にした。
// 理由: 知識部分を訳し直すと、微妙な言い回し（特に「数を増やす」と書いてはいけない、という
// 絶対ルールの言い回し）が翻訳の過程でズレて意味が変わるリスクがある。原文（日本語）を単一の正として
// 常に送り、モデルには「内容はこの日本語の方針に従い、出力の文字列だけ指定言語で書け」と指示するほうが、
// 方針とルールを5言語間で多重管理せずに済み、ズレが起きない。
// ただし「数を増やすと書かない」という最重要ルールだけは、指示ブロック内（英語で記述）にも要約を重ねて
// 明記し、ja以外のどの出力言語でも破られないよう二重の安全策にしてある。
const SYSTEM_PROMPT_JA = `あなたは「ミトコンドリア・ダイエット」アプリの栄養解析アシスタントです。
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

/** lang!=='ja' のときにモデルへ伝える出力言語名（指示ブロック自体は英語で書くため、英語の説明文で表す） */
const LANG_LABEL: Record<Exclude<Lang, "ja">, string> = {
  en: "English",
  ms: "Bahasa Melayu (natural, everyday Malaysian Malay — do not write Indonesian Malay)",
  zh: "Simplified Chinese (简体中文) — do not use Traditional Chinese characters",
};

/** 料理名の自然な書き方の例（味噌汁）。指示文中で「この言語ならこう書く」の実例として示す */
const DISH_NAME_EXAMPLE: Record<Exclude<Lang, "ja">, string> = {
  en: '"Miso soup"',
  ms: '"Sup miso"',
  zh: '"味噌汤"',
};

/** lang!=='ja' のときに日本語版システムプロンプトの末尾へ追加する指示ブロックを組み立てる。指示ブロック自体は英語で書く（モデルへの指示のため） */
function buildSystemPromptSuffix(lang: Exclude<Lang, "ja">): string {
  const label = LANG_LABEL[lang];
  const example = DISH_NAME_EXAMPLE[lang];
  return `

## Output language (${label})
Everything above this section is written in Japanese, but it is still the policy you must follow in full —
the scoring criteria, the mitochondria-related knowledge, and the tone policy all apply exactly as written.
The only difference for this request: write every string value in the JSON output (dish names, amounts,
good_points, advice, caution) in natural, native-level ${label}. Do not output any Japanese text.
For dish names, use the name a native speaker of that language would recognize as natural
(for example, miso soup would be written as ${example}). If a dish has no natural equivalent in that
language, you may keep the original word alongside a romanized/transliterated form.
Express amounts in a way that reads naturally in that language (e.g. "about 200 g", "1 bowl", "1 serving").
Keep using grams and kcal for units (do not convert to imperial or other unit systems).

### Non-negotiable core rule, restated in English (do not violate this in the ${label} output either)
- Only exercise can increase the "number" of mitochondria. Food's role is only to protect, support, and
  help maintain their quality.
- Therefore NEVER write that a food "increases mitochondria" or "increases their number".
  Use phrasing such as: "protects them from oxidative stress", "provides material for the body's power
  plants / muscles", "supports their function", "helps maintain quality".
- Do not claim that resveratrol, PQQ, or fasting "increase" mitochondria. Describe resveratrol as
  "promising", not as a settled fact.`;
}

/** システムプロンプトを言語に合わせて組み立てる。lang==='ja'（未指定含む）は変更前のSYSTEM_PROMPTと完全に同一の文字列を返す */
function buildSystemPrompt(lang: Lang): string {
  return lang === "ja" ? SYSTEM_PROMPT_JA : SYSTEM_PROMPT_JA + buildSystemPromptSuffix(lang);
}

// 構造化出力スキーマ（Haiku 4.5 は structured outputs 対応）
// lang==='ja'（未指定含む）は変更前のMEAL_SCHEMAと完全に同一の内容を返す。
// lang!=='ja'（en/ms/zh すべて）はdescriptionを英語にする（依頼書指定: 「スキーマのdescriptionは英語」。
// 出力言語そのものの指定はsystemプロンプト側の指示ブロックが担うため、ここでは"in English"等の
// 出力言語を名指しする語は使わない＝en/ms/zhで完全に共通のdescriptionになる）
function buildMealSchema(lang: Lang) {
  const isJa = lang === "ja";
  return {
    type: "object",
    additionalProperties: false,
    required: ["dishes", "nutrition", "mito_score", "good_points", "advice", "caution", "confidence"],
    properties: {
      dishes: {
        type: "array",
        description: isJa ? "写真に写っている料理のリスト" : "List of dishes visible in the photo",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "amount"],
          properties: {
            name: {
              type: "string",
              description: isJa ? "料理名（日本語）" : "Dish name (in the output language specified in the system prompt)",
            },
            amount: {
              type: "string",
              description: isJa ? "推定量（例: 1杯、約150g）" : "Estimated amount (e.g. 1 bowl, about 150 g)",
            },
          },
        },
      },
      nutrition: {
        type: "object",
        additionalProperties: false,
        required: ["calories_kcal", "protein_g", "fat_g", "carbs_g"],
        properties: {
          calories_kcal: {
            type: "integer",
            description: isJa ? "推定カロリー（kcal）" : "Estimated calories (kcal)",
          },
          protein_g: { type: "integer", description: isJa ? "推定タンパク質（g）" : "Estimated protein (g)" },
          fat_g: { type: "integer", description: isJa ? "推定脂質（g）" : "Estimated fat (g)" },
          carbs_g: { type: "integer", description: isJa ? "推定炭水化物（g）" : "Estimated carbohydrates (g)" },
        },
      },
      mito_score: {
        type: "integer",
        description: isJa
          ? "ミトコンドリアに良い食事度 0〜100（50が普通）"
          : "How good this meal is for mitochondria, 0-100 (50 is average)",
      },
      good_points: {
        type: "array",
        items: { type: "string" },
        description: isJa ? "この食事の良い点（0〜3個・日本語）" : "Good points of this meal (0-3 items)",
      },
      advice: {
        type: "string",
        description: isJa
          ? "次に活かせるひとことアドバイス（1〜2文・日本語・前向きに。良いものが無ければ次に足すと良い一品を提案）"
          : "A short, positive tip for next time (1-2 sentences. If nothing to praise, suggest one good item to add)",
      },
      caution: {
        type: "string",
        description: isJa
          ? "ミトコンドリア観点でやさしく指摘したい点を1つだけ（日本語・責めない）。指摘が無ければ空文字にする"
          : "One gentle point to note from a mitochondria perspective, at most one (not scolding). Empty string if nothing to note",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: isJa ? "推定の確信度" : "Confidence of the estimate",
      },
    },
  } as const;
}

/** dataURL / 素のbase64 の両方を受け付けてバイナリにする */
function decodeImage(input: string): Buffer {
  const b64 = input.startsWith("data:")
    ? input.slice(input.indexOf(",") + 1)
    : input;
  const buf = Buffer.from(b64.trim(), "base64");
  if (buf.length < 100) throw new BadImageError("画像データが空か短すぎます");
  return buf;
}

export interface AnalyzeResult {
  analysis: MealAnalysis;
  usage: Anthropic.Usage;
  model: string;
}

export interface AnalyzeInput {
  images?: string[]; // dataURL または base64（同一食事の写真・最大4枚）
  text?: string;     // 食事のテキスト説明（例: すき家でご飯大盛りの牛丼と肉皿）
  fullness?: string; // ユーザー申告の満腹度（例: 腹七分目くらい）
  lang?: Lang;        // 出力言語。'en'|'ms'|'zh'以外（未指定・'ko'含む不正値はindex.ts側でjaに正規化される）はja
}

/**
 * input.lang を 'ja' | 'en' | 'ms' | 'zh' に正規化する。上記3つ以外（未指定・大文字小文字違い・'ko'・
 * 'zh-TW'等の不正値）はすべて'ja'。大文字小文字は区別する（'EN'等はjaへ落ちる。理由はanalyze.test.ts参照）。
 */
function normalizeLang(lang: unknown): Lang {
  return lang === "en" || lang === "ms" || lang === "zh" ? lang : "ja";
}

/**
 * ユーザー向けの指示テキスト（「写真は◯枚あります」等）を言語に合わせて組み立てる。
 * lang==='ja'（未指定含む）は変更前のコードと完全に同一の文字列を返す。
 * lang!=='ja'（en/ms/zh共通）は指示文自体は英語のまま（モデルへの指示のため）、
 * 「出力は◯◯語で」という一文を末尾に追加する。
 */
function buildUserParts(input: AnalyzeInput, lang: Lang, imageCount: number): string[] {
  const parts: string[] = [];
  if (lang !== "ja") {
    if (imageCount > 1) {
      parts.push(
        `There are ${imageCount} photos, but they are all of the same single meal. Do not count them separately — treat them together as one meal.`
      );
    }
    if (input.text) {
      parts.push(
        imageCount
          ? `User's note (additional info about the meal in the photo): "${input.text}"`
          : `User's description of the meal: "${input.text}"`
      );
    }
    if (input.fullness) {
      parts.push(`User-reported fullness: "${input.fullness}" (reflect this in the amount estimate)`);
    }
    parts.push(`Write the output in ${LANG_LABEL[lang]}.`);
    parts.push(imageCount ? "Please analyze this meal." : "Please analyze this meal description.");
  } else {
    if (imageCount > 1) {
      parts.push(`写真は${imageCount}枚ありますが、すべて同じ1回の食事を写したものです。重複して数えず、全体で1つの食事として解析してください。`);
    }
    if (input.text) {
      parts.push(imageCount ? `ユーザーによる補足（写真の食事に関する追加情報）：「${input.text}」` : `ユーザーによる食事の説明：「${input.text}」`);
    }
    if (input.fullness) parts.push(`ユーザー申告の満腹度：「${input.fullness}」（量の推定に反映してください）`);
    parts.push(imageCount ? "この食事を解析してください。" : "この食事内容を解析してください。");
  }
  return parts;
}

/**
 * Anthropicへ送るリクエストパラメータを組み立てる純粋関数（ネットワークI/O無し）。
 * 画像はすでにcontent blockへ変換済みのものを受け取る（sharpでのリサイズ等の非同期処理は含まない）。
 * lang==='ja'（未指定・不正値含む）のときは、変更前のコードと完全に同一のリクエストを返す
 * （テスト src/analyze.test.ts で保証）。
 */
export function buildAnalyzeRequestParams(
  input: AnalyzeInput,
  imageContentBlocks: Anthropic.ContentBlockParam[]
): Anthropic.MessageCreateParamsNonStreaming {
  const lang = normalizeLang(input.lang);
  const content: Anthropic.ContentBlockParam[] = [...imageContentBlocks];
  const parts = buildUserParts(input, lang, imageContentBlocks.length);
  content.push({ type: "text", text: parts.join("\n") });

  return {
    model: MODEL,
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(lang),
        cache_control: { type: "ephemeral" }, // 依頼書指定: プロンプトキャッシュ有効化
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: buildMealSchema(lang) as unknown as Record<string, unknown> },
    },
    messages: [{ role: "user", content }],
  };
}

const client = new Anthropic(); // ANTHROPIC_API_KEY を環境変数から読む

export async function analyzeMeal(input: AnalyzeInput): Promise<AnalyzeResult> {
  const imageContentBlocks: Anthropic.ContentBlockParam[] = [];
  const images = input.images ?? [];

  for (const img of images) {
    const raw = decodeImage(img);
    let resized: Buffer;
    try {
      resized = await sharp(raw)
        .rotate() // EXIFの向きを反映
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      throw new BadImageError("画像として読み込めませんでした（対応形式: JPEG/PNG/WebP等）");
    }
    imageContentBlocks.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: resized.toString("base64") },
    });
  }

  const response = await client.messages.create(buildAnalyzeRequestParams(input, imageContentBlocks));

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const analysis = JSON.parse(text) as MealAnalysis; // 構造化出力なので有効なJSONが保証される

  return { analysis, usage: response.usage, model: response.model };
}
