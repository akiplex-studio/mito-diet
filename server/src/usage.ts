import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/data/ 配下に使用ログを置く（gitignore済み）
// v1.44: 日次カウンタ（旧 usage-count.json）はデバイス単位の利用枠（quota.ts・Upstash Redis）に置き換えたため廃止
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const LOG_DIR = path.join(DATA_DIR, "logs");

// Haiku 4.5 の料金（USD / 1Mトークン）
const PRICE = {
  input: 1.0,
  output: 5.0,
  cacheWrite: 1.25, // 入力の1.25倍
  cacheRead: 0.1, //  入力の0.1倍
};

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function estimateCostUSD(u: UsageLike): number {
  const cost =
    (u.input_tokens * PRICE.input +
      u.output_tokens * PRICE.output +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000; // 小数6桁
}

export interface LogEntry {
  ts: string;
  model: string;
  ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  est_cost_usd: number;
}

/** 月ごとのJSONLファイルに1行追記する簡易ログ */
export function logUsage(entry: LogEntry): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `usage-${entry.ts.slice(0, 7)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("ログ書き込みに失敗:", err); // ログ失敗でAPIレスポンスは止めない
  }
}
