/* 英語化のし忘れを機械的に見つける検査。
   index.html のうち「画面に出る可能性のある日本語リテラル」を洗い出し、
   辞書(@i18n-start〜@i18n-end)を通していないものがあれば失敗する。

   これが無いと、開発を続けるうちに日本語が少しずつ混ざり、
   英語で使ったときだけ日本語が顔を出す——という状態になる（実際になった）。

     npm run i18n:scan            見つかったら失敗して一覧を出す
     npm run i18n:scan -- --list  失敗させずに一覧だけ見る

   除外するもの:
   - 辞書ブロックそのもの
   - 「古い保存データ向けの控え」のデータ定義（CATALOG/SPEECH/INFO 等）
     … 画面表示は itemName()/infoWhy()/speechLines() 経由で辞書から引くので、
        ここに日本語が残っていてよい
   - ALLOW に挙げた、日本語のままで正しいもの（言語名・保存値・ログ接頭辞）
*/
import { readFileSync } from 'node:fs';

const SRC = 'index.html';
const JA = /[ぁ-んァ-ヴ一-龥]/;

// 日本語のままで正しいもの
const ALLOW = [
  '日本語',                      // 言語の選択肢は両言語で出す
  'ミトコンドリア・ダイエット',   // アプリ名（PWAマニフェスト）
  'マイト',                      // キャラクター名（PWAマニフェストのshort_name）
  '軽め', '腹七分目くらい', '普通', '満腹', '食べ過ぎ',  // 保存される値（表示はfullnessLabel経由）
  '糖分に気を付ける',            // migrate: 旧データの名前を直すための比較文字列
  'ウォーキング', '歩数',        // migrate: 同上
  '万歩計（自動集計・手動チェックも可）',                // migrate: 同上
  '自己申告（判定曖昧のため一時停止）',                  // migrate: 廃止項目のmethod
  '自己申告（廃止・sugarCtrlに統合）',                   // migrate: 同上
];
// これらで始まる文字列は開発用のログなので対象外
const ALLOW_PREFIX = ['[i18n]', '[health]', '[reminder]', '[cap]'];

// 「控え」のデータ定義。画面表示は辞書経由なので中の日本語は許す
const DATA_BLOCKS = [
  'CATALOG', 'SPEECH', 'WHY_VARIANTS', 'INFO', 'BLURB', 'TUT_QUESTIONS', 'TUT_HELLO',
  'MECHANISMS', 'AUTO_ITEMS', 'RENAMED_V153', 'KNOWLEDGE',
  'FULLNESS_OPTS', 'FULLNESS_ICON', 'FULLNESS_KEY', 'HARA7_OK_FULLNESS',
  'STRENGTH_EFFORTS', 'CARDIO_EFFORTS', 'WALK_EFFORTS', 'HIIT_EFFORTS',
  'WALKING_EFFORTS', 'GENERIC_EFFORTS',
];

const src = readFileSync(SRC, 'utf8');

/** 対応する括弧まで飛ばして [start,end) を返す */
function blockRange(text, declRe) {
  const m = declRe.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return [start, i + 1];
    }
  }
  return null;
}

const skip = [];
const i18nStart = src.indexOf('/* @i18n-start');
const i18nEnd = src.indexOf('/* @i18n-end */');
if (i18nStart < 0 || i18nEnd < 0) {
  console.error(`[i18n-scan] ${SRC} に @i18n-start / @i18n-end が見つかりません`);
  process.exit(1);
}
skip.push([i18nStart, i18nEnd]);
for (const name of DATA_BLOCKS) {
  const r = blockRange(src, new RegExp(`const ${name} = [\\{\\[]`));
  if (r) skip.push(r);
}
skip.sort((a, b) => a[0] - b[0]);

// 除外区間を伏せ字にして、行番号を保ったまま走査する
let masked = src;
for (const [a, b] of skip) {
  masked = masked.slice(0, a) + masked.slice(a, b).replace(/[^\n]/g, ' ') + masked.slice(b);
}
const scriptAt = masked.indexOf('<script>');

const found = new Map();   // 文字列 → 最初に見つかった行番号
const lines = masked.split('\n');
let offset = 0;
for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const lineStart = offset;
  offset += raw.length + 1;
  if (lineStart < scriptAt) continue;              // HTML側は data-i18n で担保している
  const t = raw.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
  const code = raw.replace(/\/\/.*$/, '');
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(code))) {
    const v = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!v || !JA.test(v)) continue;
    if (ALLOW.includes(v)) continue;
    if (ALLOW_PREFIX.some((p) => v.startsWith(p))) continue;
    if (!found.has(v)) found.set(v, i + 1);
  }
}

if (found.size === 0) {
  console.log('[i18n-scan] OK（辞書を通していない日本語はありません）');
  process.exit(0);
}
console.error(`\n[i18n-scan] 辞書を通していない日本語が ${found.size}件あります\n`);
for (const [v, line] of found) {
  console.error(`  ${SRC}:${line}  ${v.length > 70 ? v.slice(0, 70) + '…' : v}`);
}
console.error(`
直し方:
  1. @i18n-start〜@i18n-end の I18N.ja と I18N.en に同じキーで日本語と英語を書く
  2. コード側を t('キー') に置き換える（HTMLなら data-i18n="キー"）
  3. npm run i18n:accept でロックを更新する
日本語のままで正しいもの（保存値・ログ）は scripts/i18n-scan.mjs の ALLOW に足してください。
`);
process.exit(process.argv.includes('--list') ? 0 : 1);
