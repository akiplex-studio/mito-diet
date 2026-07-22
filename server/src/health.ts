import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/data/ 配下にヘルスデータログを置く（gitignore済み）
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const HEALTH_FILE = path.join(DATA_DIR, "health-log.json");

export interface HealthEntry {
  steps: number | null;
  sleepHours: number | null;
  weight: number | null;
  updatedAt: string;
}

type HealthLog = Record<string, HealthEntry>;

const EMPTY_ENTRY: HealthEntry = { steps: null, sleepHours: null, weight: null, updatedAt: "" };

function load(): HealthLog {
  try {
    const loaded = JSON.parse(fs.readFileSync(HEALTH_FILE, "utf8"));
    return loaded && typeof loaded === "object" ? loaded : {};
  } catch {
    return {};
  }
}

/** 指定日のsteps/sleepHours/weightを部分更新（送られなかった側は既存値を保持） */
export function upsertHealthData(
  date: string,
  patch: { steps?: number; sleepHours?: number; weight?: number }
): HealthEntry {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = load();
  const prev = log[date] ?? EMPTY_ENTRY;
  const entry: HealthEntry = {
    steps: patch.steps ?? prev.steps,
    sleepHours: patch.sleepHours ?? prev.sleepHours,
    weight: patch.weight ?? prev.weight,
    updatedAt: new Date().toISOString(),
  };
  log[date] = entry;
  fs.writeFileSync(HEALTH_FILE, JSON.stringify(log));
  return entry;
}

export function getHealthData(date: string): HealthEntry {
  const log = load();
  return log[date] ?? EMPTY_ENTRY;
}

// TaskerHealthConnectプラグイン（Read Aggregated Data）の生の結果JSONから値を取り出す。
// 例: {"dataOrigins":[],"doubleValues":{},"longValues":{"Steps_count_total":8000}}
// Tasker側でのJSONパース・単位換算を避けるため、生JSONをそのままサーバーへ送ってもらう想定。
type AggregatedResultLike = Record<string, unknown>;

function parseAggregatedResult(raw: unknown): AggregatedResultLike | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw as AggregatedResultLike;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

// TaskerHealthConnectはプラグイン/型ごとに値を longValues / doubleValues / durationValues など
// 別々のマップに入れて返す。バージョン差で置き場所が変わっても拾えるよう、トップレベルの
// 「オブジェクト値」をすべて候補マップとして集める（dataOrigins等の配列・スカラーは除外）。
function valueMaps(obj: AggregatedResultLike | null): Record<string, unknown>[] {
  if (!obj || typeof obj !== "object") return [];
  const maps: Record<string, unknown>[] = [];
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) maps.push(v as Record<string, unknown>);
  }
  return maps;
}

// 全候補マップから、指定キーの有限数値を探す（歩数・体重はこれで従来どおり拾える）
function numField(obj: AggregatedResultLike | null, key: string): number | null {
  for (const m of valueMaps(obj)) {
    const v = m[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

// ISO-8601期間文字列（例 "PT7H30M" / "P1DT30M"）を時間に換算する。Health Connectの
// Duration集計をプラグインが文字列で返すケースへの対応。
function isoDurationToHours(s: string): number | null {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) return null;
  const d = parseFloat(m[1] || "0"), h = parseFloat(m[2] || "0"), min = parseFloat(m[3] || "0"), sec = parseFloat(m[4] || "0");
  const total = d * 24 + h + min / 60 + sec / 3600;
  return total > 0 ? total : null;
}

export function extractStepsFromRaw(raw: unknown): number | null {
  const v = numField(parseAggregatedResult(raw), "Steps_count_total");
  return v === null ? null : Math.max(0, Math.floor(v));
}

// 睡眠集計のキー名はプラグイン/バージョンで揺れるため、既知の候補を順に試す
const SLEEP_KEYS = [
  "SleepSession_duration",
  "SleepSession_SLEEP_DURATION_TOTAL",
  "SleepSession_sleepDurationTotal",
  "SleepSession_totalDuration",
];
const isSleepDurKey = (k: string) => /sleep/i.test(k) && /dur/i.test(k);

// 集計値が「ミリ秒/分/時間」のどれで来ても妥当な睡眠時間(h)に正規化する。桁で判別:
//  1000超=ミリ秒 / 48〜1000=分 / 48以下=すでに時間。0〜24hの範囲外はnull。
function toSleepHours(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const hours = n > 1000 ? n / 3600000 : (n > 48 ? n / 60 : n);
  if (hours <= 0 || hours > 24) return null;
  return Math.round(hours * 10) / 10;
}

/**
 * Health Connectの睡眠時間集計を時間(h)で取り出す。プラグインが値をどのマップ・キー名・型
 * （数値ミリ秒/分/時間、またはISO-8601文字列）で返しても拾えるよう多段で探索する。
 */
export function extractSleepHoursFromRaw(raw: unknown): number | null {
  const obj = parseAggregatedResult(raw);
  if (!obj) return null;
  // 1) 既知キーの数値
  for (const k of SLEEP_KEYS) {
    const v = numField(obj, k);
    if (v !== null) { const h = toSleepHours(v); if (h !== null) return h; }
  }
  // 2) sleep×duration を含む数値キーを全マップから曖昧一致（キー名の揺れ対策）
  for (const m of valueMaps(obj)) {
    for (const [k, v] of Object.entries(m)) {
      if (isSleepDurKey(k) && typeof v === "number" && Number.isFinite(v)) {
        const h = toSleepHours(v); if (h !== null) return h;
      }
    }
  }
  // 3) sleep×duration を含む文字列キー（ISO-8601期間 or 数字文字列）
  for (const m of valueMaps(obj)) {
    for (const [k, v] of Object.entries(m)) {
      if (isSleepDurKey(k) && typeof v === "string") {
        const iso = isoDurationToHours(v);
        if (iso !== null) return Math.round(iso * 10) / 10;
        const num = Number(v);
        if (Number.isFinite(num)) { const h = toSleepHours(num); if (h !== null) return h; }
      }
    }
  }
  return null;
}

/** Weight_weight_avgはkg想定（Health ConnectのMassはkilograms基準）。小数1桁に丸める */
export function extractWeightFromRaw(raw: unknown): number | null {
  const kg = numField(parseAggregatedResult(raw), "Weight_weight_avg");
  if (kg === null || kg <= 0) return null;
  return Math.round(kg * 10) / 10;
}
