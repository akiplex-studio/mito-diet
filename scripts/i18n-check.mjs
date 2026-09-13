/* i18n の取りこぼし検査。
   このアプリは index.html 1ファイル構成なので、辞書も index.html の
   @i18n-start 〜 @i18n-end ブロックに置いてある。ここから読み出して検査する。

   ja を唯一の正とし、翻訳した時点の日本語のハッシュを i18n.lock.json に持つ。
   日本語を直すとハッシュがズレるので「英語を直し忘れた」が必ず引っかかる。

     npm run i18n:check    未翻訳／日本語が変わったのに英語が古い／日本語側にないゴミ
     npm run i18n:accept   英語を直したらロックを更新する
*/
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'index.html';
const LOCK = 'i18n.lock.json';

const html = readFileSync(SRC, 'utf8');
const start = html.indexOf('/* @i18n-start');
const end = html.indexOf('/* @i18n-end */');
if (start < 0 || end < 0) {
  console.error(`[i18n] ${SRC} に @i18n-start / @i18n-end が見つかりません`);
  process.exit(1);
}
// ブロックを切り出して評価する（辞書はただのオブジェクトリテラル）
const block = html.slice(start, end);
const body = block.slice(block.indexOf('const I18N ='));
let I18N;
try {
  I18N = new Function(`${body.replace(/^const I18N =/, 'return')}`)();
} catch (e) {
  console.error('[i18n] 辞書を読み取れませんでした:', e.message);
  process.exit(1);
}

const ja = I18N.ja || {};
const en = I18N.en || {};
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : {};
const h = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 8);

if (process.argv.includes('--accept')) {
  const next = Object.fromEntries(Object.keys(ja).sort().map((k) => [k, h(ja[k])]));
  writeFileSync(LOCK, JSON.stringify(next, null, 2) + '\n');
  console.log(`[i18n] ロックを更新しました（${Object.keys(next).length}キー）`);
  process.exit(0);
}

const missing = [];   // 英語が無い
const stale = [];     // 日本語が変わったのに英語が古い
const orphan = [];    // 日本語側にないゴミ
for (const k of Object.keys(ja)) {
  if (!(k in en)) missing.push(k);
  else if (lock[k] !== h(ja[k])) stale.push(k);
}
for (const k of Object.keys(en)) if (!(k in ja)) orphan.push(k);

/* v1.73: t('リテラル') / tOr('リテラル', …) / data-i18n(-*)="…" で参照しているキーが、
   ja（唯一の正）に存在しない場合を検出する。
   missing/stale/orphan は「辞書の中身どうしの整合性」しか見ないため、
   t('存在しないキー') のように辞書に丸ごと無いキーを呼んでいても、これまでは検出できなかった
   （実際に ui.bd.energy / toast.notify.at がこの形で漏れ、画面に空文字が出ていた）。
   キーを文字列連結で組み立てる箇所（t('a.' + x) / tOr('a.' + x, 既定値)）は、
   キーが実行時にしか決まらないため対象外（検査の死角。呼び出し側でキーの実在を別途テストすること）。 */
const masked = html.slice(0, start) + html.slice(start, end).replace(/[^\n]/g, ' ') + html.slice(end);
const lineOf = (idx) => masked.slice(0, idx).split('\n').length;
const usedKeys = new Map(); // key -> 最初に見つかった行番号
const addKey = (key, idx) => { if (key && !usedKeys.has(key)) usedKeys.set(key, lineOf(idx)); };
// t('key') / t("key")  … キーがその場で完結しているものだけを拾う（連結は次の非空白が , や ) にならず自然に除外される）
const tRe = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*[,)]/g;
// tOr('key', fallback)
const tOrRe = /\btOr\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,/g;
// data-i18n="key" / data-i18n-ph="key" / data-i18n-aria="key" / data-i18n-alt="key"
const dataRe = /data-i18n(?:-[a-z]+)?=(["'])((?:(?!\1)[^\n])*)\1/g;
let mm;
while ((mm = tRe.exec(masked))) addKey(mm[1] ?? mm[2], mm.index);
while ((mm = tOrRe.exec(masked))) addKey(mm[1] ?? mm[2], mm.index);
while ((mm = dataRe.exec(masked))) addKey(mm[2], mm.index);
const undefinedKeys = [];
for (const [k, line] of usedKeys) if (!(k in ja)) undefinedKeys.push({ k, line });

const show = (label, list) => {
  if (!list.length) return;
  console.error(`\n[${label}] ${list.length}件`);
  for (const k of list) console.error(`  ${k}`);
};
show('未翻訳（英語が無い）', missing);
show('日本語が変わったのに英語が古い', stale);
show('日本語側にないゴミ', orphan);
if (undefinedKeys.length) {
  console.error(`\n[辞書に無いキーを参照している] ${undefinedKeys.length}件`);
  for (const { k, line } of undefinedKeys) console.error(`  ${SRC}:${line}  ${k}`);
}

const ng = missing.length + stale.length + orphan.length + undefinedKeys.length;
if (ng === 0) {
  console.log(`[i18n] OK（${Object.keys(ja).length}キー）`);
} else {
  console.error('\n英語を直したら `npm run i18n:accept` でロックを更新してください。');
  if (undefinedKeys.length) {
    console.error('辞書に無いキーは I18N.ja / I18N.en に追加してください（文字列連結で組み立てるキーは対象外）。');
  }
}
process.exit(ng ? 1 : 0);
