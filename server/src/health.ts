import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/data/ 配下にヘルスデータログを置く（gitignore済み）
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const HEALTH_FILE = path.join(DATA_DIR, "health-log.json");

export interface HealthEntry {
  steps: number | null;
  sleepHours: number | null;
  updatedAt: string;
}

type HealthLog = Record<string, HealthEntry>;

function load(): HealthLog {
  try {
    const loaded = JSON.parse(fs.readFileSync(HEALTH_FILE, "utf8"));
    return loaded && typeof loaded === "object" ? loaded : {};
  } catch {
    return {};
  }
}

/** 指定日のsteps/sleepHoursを部分更新（送られなかった側は既存値を保持） */
export function upsertHealthData(
  date: string,
  patch: { steps?: number; sleepHours?: number }
): HealthEntry {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = load();
  const prev = log[date] ?? { steps: null, sleepHours: null, updatedAt: "" };
  const entry: HealthEntry = {
    steps: patch.steps ?? prev.steps,
    sleepHours: patch.sleepHours ?? prev.sleepHours,
    updatedAt: new Date().toISOString(),
  };
  log[date] = entry;
  fs.writeFileSync(HEALTH_FILE, JSON.stringify(log));
  return entry;
}

export function getHealthData(date: string): HealthEntry {
  const log = load();
  return log[date] ?? { steps: null, sleepHours: null, updatedAt: "" };
}

// TaskerHealthConnectプラグイン（Read Aggregated Data）の生の結果JSONから値を取り出す。
// 例: {"dataOrigins":[],"doubleValues":{},"longValues":{"Steps_count_total":8000}}
// Tasker側でのJSONパース・単位換算を避けるため、生JSONをそのままサーバーへ送ってもらう想定。
interface AggregatedResultLike {
  longValues?: Record<string, unknown>;
  doubleValues?: Record<string, unknown>;
}

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

function numField(obj: AggregatedResultLike | null, key: string): number | null {
  const v = obj?.longValues?.[key] ?? obj?.doubleValues?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function extractStepsFromRaw(raw: unknown): number | null {
  const v = numField(parseAggregatedResult(raw), "Steps_count_total");
  return v === null ? null : Math.max(0, Math.floor(v));
}

/** SleepSession_durationはミリ秒で来るため時間に換算（小数1桁） */
export function extractSleepHoursFromRaw(raw: unknown): number | null {
  const ms = numField(parseAggregatedResult(raw), "SleepSession_duration");
  if (ms === null) return null;
  return Math.round((ms / 3600000) * 10) / 10;
}
