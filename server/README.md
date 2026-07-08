# mito-meal-analyzer — 料理写真解析バックエンド（個人利用MVP）

料理写真を Claude API（Haiku 4.5）で解析するバックエンド。APIキーをクライアントに渡さないための中継サーバー。

## セットアップ（初回のみ）

```sh
cd server
npm install
cp .env.example .env
# .env を編集して ANTHROPIC_API_KEY と APP_SHARED_SECRET を設定
# シークレット生成例: openssl rand -hex 32
```

前提: Node.js（このMacには 2026-07-08 に `brew install node` で導入済み）

## 起動

```sh
npm run dev        # 開発（TypeScriptを直接実行）
# または
npm run build && npm start
```

## 動作確認

```sh
# ヘルスチェック
curl http://localhost:8787/healthz

# 写真解析（photo.jpg を送る例）
curl -s http://localhost:8787/api/analyze-meal \
  -H "content-type: application/json" \
  -H "x-app-secret: <APP_SHARED_SECRETの値>" \
  -d "{\"image\": \"$(base64 -i photo.jpg)\"}" | jq .
```

レスポンス例:

```json
{
  "ok": true,
  "analysis": {
    "dishes": [{"name": "焼き鮭定食", "amount": "1人前"}],
    "nutrition": {"calories_kcal": 650, "protein_g": 35, "fat_g": 20, "carbs_g": 75},
    "mito_score": 72,
    "good_points": ["良質なタンパク質（鮭）", "野菜の小鉢がある"],
    "advice": "バランスの良い定食です。ご飯を少なめにすると腹七分目に近づきます。",
    "confidence": "medium"
  },
  "meta": {"model": "claude-haiku-4-5-20251001", "est_cost_usd": 0.0021, "today_count": 1, "daily_limit": 50}
}
```

## 仕様の要点

| 項目 | 内容 |
|---|---|
| 認証 | ヘッダー `x-app-secret` を `.env` の `APP_SHARED_SECRET` と照合（タイミングセーフ） |
| 画像 | サーバー側で長辺1024pxに縮小してから送信。解析後は破棄（保存しない） |
| モデル | `claude-haiku-4-5-20251001` 固定・構造化出力（JSONスキーマ保証）・システムプロンプトにキャッシュマーカー |
| ログ | `data/logs/usage-YYYY-MM.jsonl` に日時・トークン数・推定コスト(USD)を1行ずつ追記 |
| 暴走防止 | `data/usage-count.json` の日次カウンタ。`DAILY_LIMIT`（既定50回/日）到達で 429。**失敗した試行もカウントする**（暴走防止優先） |

## 制約・注意点

- プロンプトキャッシュ: Haiku 4.5 のキャッシュ下限は4096トークンで、現在のシステムプロンプトはそれ未満のため実質未作動（コスト影響は1回あたり1円未満なので許容）。プロンプトを拡張すれば自動で効く
- `.env`（APIキー・シークレット）と `data/`（ログ）はコミットされない（リポジトリは公開のため厳守）
- 日次カウンタはファイルベースの簡易実装（単一ユーザー前提。同時リクエストの厳密な排他はしない）

## リスクの記録（CLAUDE.md「ツール導入の記録」）

- 認証情報: Anthropic APIキーは `server/.env` のみに置く。漏洩時は platform.claude.com で失効・再発行
- データ送信先: 食事写真は Anthropic API にのみ送信される（解析目的）。サーバーには保存しない
- 権限スコープ: 共有シークレットを知っている端末だけが解析APIを呼べる。公開サーバーに置く場合はシークレットを十分長くすること

## 将来（公開フェーズ）

複数ユーザー公開時は「写真解析_コスト設計とバックエンド仕様.md」に基づき、広告連携・多層クォータ・本格認証を追加する（本MVPには含まない）。ホスティングは Cloud Run / Render の無料枠を想定。
