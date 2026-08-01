import crypto from "node:crypto";
// v1.44: 共有シークレット認証を廃止し、デバイス単位の日次利用枠に置き換えるためのロジック。
// Render無料プランはディスクが非永続なため、カウンタはUpstash Redis（HTTP API）に保存する。
// ネットワークなしでテストできるよう、ストアはインタフェース越しに注入する設計にしている。
import { Redis } from "@upstash/redis";

export interface QuotaStore {
  /** INCRして現在値を返す。ttlSecで有効期限も設定し直す（毎回EXPIREし直してよい） */
  incr(key: string, ttlSec: number): Promise<number>;
  /** 整数値をINCRBYして現在値を返す */
  incrBy(key: string, by: number, ttlSec: number): Promise<number>;
  get(key: string): Promise<number | null>;
}

/** Upstash Redis（REST/HTTP API）を使う本番用ストア */
export class RedisQuotaStore implements QuotaStore {
  private redis: Redis;
  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }
  async incr(key: string, ttlSec: number): Promise<number> {
    const value = await this.redis.incr(key);
    await this.redis.expire(key, ttlSec);
    return value;
  }
  async incrBy(key: string, by: number, ttlSec: number): Promise<number> {
    const value = await this.redis.incrby(key, by);
    await this.redis.expire(key, ttlSec);
    return value;
  }
  async get(key: string): Promise<number | null> {
    const value = await this.redis.get<number>(key);
    return value === null || value === undefined ? null : Number(value);
  }
}

interface MemEntry {
  value: number;
  expiresAt: number;
}

/** ローカル開発・フォールバック用のインメモリストア（Mapベース。期限切れは読み書き時に破棄） */
export class MemoryQuotaStore implements QuotaStore {
  private map = new Map<string, MemEntry>();
  private read(key: string, now: number): MemEntry | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.map.delete(key);
      return null;
    }
    return entry;
  }
  async incr(key: string, ttlSec: number): Promise<number> {
    return this.incrBy(key, 1, ttlSec);
  }
  async incrBy(key: string, by: number, ttlSec: number): Promise<number> {
    const now = Date.now();
    const existing = this.read(key, now);
    const value = (existing ? existing.value : 0) + by;
    this.map.set(key, { value, expiresAt: now + ttlSec * 1000 });
    return value;
  }
  async get(key: string): Promise<number | null> {
    const now = Date.now();
    const entry = this.read(key, now);
    return entry ? entry.value : null;
  }
}

/**
 * プライマリ（Redis想定）を試し、例外時はセカンダリ（Memory想定）に処理を委譲して継続する。
 * Redis失敗時は console.error で大きくログを出すが、毎リクエストで連発しないよう直近1分以内の重複ログは抑制する。
 */
export class FallbackQuotaStore implements QuotaStore {
  private lastErrorLoggedAt = 0;
  constructor(
    private primary: QuotaStore,
    private secondary: QuotaStore
  ) {}
  private logError(err: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLoggedAt > 60_000) {
      console.error(
        "[quota] プライマリストア（Redis）への接続に失敗したため、メモリストアにフォールバックしました。日次上限がインスタンス再起動でリセットされる可能性があります:",
        err
      );
      this.lastErrorLoggedAt = now;
    }
  }
  async incr(key: string, ttlSec: number): Promise<number> {
    try {
      return await this.primary.incr(key, ttlSec);
    } catch (err) {
      this.logError(err);
      return await this.secondary.incr(key, ttlSec);
    }
  }
  async incrBy(key: string, by: number, ttlSec: number): Promise<number> {
    try {
      return await this.primary.incrBy(key, by, ttlSec);
    } catch (err) {
      this.logError(err);
      return await this.secondary.incrBy(key, by, ttlSec);
    }
  }
  async get(key: string): Promise<number | null> {
    try {
      return await this.primary.get(key);
    } catch (err) {
      this.logError(err);
      return await this.secondary.get(key);
    }
  }
}

/** 起動時に1回だけ呼び、環境変数に応じたストアを組み立てる */
export function buildQuotaStore(): QuotaStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.error(
      "[quota] 環境変数 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が未設定です。メモリストアのみで動作します（ローカル開発用。本番ではRender再起動のたびに日次上限がリセットされてしまいます）"
    );
    return new MemoryQuotaStore();
  }
  return new FallbackQuotaStore(new RedisQuotaStore(url, token), new MemoryQuotaStore());
}

const MAX_OFFSET_MIN = 14 * 60; // ±14時間

/** x-tz-offset の値（UTCから東向きの分。非数値・範囲外は丸める）を安全な数値に正規化する */
function clampOffset(offsetMin: number): number {
  const n = Number.isFinite(offsetMin) ? offsetMin : 0;
  return Math.max(-MAX_OFFSET_MIN, Math.min(MAX_OFFSET_MIN, n));
}

