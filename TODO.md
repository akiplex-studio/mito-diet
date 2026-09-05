# TODO（32_Mitochondria_diet）

## 【重要】Capacitor 版で「書き出す（JSON）」がファイルを作らない（2026-09-05 発覚）

- 症状: アプリ版（Android WebView）で設定 → 書き出す を押すと「JSONを書き出しました」と出るが、`/sdcard/Download` にファイルができない。ウェブ版（Chrome）では動く。
- 原因: `#btnExport` / `#btnExportSummary` が `<a download>` ＋ `URL.createObjectURL(blob)` 方式。Capacitor の WebView にはダウンロード処理が無い。トーストはクリック直後に無条件で出る。
- 影響: 7/24 のアプリ移行以降、平井さんのバックアップが一度も取れていなかった。2026-09-05 に開発版を消す際、`run-as tar` で退避した LevelDB から復元して事なきを得た（経緯は `~/.claude/docs/LESSONS.md` 2026-09-05）。
- 対応（2026-09-05 実装、versionCode 169 に同梱）:
  1. `exportTextFile()` を追加。ネイティブでは `@capacitor/filesystem`（CACHE）に書いてから `@capacitor/share` で共有シートを出す。ウェブ版は従来の `<a download>`。
  2. 成功時だけ `toast.export.done` と `DB.lastExport` 更新。失敗・キャンセル時は `toast.export.failed`（ja/en 追加、`i18n:accept` 済み）。
  3. ウェブ版の経路はブラウザで動作確認済み（Download に `mito-data-2026-09-05.json` が落ちた）。
  4. ネイティブ版の経路も実機（Xiaomi 21081111RG、デバッグ版 1.69）で確認済み（2026-09-05）: キャッシュに `mito-data-2026-09-05.json`（6284 B）→ 共有シート → Google ドライブ `000_MyDate` に同サイズのファイルが上がった。端末がオフラインだと「アップロード待ち」で遅れて上がる。
  5. 未コミット。`npm run check`（playwright smoke）は未実行。コミット前に実行する。

## 169 に同梱したその他の変更（2026-09-05）
- ランチャーアイコンをマイトに差し替え（アダプティブ、背景 #386641）。
- アプリ名を「ミトコンドリア・ライフ」に統一: `strings.xml`、`capacitor.config.json`、`index.html`（title・フッター・通知タイトル・PWA name）、`privacypolicy.html`、iOS `Info.plist`。`scripts/i18n-scan.mjs` の ALLOW も更新。
- 残っている旧名（意図的に未変更）: `package.json` / `server/package.json` の description、プロジェクトの `CLAUDE.md` の見出し、`~/claude/CLAUDE.md` の目次行。
- 169 の AAB: `backup/mitodiet-169-release.aab`（index.html md5 8809db76…）。Play へのアップロードは平井さんの OK 待ち。
- 復元用ファイル: `backup/mito-data-2026-09-05.json`（7/6〜9/4、49日分、写真込み）。スマホの `/sdcard/Download/mito-data-2026-09-05.json` にも置いた。
