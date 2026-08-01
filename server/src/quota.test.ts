import { test } from "node:test";
import assert from "node:assert/strict";
import { localDateFromOffset, resetAtIso, validateDeviceId, checkAndConsume, recordCost, MemoryQuotaStore, FallbackQuotaStore, type QuotaStore, issueDeviceId, verifyDeviceId } from "./quota.js";

test("localDateFromOffset: JST(+540) UTC 2026-07-25T20:00Z → 2026-07-26", () => {
  const nowMs = Date.parse("2026-07-25T20:00:00.000Z");
  assert.equal(localDateFromOffset(nowMs, 540), "2026-07-26");
});

test("localDateFromOffset: オフセット0はUTC日付そのまま", () => {
  const nowMs = Date.parse("2026-07-25T20:00:00.000Z");
  assert.equal(localDateFromOffset(nowMs, 0), "2026-07-25");
});

test("localDateFromOffset: ±840分にクランプされる（+9999は+840扱い）", () => {
  const nowMs = Date.parse("2026-07-25T00:30:00.000Z");
  assert.equal(localDateFromOffset(nowMs, 9999), localDateFromOffset(nowMs, 840));
});

test("localDateFromOffset: 非数値は0（UTC）扱い", () => {
  const nowMs = Date.parse("2026-07-25T20:00:00.000Z");
  assert.equal(localDateFromOffset(nowMs, NaN), localDateFromOffset(nowMs, 0));
});

test("resetAtIso: JSTのローカル翌日0時のUTC ISOを返す", () => {
  const nowMs = Date.parse("2026-07-25T20:00:00.000Z"); // JSTでは2026-07-26 05:00
  const iso = resetAtIso(nowMs, 540);
  // JST 2026-07-27T00:00:00+09:00 == UTC 2026-07-26T15:00:00Z
  assert.equal(iso, "2026-07-26T15:00:00.000Z");
});

test("validateDeviceId: UUID形式はOK", () => {
  assert.equal(validateDeviceId("550e8400-e29b-41d4-a716-446655440000"), true);
});

test("validateDeviceId: 空文字・短すぎ・記号入りはNG", () => {
  assert.equal(validateDeviceId(""), false);
  assert.equal(validateDeviceId("short"), false);
  assert.equal(validateDeviceId("abc123!!!!!!!!!!"), false);
  assert.equal(validateDeviceId(undefined), false);
  assert.equal(validateDeviceId(12345), false);
});

test("デバイス上限: MemoryQuotaStoreで6回目までok、7回目はreason:device", async () => {
  const store = new MemoryQuotaStore();
  const deviceId = "device-limit-test-aaaaaaaa";
  for (let i = 1; i <= 6; i++) {
    const res = await checkAndConsume(store, deviceId, 540, { deviceLimit: 6, globalCostLimitUsd: 100 });
    assert.equal(res.ok, true, `${i}回目はokのはず`);
    assert.equal(res.remaining, 6 - i);
  }
  const seventh = await checkAndConsume(store, deviceId, 540, { deviceLimit: 6, globalCostLimitUsd: 100 });
  assert.equal(seventh.ok, false);
  assert.equal(seventh.reason, "device");
  assert.equal(seventh.remaining, 0);
});

test("グローバル上限: コスト累積が上限を超えたらreason:global", async () => {
  const store = new MemoryQuotaStore();
  await recordCost(store, 540, 1.0);
  const under = await checkAndConsume(store, "device-global-test-1", 540, { deviceLimit: 100, globalCostLimitUsd: 1.5 });
  assert.equal(under.ok, true);
  await recordCost(store, 540, 0.6); // 累計1.6 >= 1.5
  const over = await checkAndConsume(store, "device-global-test-2", 540, { deviceLimit: 100, globalCostLimitUsd: 1.5 });
  assert.equal(over.ok, false);
  assert.equal(over.reason, "global");
});

test("フォールバック: 常に例外を投げるプライマリ＋Memoryセカンダリで処理が継続しカウントも効く", async () => {
  class AlwaysThrowStore implements QuotaStore {
    async incr(): Promise<number> {
      throw new Error("redis down");
    }
    async incrBy(): Promise<number> {
      throw new Error("redis down");
    }
    async get(): Promise<number | null> {
      throw new Error("redis down");
    }
  }
  const store = new FallbackQuotaStore(new AlwaysThrowStore(), new MemoryQuotaStore());
  const deviceId = "device-fallback-test-1";
  const first = await checkAndConsume(store, deviceId, 540, { deviceLimit: 2, globalCostLimitUsd: 100 });
  assert.equal(first.ok, true);
  assert.equal(first.remaining, 1);
  const second = await checkAndConsume(store, deviceId, 540, { deviceLimit: 2, globalCostLimitUsd: 100 });
  assert.equal(second.ok, true);
  assert.equal(second.remaining, 0);
  const third = await checkAndConsume(store, deviceId, 540, { deviceLimit: 2, globalCostLimitUsd: 100 });
  assert.equal(third.ok, false);
  assert.equal(third.reason, "device");
});

/* --- v1.67: 署名つきデバイスID（勝手に作ったIDを弾く） --- */
test("issueDeviceId で発行したIDは verifyDeviceId を通る", () => {
  const id = issueDeviceId("secret-a");
  assert.equal(verifyDeviceId(id, "secret-a"), true);
  assert.equal(validateDeviceId(id), true);
});

test("自分で作ったIDは弾かれる", () => {
  assert.equal(verifyDeviceId("abcdefgh12345678", "secret-a"), false);
  assert.equal(verifyDeviceId("abcdefgh.deadbeefdeadbeef", "secret-a"), false);
});

test("別のシークレットで署名されたIDは弾かれる", () => {
  const id = issueDeviceId("secret-a");
  assert.equal(verifyDeviceId(id, "secret-b"), false);
});

test("署名部分だけ長さを変えても弾かれる（timingSafeEqualが落ちない）", () => {
  const id = issueDeviceId("secret-a");
  const raw = id.slice(0, id.lastIndexOf("."));
  assert.equal(verifyDeviceId(`${raw}.short`, "secret-a"), false);
  assert.equal(verifyDeviceId(`${raw}.`, "secret-a"), false);
  assert.equal(verifyDeviceId(raw, "secret-a"), false);
});

test("発行するたびに違うIDになる", () => {
  const a = issueDeviceId("secret-a");
  const b = issueDeviceId("secret-a");
  assert.notEqual(a, b);
});
