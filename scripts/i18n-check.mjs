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

const show = (label, list) => {
  if (!list.length) return;
  console.error(`\n[${label}] ${list.length}件`);
  for (const k of list) console.error(`  ${k}`);
};
show('未翻訳（英語が無い）', missing);
show('日本語が変わったのに英語が古い', stale);
show('日本語側にないゴミ', orphan);

const ng = missing.length + stale.length + orphan.length;
if (ng === 0) {
  console.log(`[i18n] OK（${Object.keys(ja).length}キー）`);
} else {
  console.error('\n英語を直したら `npm run i18n:accept` でロックを更新してください。');
}
process.exit(ng ? 1 : 0);
