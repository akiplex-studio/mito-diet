# TODO（32_Mitochondria_diet）

## 説明文の根拠の見直し — 1.72 では触らなかったもの（2026-09-14 博士の研究メモ文案の調査で発覚）
平井さんの決定で「TODO に記録だけ」。1.72（パーティー用）の後に対応する。
- `info.stretch.why`「慢性的なストレスによる消耗を減らせます」: 言い切りすぎ（ストレスとミトコンドリアの消耗はヒトでは実験が無い）
- `info.bodyweight.why` / `info.gymtrain.why`・`why.bodyweight.0`「ミトコンドリアの新生と質の向上が起きます」: 手元の報告に根拠なし。Mølmen 2025（353研究）は筋トレを対象外にしている → 「筋トレでヒト骨格筋のミトコンドリア量は増えるか」を博士に調べてもらう。研究メモも付けていない
- `info.walk.why` / `info.walking.why`「PGC-1α を起動」: 中強度の持続運動のメタ分析（PMID 41481647、14研究・184人）では密度は増えたが PGC-1α は変化なし。PMID 40459444 は増加を報告。文献どうしが食い違う
- `info.meditate.why`「ストレスホルモンを下げます」: 未検証（反証もなし）
- 廃止 id `sugar` の `info.sugar.why`「ミトコンドリアの負担と活性酸素を増やします」: 方針に反する。既存ユーザーが解説画面を開けるかは未確認
- 研究メモの候補（未実施）: `nosmoke`「測ったのは血液の細胞で、脚の筋肉では喫煙者と差がなかった報告もある」
- 研究メモの根拠の一覧: 博士の報告（2026-09-14、お酒 Cardellach 1992・糖分 Sartor 2013・入浴 Hafen 2018 / Hesketh 2019・瞑想 Picard & McEwen 2018・睡眠 Saner 2021・運動 Mølmen 2025・歩数 Edwards 2021）。docs に残す（未実施）

## Android 1.71（タブレット向けレイアウト）をクローズドテストの審査に送信（2026-09-14）

- 経緯: 借りた Lenovo Idea Tab Pro（TB373FU、ZUI 17.5）に 1.70 を入れたら中身がスマホ幅の1列だった。1.70（9/5 17:57 ビルド）は 36ae65c のタブレット対応より前だった。
- 1.71 = HEAD c2e9ed7（タブレットレイアウト＋9/6 英語体重グラフ凡例＋9/13 説明文修正＋Android スプラッシュ）。給餌リデザインは入っていない。AAB は `backup/mitodiet-171-release.aab`。1.70 の AAB はローカルに残っていない（Play Console 側にはある）。
- 9/14 04:5x ごろ「公開の概要」から送信 → **9/14 05:09 に承認・配信済み**（Closed beta トラック「選択したテスターに公開されました」）。送信から約15分だった。
- **未確認（承認後に実機で見る）**: Android 側は `screenOrientation="portrait"` のまま。写真では 1.70 が横長の全画面で出ていた（左右の帯なし）ので、この端末では縦固定が効いていないと推測（Android 16 の大画面ルールの可能性。端末の Android バージョンは未確認）。横持ちで2列、縦持ちで720px幅の1列になるはず。**帯つきの縦長窓で出たら、縦固定の解除が別に必要。**
- タブレットは借り物。返す前に ikaubon6 の Google アカウントを外す／Screen timeout を30秒に戻す。

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

## iOS のアイコン・スプラッシュが Capacitor の初期状態のままだった（2026-09-06 発覚・対応済み）

- 症状: 平井さんが「またアイコンが更新されてなさそう」と指摘。iOS のアプリアイコンが青い X（Capacitor の既定）のままだった。
- 原因: 2026-09-05 のアイコン差し替えは Android の mipmap だけを直し、`ios/App/App/Assets.xcassets/AppIcon.appiconset/` に手を入れていなかった。ファイルの日付が 7/15 のままだったのが証拠。
- 同時に見つかった件: **スプラッシュ画像も iOS・Android とも青い X のまま**（`Splash.imageset/*.png`、`android/.../drawable-*/splash.png`）。
- 対応（build 171 に同梱）:
  1. `AppIcon-512@2x.png` を `screenshot/mito_icon_512.png` から 1024×1024・RGB（アルファ無し）で再生成。旧ファイルは `backup/AppIcon-512@2x.capacitor-default.png` に退避。
  2. iOS のスプラッシュ3枚を背景 #386641（`theme-color` と同色）＋中央にマイト 400px で再生成。旧ファイルは `backup/ios_splash_default/`。
  3. `Info.plist` に `ITSAppUsesNonExemptEncryption=false` を追加。アップロードのたびに暗号化の申告を手で答えなくて済む。
  4. IPA を展開して埋め込みアイコンが実物であることを確認済み（`pngcrush -revert-iphone-optimizations` で復元して目視）。
- **未対応**: Android のスプラッシュは青い X のまま。v170 が審査中のため触っていない。直すなら v171 として出し直す判断が要る。

## iOS の配信状況（2026-09-06 時点）

- App ID `6808987894`、バンドルID `com.akiplex.mitodiet`、チーム `8VX6T3795L`。
- **内部テスター**: グループ `Internal Testing`。`apple@akiplex.com`（未承諾）と `ikaubon6@gmail.com`。
  後者が平井さんの iPhone（12 Pro Max / iOS 26.6.1）で **build 171 をインストール済み**。
  ikaubon6@gmail.com は App Store Connect のユーザー（ロール Marketing）として追加してある。
- **外部テスター**: グループ `Friends and Family`。build 171 で**ベータ審査に提出済み**（2026-09-06 未明）。
  承認後に奥さんと東江さんをメールで招待する予定。**アドレスは未取得。**
- Test Information は入力済み（説明・フィードバック先 ikaubon6@gmail.com・審査連絡先・審査メモ）。
  プライバシーポリシーは `https://akiplex-studio.github.io/mito-diet/privacypolicy.html`。
  **`akiplex.com/mito-life/privacypolicy.html` は使わない** — 200 を返すが中身は Akiplex Studio のトップ。
- iPhone にあった旧開発版のデータ（9/3 の1日分）は `backup/ios_20260905_235909/` に退避済み。

## iOS のアイコン・スプラッシュが Capacitor の初期状態のままだった（2026-09-06 発覚・対応済み）
- ランチャーアイコンをマイトに差し替え（アダプティブ、背景 #386641）。
- アプリ名を「ミトコンドリア・ライフ」に統一: `strings.xml`、`capacitor.config.json`、`index.html`（title・フッター・通知タイトル・PWA name）、`privacypolicy.html`、iOS `Info.plist`。`scripts/i18n-scan.mjs` の ALLOW も更新。
- 残っている旧名（意図的に未変更）: `package.json` / `server/package.json` の description、プロジェクトの `CLAUDE.md` の見出し、`~/claude/CLAUDE.md` の目次行。
- 169 の AAB: `backup/mitodiet-169-release.aab`（index.html md5 8809db76…）。Play へのアップロードは平井さんの OK 待ち。
- 復元用ファイル: `backup/mito-data-2026-09-05.json`（7/6〜9/4、49日分、写真込み）。スマホの `/sdcard/Download/mito-data-2026-09-05.json` にも置いた。
