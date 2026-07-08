import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/data/ 配下に使用ログと日次カウンタを置く（gitignore済み）
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const COUNT_FILE = path.join(DATA_DIR, "usage-count.json");
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

function todayStr(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 日次カウンタを確認して加算する（暴走防止）。
 * 上限到達なら ok: false。呼び出し「試行」を数える方針（失敗してもカウント消費）。
 */
export function checkAndCountDaily(limit: number): { ok: boolean; count: number } {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let state = { date: todayStr(), count: 0 };
  try {
    const loaded = JSON.parse(fs.readFileSync(COUNT_FILE, "utf8"));
    if (loaded && loaded.date === todayStr() && Number.isFinite(loaded.count)) {
      state = { date: loaded.date, count: Number(loaded.count) };
    }
  } catch {
    // ファイルなし・壊れている場合は今日0件から
  }
  if (state.count >= limit) {
    return { ok: false, count: state.count };
  }
  state.count += 1;
  fs.writeFileSync(COUNT_FILE, JSON.stringify(state));
  return { ok: true, count: state.count };
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
  day_count: number;
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
