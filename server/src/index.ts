import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { analyzeMeal, BadImageError } from "./analyze.js";
import { checkAndCountDaily, estimateCostUSD, logUsage } from "./usage.js";

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.APP_SHARED_SECRET || "";
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 50);
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  "https://akiplex-studio.github.io,http://localhost:8080,http://localhost:5173,capacitor://localhost,https://localhost"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!SECRET || SECRET === "change-me-to-a-long-random-string") {
  console.error("環境変数 APP_SHARED_SECRET を設定してください（.env.example 参照）");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("環境変数 ANTHROPIC_API_KEY を設定してください（.env.example 参照）");
  process.exit(1);
}

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS, allowedHeaders: ["content-type", "x-app-secret"] }));
app.use(express.json({ limit: "20mb" })); // dataURLの写真がそのまま送れるサイズ

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

function secretOk(given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post("/api/analyze-meal", async (req, res) => {
  // 1. 簡易認証（共有シークレット・タイミングセーフ比較）
  if (!secretOk(req.header("x-app-secret"))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // 2. 入力チェック
  const image = req.body?.image;
  if (typeof image !== "string" || image.length < 100) {
    res.status(400).json({ error: "bad_request", message: "image に base64 か dataURL を入れてください" });
    return;
  }

  // 3. 日次上限（暴走防止）
  const quota = checkAndCountDaily(DAILY_LIMIT);
  if (!quota.ok) {
    res.status(429).json({ error: "daily_limit_reached", limit: DAILY_LIMIT });
    return;
  }

  // 4. 解析
  const t0 = Date.now();
  try {
    const { analysis, usage, model } = await analyzeMeal(image);
    const cost = estimateCostUSD(usage);
    logUsage({
      ts: new Date().toISOString(),
      model,
      ms: Date.now() - t0,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      est_cost_usd: cost,
      day_count: quota.count,
    });
    res.json({
      ok: true,
      analysis,
      meta: { model, est_cost_usd: cost, today_count: quota.count, daily_limit: DAILY_LIMIT },
    });
  } catch (err) {
    // 型付き例外を具体的な順にハンドリング
    if (err instanceof BadImageError) {
      res.status(400).json({ error: "bad_image", message: err.message });
      return;
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic APIキーが不正です");
      res.status(500).json({ error: "server_config", message: "サーバーのAPIキー設定を確認してください" });
      return;
    }
    if (err instanceof Anthropic.RateLimitError) {
      res.status(503).json({ error: "anthropic_rate_limited", message: "少し待ってから再試行してください" });
      return;
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic APIエラー:", err.status, err.message);
      res.status(502).json({ error: "anthropic_error" });
      return;
    }
    console.error("解析中の予期しないエラー:", err);
    res.status(500).json({ error: "internal" });
  }
});

app.listen(PORT, () => {
  console.log(`mito-meal-analyzer: http://localhost:${PORT}`);
  console.log(`  POST /api/analyze-meal (x-app-secret 必須) / 日次上限 ${DAILY_LIMIT} 回`);
  console.log(`  CORS許可: ${ALLOWED_ORIGINS.join(", ")}`);
});
