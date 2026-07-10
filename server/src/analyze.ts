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
  confidence: "low" | "medium" | "high";
}

// アプリ（ミトコンドリア・ダイエット）の思想に沿った採点基準をシステムプロンプトに持たせる。
// 注意: Haiku 4.5 のキャッシュ可能プレフィックス下限は4096トークンのため、
// このサイズではキャッシュは実質作動しない（マーカーは依頼書指定どおり付与。将来拡張時に自動で効く）
const SYSTEM_PROMPT = `あなたは「ミトコンドリア・ダイエット」アプリの栄養解析アシスタントです。
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

## トーンの方針
- advice は1〜2文。前向きで、責めない・煽らない（「〜するとさらに良い」の形）
- 医療的な断定はしない。数値はあくまで目安であることを前提とした書きぶりにする`;

// 構造化出力スキーマ（Haiku 4.5 は structured outputs 対応）
const MEAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dishes", "nutrition", "mito_score", "good_points", "advice", "confidence"],
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
    advice: { type: "string", description: "次に活かせるひとことアドバイス（1〜2文・日本語・前向きに）" },
    confidence: { type: "string", enum: ["low", "medium", "high"], description: "推定の確信度" },
  },
} as const;

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
}

const client = new Anthropic(); // ANTHROPIC_API_KEY を環境変数から読む

export async function analyzeMeal(input: AnalyzeInput): Promise<AnalyzeResult> {
  const content: Anthropic.ContentBlockParam[] = [];
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
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: resized.toString("base64") },
    });
  }

  const parts: string[] = [];
  if (images.length > 1) {
    parts.push(`写真は${images.length}枚ありますが、すべて同じ1回の食事を写したものです。重複して数えず、全体で1つの食事として解析してください。`);
  }
  if (input.text) parts.push(images.length ? `ユーザーによる補足（写真の食事に関する追加情報）：「${input.text}」` : `ユーザーによる食事の説明：「${input.text}」`);
  if (input.fullness) parts.push(`ユーザー申告の満腹度：「${input.fullness}」（量の推定に反映してください）`);
  parts.push(images.length ? "この食事を解析してください。" : "この食事内容を解析してください。");
  content.push({ type: "text", text: parts.join("\n") });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }, // 依頼書指定: プロンプトキャッシュ有効化
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: MEAL_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [{ role: "user", content }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const analysis = JSON.parse(text) as MealAnalysis; // 構造化出力なので有効なJSONが保証される

  return { analysis, usage: response.usage, model: response.model };
}
