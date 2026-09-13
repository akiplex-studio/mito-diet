/* i18n の取りこぼし検査。
   このアプリは index.html 1ファイル構成なので、辞書も index.html の
   @i18n-start 〜 @i18n-end ブロックに置いてある。ここから読み出して検査する。

   ja を唯一の正とし、翻訳した時点の日本語のハッシュを i18n.lock.json に持つ。
   日本語を直すとハッシュがズレるので「英語を直し忘れた」が必ず引っかかる。

   v1.72: 対応言語を en の1つから en/zh/ms の3つ（+ja）に広げた。
   ロックは言語ごとに持つ（{ en:{...}, zh:{...}, ms:{...} }）。
   zh/ms は翻訳待ち（PENDING）の間、「未翻訳」は警告に留めて exit 0 にする
   （stale/orphan/日本語の取り残しは通常どおり検査する）。

     npm run i18n:check              未翻訳／日本語が変わったのに英語(等)が古い／日本語側にないゴミ
     npm run i18n:accept              en のロックを更新する（既定）
     npm run i18n:accept -- --lang zh  zh のロックを更新する
*/
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'index.html';
const LOCK = 'i18n.lock.json';
const LANGS = ['en', 'zh', 'ms'];   // ja以外の翻訳対象言語
const PENDING = ['zh', 'ms'];       // 翻訳待ち：未翻訳(missing)は警告のみ（翻訳が入ったらここから外す）
// 意図的に日本語（ひらがな・カタカナ・全角記号）を含めてよいキー（言語名の併記など）
const LEAK_ALLOW = new Set(['ui.lang.title']);

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
const dicts = { en: I18N.en || {}, zh: I18N.zh || {}, ms: I18N.ms || {} };
const h = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
// ひらがな・カタカナ（「・」等の記号含む）・全角記号・全角英数の取り残し検査。
// 漢字（一-龥）は対象外（zhは漢字を使うため）
const LEAK_RE = /[぀-ヿ　-〿＀-￯]/;

/* ロックは言語ごとに { key: hash(ja[key]) } を持つ。
   旧形式（v1.71以前・enだけをフラットに持つ {key: hash}）を検出したら、
   enの内容を失わないようそのまま en: に移す（zh/msは空で始める）。 */
function loadLock() {
  if (!existsSync(LOCK)) return { en: {}, zh: {}, ms: {} };
  const raw = JSON.parse(readFileSync(LOCK, 'utf8'));
  const isOldFlat = !('en' in raw) && !('zh' in raw) && !('ms' in raw);
  if (isOldFlat) {
    return { en: raw, zh: {}, ms: {} };
  }
  return { en: raw.en || {}, zh: raw.zh || {}, ms: raw.ms || {} };
}
const lock = loadLock();

const argv = process.argv.slice(2);
if (argv.includes('--accept')) {
  const li = argv.indexOf('--lang');
  const lang = li >= 0 ? argv[li + 1] : 'en';
  if (!LANGS.includes(lang)) {
    console.error(`[i18n] --lang は ${LANGS.join('/')} のいずれかを指定してください（渡された値: ${lang}）`);
    process.exit(1);
  }
  lock[lang] = Object.fromEntries(Object.keys(ja).sort().map((k) => [k, h(ja[k])]));
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  console.log(`[i18n] ロックを更新しました（${lang}: ${Object.keys(lock[lang]).length}キー）`);
  process.exit(0);
}

const show = (label, list) => {
  if (!list.length) return;
  console.error(`\n[${label}] ${list.length}件`);
  for (const k of list) console.error(`  ${k}`);
};

let ng = 0;
let pendingMissingTotal = 0;
for (const lang of LANGS) {
  const dict = dicts[lang];
  const langLock = lock[lang] || {};
  const missing = [];   // 辞書に無い（未翻訳）
  const stale = [];     // 日本語が変わったのに古い
  const orphan = [];    // 日本語側にないゴミ
  const leaked = [];    // ひらがな・カタカナ・全角記号の取り残し

  for (const k of Object.keys(ja)) {
    if (!(k in dict)) missing.push(k);
    else if (langLock[k] !== h(ja[k])) stale.push(k);
  }
  for (const k of Object.keys(dict)) if (!(k in ja)) orphan.push(k);
  for (const [k, v] of Object.entries(dict)) {
    if (typeof v !== 'string' || LEAK_ALLOW.has(k)) continue;
    if (LEAK_RE.test(v)) leaked.push(k);
  }

  const isPending = PENDING.includes(lang);
  show(`${lang}: 未翻訳（辞書に無い）${isPending ? '（翻訳待ち・警告のみ）' : ''}`, missing);
  show(`${lang}: 日本語が変わったのに古い`, stale);
  show(`${lang}: 日本語側にないゴミ`, orphan);
  show(`${lang}: 日本語の取り残し（ひらがな・カタカナ・全角記号）`, leaked);

  if (isPending) pendingMissingTotal += missing.length;
  else ng += missing.length;
  ng += stale.length + orphan.length + leaked.length;
}

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
// data-i18n="key" / data-i18n-ph="key" / data-i18n-aria="key" / data-i18n-alt="key" / data-i18n-title="key"
const dataRe = /data-i18n(?:-[a-z]+)?=(["'])((?:(?!\1)[^\n])*)\1/g;
let mm;
while ((mm = tRe.exec(masked))) addKey(mm[1] ?? mm[2], mm.index);
while ((mm = tOrRe.exec(masked))) addKey(mm[1] ?? mm[2], mm.index);
while ((mm = dataRe.exec(masked))) addKey(mm[2], mm.index);
const undefinedKeys = [];
for (const [k, line] of usedKeys) if (!(k in ja)) undefinedKeys.push({ k, line });

if (undefinedKeys.length) {
  console.error(`\n[辞書に無いキーを参照している] ${undefinedKeys.length}件`);
  for (const { k, line } of undefinedKeys) console.error(`  ${SRC}:${line}  ${k}`);
}
ng += undefinedKeys.length;

if (ng === 0) {
  const pendingNote = pendingMissingTotal ? ` / 翻訳待ち（${PENDING.join('/')}）の未翻訳 ${pendingMissingTotal}件は警告のみ` : '';
  console.log(`[i18n] OK（ja ${Object.keys(ja).length}キー）${pendingNote}`);
} else {
  console.error('\n日本語(等)を直したら `npm run i18n:accept`（zh/msは `-- --lang zh` 等）でロックを更新してください。');
  if (undefinedKeys.length) {
    console.error('辞書に無いキーは I18N.ja / I18N.en 等に追加してください（文字列連結で組み立てるキーは対象外）。');
  }
}
process.exit(ng ? 1 : 0);
