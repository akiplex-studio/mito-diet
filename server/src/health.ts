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