/** UTC時刻(nowMs)とタイムゾーンオフセット(分・UTCから東向き)から、クライアントのローカル日付(YYYY-MM-DD)を求める */
export function localDateFromOffset(nowMs: number, offsetMin: number): string {
  const offset = clampOffset(offsetMin);
  const local = new Date(nowMs + offset * 60_000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** そのローカル日付が終わる瞬間（ローカル翌日0時）のUTC ISO文字列を返す */
export function resetAtIso(nowMs: number, offsetMin: number): string {
  const offset = clampOffset(offsetMin);
  const local = new Date(nowMs + offset * 60_000);
  // ローカルの壁時計としての「翌日0時」を、いったんlocal空間のUTCミリ秒として求め、offsetを引いて実際のUTCに戻す
  const nextLocalMidnightAsUtcMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  const actualUtcMs = nextLocalMidnightAsUtcMs - offset * 60_000;
  return new Date(actualUtcMs).toISOString();
}

/** デバイスIDの形式チェック（形だけ。署名の検証は verifyDeviceId で行う） */
export function validateDeviceId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (id.length < 8 || id.length > 128) return false;
  return /^[A-Za-z0-9._-]+$/.test(id);
}

/* ============ v1.67: サーバー発行のデバイスID ============
   以前は「8〜64文字の英数字」なら何でも受け付けていたため、IDを変えるだけで
   デバイス日次上限を無限に回避できた（結果、グローバル上限を他人に食われて
   本人が使えなくなる）。サーバーがHMACで署名したIDだけを受け付けるようにする。
   形式は  <ランダム22文字>.<署名の先頭16文字>  */
export function issueDeviceId(secret: string): string {
  const raw = crypto.randomBytes(16).toString("base64url");   // 22文字
  return `${raw}.${signDeviceId(raw, secret)}`;
}
function signDeviceId(raw: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(raw).digest("base64url").slice(0, 16);
}
/** サーバーが発行したIDかどうか。形式が違う・署名が合わないものは false */
export function verifyDeviceId(id: string, secret: string): boolean {
  const dot = id.lastIndexOf(".");
  if (dot <= 0) return false;
  const raw = id.slice(0, dot);
  const sig = id.slice(dot + 1);
  const expected = signDeviceId(raw, secret);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

const DEVICE_TTL_SEC = 48 * 3600; // デバイスカウンタは48時間で自然に消える
const GLOBAL_TTL_SEC = 48 * 3600; // グローバルコストも48時間で自然に消える
const STAT_TTL_SEC = 90 * 24 * 3600; // 統計は90日保持

export interface QuotaCheckOptions {
  deviceLimit?: number;
  globalCostLimitUsd?: number;
}

export interface QuotaCheckResult {
  ok: boolean;
  reason?: "global" | "device";
  remaining: number;
  resetAt: string;
  limit: number;
}

/**
 * 利用枠の判定本体。
 * 1. グローバルコスト（マイクロドル整数）が上限以上ならNG
 * 2. デバイスカウントをINCRし、上限を超えていたらNG
 * 3. どちらも通ればOK
 */
export async function checkAndConsume(
  store: QuotaStore,
  deviceId: string,
  offsetMin: number,
  opts: QuotaCheckOptions = {}
): Promise<QuotaCheckResult> {
  const limit = opts.deviceLimit ?? 6;
  const globalLimitUsd = opts.globalCostLimitUsd ?? 1.5;
  const now = Date.now();
  const date = localDateFromOffset(now, offsetMin);
  const resetAt = resetAtIso(now, offsetMin);

  const globalMicros = (await store.get(`g:${date}`)) ?? 0;
  const globalLimitMicros = Math.round(globalLimitUsd * 1_000_000);
  if (globalMicros >= globalLimitMicros) {
    return { ok: false, reason: "global", remaining: 0, resetAt, limit };
  }

  const count = await store.incr(`q:${date}:${deviceId}`, DEVICE_TTL_SEC);
  if (count > limit) {
    return { ok: false, reason: "device", remaining: 0, resetAt, limit };
  }

  return { ok: true, remaining: limit - count, resetAt, limit };
}

/** 解析成功後に呼ぶ。グローバルコストへ加算し、デバイスIDを含まない日次統計もカウントする */
export async function recordCost(store: QuotaStore, offsetMin: number, costUsd: number): Promise<void> {
  const now = Date.now();
  const date = localDateFromOffset(now, offsetMin);
  const micros = Math.round(costUsd * 1_000_000);
  await store.incrBy(`g:${date}`, micros, GLOBAL_TTL_SEC);
  await store.incr(`stat:${date}`, STAT_TTL_SEC);
}
