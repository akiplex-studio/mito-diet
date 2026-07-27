/* 育成ロジックのユニットテスト（jsc実行・logic.jsの後に連結） */
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; print(`FAIL: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
}

/* --- regress: 毎朝50へ30%戻す --- */
eq('regress(80)=71', regress(80), 71);
eq('regress(20)=29', regress(20), 29);
eq('regress(50)=50', regress(50), 50);

/* --- mitoStep --- */
// 活性62 → 基礎+2、運動増加なし
eq('mitoStep base+2', mitoStep(100, 100, 62, 0), 102);
// 活性50 → 基礎+1
eq('mitoStep base+1', mitoStep(100, 100, 50, 0), 101);
// 活性40 → 基礎0・減少-2
eq('mitoStep dec-2', mitoStep(100, 100, 40, 0), 98);
// 活性10 → 減少-10
eq('mitoStep dec-10', mitoStep(100, 100, 10, 0), 90);
// 下限10: 12匹で-10されても10で止まる
eq('mitoStep floor10', mitoStep(12, 12, 5, 0), 10);
// 既に10未満（序盤）は減少しない
eq('mitoStep below floor keeps', mitoStep(3, 3, 5, 0), 3);
// メモリー: peak40の半分以下(15)なら増加2倍 → base2*2=4
eq('mitoStep memory x2', mitoStep(15, 40, 70, 0), 19);
// メモリー: 半分超(21)なら等倍
eq('mitoStep no memory', mitoStep(21, 40, 70, 0), 23);
// 上限5000
eq('mitoStep cap5000', mitoStep(4999, 4999, 70, 100), 5000);
// 小数の増加
eq('mitoStep fractional', mitoStep(1, 1, 50, 0.1), 2.1);

/* --- evalDay / isItemDone --- */
const items = [
  { id:'juice', act:2, inc:0.1 },
  { id:'walk',  act:2, inc:1, auto:'steps', threshold:3000 },
  { id:'lack',  act:-8, inc:0, auto:'sleepLack', threshold:6 },
  { id:'train', act:6, inc:15 },
];
eq('evalDay empty', evalDay({}, items), { actSum:0, incSum:0, points:0 });
eq('evalDay juice', evalDay({ checked:['juice'] }, items), { actSum:2, incSum:0.1, points:2 });
eq('evalDay steps auto', evalDay({ steps:6000 }, items).actSum, 2);
eq('evalDay steps under', evalDay({ steps:2999 }, items).actSum, 0);
eq('evalDay sleep lack', evalDay({ sleepHours:5 }, items).actSum, -8);
eq('evalDay sleep ok', evalDay({ sleepHours:7.5 }, items).actSum, 0);
eq('evalDay sleep empty no NG', evalDay({ sleepHours:null }, items).actSum, 0);
eq('evalDay sleep zero no NG', evalDay({ sleepHours:0 }, items).actSum, 0);

/* --- computeState 通しシナリオ --- */
// 日付ヘルパ
eq('nextDate', nextDate('2026-06-30'), '2026-07-01');
eq('nextDate year', nextDate('2026-12-31'), '2027-01-01');

// 初日: 野菜ジュースのみ → 活50+2=52 → 基礎+1・増0.1 → 匹1+1.1=2.1
const db1 = { startDate:'2026-07-01', items, days:{ '2026-07-01': { checked:['juice'] } } };
const s1 = computeState(db1, '2026-07-01');
eq('day1 activation', s1.activation, 52);
eq('day1 mito', s1.mito, 2.1);
eq('day1 points', s1.perDay['2026-07-01'].points, 2);

// 2日目: 何もしない → 回帰 52→51、基礎+1 → 3.1
const s2 = computeState(db1, '2026-07-02');
eq('day2 idle activation', s2.activation, 51);
eq('day2 idle mito', s2.mito, 3.1);

// 悪い日: 睡眠5h → 初日 50-8=42 → 減少-2だが下限未満スタートなので1のまま
const db3 = { startDate:'2026-07-01', items, days:{ '2026-07-01': { sleepHours:5 } } };
const s3 = computeState(db3, '2026-07-01');
eq('bad day activation', s3.activation, 42);
eq('bad day mito keeps (below floor)', s3.mito, 1);
eq('bad day points', s3.perDay['2026-07-01'].points, -8);

// 記録が startDate より前にあっても拾う
const db4 = { startDate:'2026-07-03', items, days:{ '2026-07-01': { checked:['juice'] } } };
eq('earlier record included', computeState(db4, '2026-07-03').perDay['2026-07-01'].points, 2);

// 1日の活性変動キャップ(±30): 巨大スコア項目でも +30 まで
const bigItems = [{ id:'big', act:99, inc:0 }];
const db5 = { startDate:'2026-07-01', items:bigItems, days:{ '2026-07-01': { checked:['big'] } } };
eq('day delta capped', computeState(db5, '2026-07-01').activation, 80);

// 活性の0-100クランプ
const db6 = { startDate:'2026-07-01', items:bigItems,
  days:{ '2026-07-01':{checked:['big']}, '2026-07-02':{checked:['big']}, '2026-07-03':{checked:['big']} } };
eq('activation clamped 100', computeState(db6, '2026-07-03').activation, 100);

// トレーニング連日 → peak 上昇、その後放置でも下限とメモリーが機能するか（暴走しない）
const days7 = {};
let d = '2026-07-01';
for (let i = 0; i < 10; i++) { days7[d] = { checked:['train'], steps:6000 }; d = nextDate(d); }
const s7 = computeState({ startDate:'2026-07-01', items, days: days7 }, '2026-09-01');
eq('long run finite', Number.isFinite(s7.mito) && s7.mito > 10, true);
eq('peak >= mito', s7.peak >= s7.mito, true);

/* --- v1.5: ミトの一言（状況キー判定） --- */
// speechKeyForCheck（v1.30: item.idとSPEECHキーを統一。無いキーはnull）
eq('speechKeyForCheck juice', speechKeyForCheck('juice'), 'juice');
eq('speechKeyForCheck bodyweight', speechKeyForCheck('bodyweight'), 'bodyweight');
eq('speechKeyForCheck sugar', speechKeyForCheck('sugar'), 'sugar');
eq('speechKeyForCheck darknight (廃止項目・キー無し)', speechKeyForCheck('darknight'), null);
eq('speechKeyForCheck hara7', speechKeyForCheck('hara7'), 'hara7');
eq('speechKeyForCheck nosake', speechKeyForCheck('nosake'), 'nosake');
eq('speechKeyForCheck unknown', speechKeyForCheck('nonexistent-item'), null);

// speechKeyForMeal
eq('speechKeyForMeal low score', speechKeyForMeal(20, null), 'mealBad');
eq('speechKeyForMeal low score beats overfull', speechKeyForMeal(20, '食べ過ぎ'), 'mealBad');
eq('speechKeyForMeal overfull beats high score', speechKeyForMeal(80, '食べ過ぎ'), 'tooFull');
eq('speechKeyForMeal high score', speechKeyForMeal(80, null), 'mealGood');
eq('speechKeyForMeal hara7 (腹七分目)', speechKeyForMeal(50, '腹七分目くらい'), 'hara7');
eq('speechKeyForMeal hara7 (軽め)', speechKeyForMeal(50, '軽め'), 'hara7');
eq('speechKeyForMeal 普通 is not hara7', speechKeyForMeal(50, '普通'), 'mealOk');
eq('countHara7Meals excludes 普通', countHara7Meals({ mealAnalysis: { breakfast:{fullness:'普通'}, lunch:{fullness:'軽め'}, dinner:{fullness:'普通'} } }), 1);
eq('speechKeyForMeal none', speechKeyForMeal(50, null), 'mealOk');  // v1.37: 無反応をやめ、必ず一言返す
eq('speechKeyForMeal null score overfull', speechKeyForMeal(null, '食べ過ぎ'), 'tooFull');

// mealSpeechText（v1.33: good_points/adviceを使った具体的なミトコメント）
const msGood = mealSpeechText({ mito_score: 80, good_points: ['野菜がしっかり摂れています'] }, null, 0);
eq('mealSpeechText good includes good_point', msGood.text.includes('野菜がしっかり摂れています'), true);
eq('mealSpeechText good key', msGood.key, 'mealGood');
const msBad = mealSpeechText({ mito_score: 10, advice: '揚げ物を控えましょう' }, null, 0);
eq('mealSpeechText bad includes advice', msBad.text.includes('揚げ物を控えましょう'), true);
eq('mealSpeechText bad key', msBad.key, 'mealBad');
eq('mealSpeechText mid score returns mealOk', mealSpeechText({ mito_score: 50 }, null, 0).key, 'mealOk');
const msNoDetail = mealSpeechText({ mito_score: 80 }, null, 0);
eq('mealSpeechText good with no good_points falls back to lead only', msNoDetail.text.includes('\n'), false);
const msLong = mealSpeechText({ mito_score: 10, advice: 'あ'.repeat(60) }, null, 0);
eq('mealSpeechText truncates long advice', msLong.text.length < 60 + 10, true);

// v1.30: speechKeyForSteps は廃止（歩数の達成判定はcheckAutoAchievements経由のitem.idキーに統一）

// speechKeyForSleep
eq('speechKeyForSleep crosses 7h', speechKeyForSleep(6, 7), 'slept');
eq('speechKeyForSleep already 7h+', speechKeyForSleep(7, 8), null);
eq('speechKeyForSleep null prev crosses 7h', speechKeyForSleep(null, 7.5), 'slept');
eq('speechKeyForSleep still under 7h', speechKeyForSleep(6, 6.5), null);

// pickSpeechIndex
eq('pickSpeechIndex avoids last', pickSpeechIndex(5, 2, 0.4), 3);
eq('pickSpeechIndex picks 0', pickSpeechIndex(5, 1, 0.0), 0);
eq('pickSpeechIndex len1 always 0', pickSpeechIndex(1, 0, 0.9), 0);

// SPEECH 辞書の網羅性: 14キーすべてに5本以上の文があること（v1.30: 達成系はitem.idキーに統一）
const SPEECH_KEYS = ['walk','bodyweight','protein','hara7','juice','nosake','meditate','sugarCtrl','sugar','mealGood','mealBad','tooFull','slept','darkNight'];
eq('SPEECH has all 14 keys', SPEECH_KEYS.every(k => Array.isArray(SPEECH[k])), true);
eq('SPEECH each key has >=5 lines', SPEECH_KEYS.every(k => SPEECH[k] && SPEECH[k].length >= 5), true);

/* --- v1.6: sortTodoItems（TODOの並び替え。未チェック→order順、チェック済みは下のブロックへ） --- */
const todoA = { id:'a', order:2 };
const todoB = { id:'b', order:1 };
const todoC = { id:'c', order:3 };
const todoItems = [todoA, todoB, todoC];

// 全て未チェック → order 順
eq('sortTodoItems all unchecked → order順',
  sortTodoItems(todoItems, []).map(it => it.id), ['b', 'a', 'c']);

// 一部チェック済み → 未チェックが先・チェック済みが後・各ブロックorder順
eq('sortTodoItems partial checked → unchecked先・checked後、各ブロックorder順',
  sortTodoItems(todoItems, ['a']).map(it => it.id), ['b', 'c', 'a']);

// checkedIds が undefined でも壊れない
eq('sortTodoItems checkedIds undefined',
  sortTodoItems(todoItems, undefined).map(it => it.id), ['b', 'a', 'c']);

// checkedIds が空配列でも壊れない
eq('sortTodoItems checkedIds empty array',
  sortTodoItems(todoItems, []).map(it => it.id), ['b', 'a', 'c']);

// 元配列を破壊しない（slice確認）
const todoItemsCopy = [todoA, todoB, todoC];
sortTodoItems(todoItemsCopy, ['b']);
eq('sortTodoItems does not mutate original array',
  todoItemsCopy.map(it => it.id), ['a', 'b', 'c']);

// NG行動は「未チェック通常 → 未チェックNG → チェック済み」の3ブロック順
const todoNG = { id:'ng1', order:90, ng:true };
eq('sortTodoItems NG below unchecked, above checked',
  sortTodoItems([todoA, todoNG, todoB], ['b']).map(it => it.id), ['a', 'ng1', 'b']);
eq('sortTodoItems checked NG goes to done block',
  sortTodoItems([todoA, todoNG, todoB], ['ng1']).map(it => it.id), ['b', 'a', 'ng1']);

/* --- v1.8: バックアップ促し（daysBetween / backupNudge） --- */
eq('daysBetween 7日', daysBetween('2026-07-01', '2026-07-08'), 7);
eq('daysBetween 同日', daysBetween('2026-07-11', '2026-07-11'), 0);

eq('backupNudge 記録3日未満は促さない',
  backupNudge({ days: { a:1, b:1 } }, '2026-07-11'), null);
eq('backupNudge 未書き出し',
  backupNudge({ days: { a:1, b:1, c:1 } }, '2026-07-11'), { kind:'never' });
eq('backupNudge 6日経過は促さない',
  backupNudge({ days: { a:1, b:1, c:1 }, lastExport:'2026-07-05' }, '2026-07-11'), null);
eq('backupNudge 7日経過は促す',
  backupNudge({ days: { a:1, b:1, c:1 }, lastExport:'2026-07-04' }, '2026-07-11'), { kind:'stale', days:7 });

/* --- v1.49: がんばり度（5段階） --- */
const strengthEfforts = [
  { label:'ちょっとだけ', inc:1 }, { label:'軽め', inc:2 }, { label:'ふつう', inc:4 },
  { label:'しっかり', inc:6 }, { label:'追い込んだ', inc:8 },
];
const bw = { id:'bw', act:6, inc:4, efforts:strengthEfforts };

// efforts を持たない項目は従来どおり（既存ユーザーの項目が変わらないことの担保）
eq('effort 無し項目は素の値', itemEffect({ id:'x', act:6, inc:15 }, { checked:['x'] }), { act:6, inc:15 });
eq('effort 無し項目は段階-1', effortIndexFor({ id:'x', act:6, inc:15 }, {}), -1);

// 本人が選んだ段階が効く
eq('effort ちょっとだけ', itemEffect(bw, { effort:{ bw:0 } }), { act:6, inc:1 });
eq('effort ふつう',       itemEffect(bw, { effort:{ bw:2 } }), { act:6, inc:4 });
eq('effort 追い込んだ',   itemEffect(bw, { effort:{ bw:4 } }), { act:6, inc:8 });
// 活性は段階によらず一定（匹数だけを変える設計）
eq('effort 活性は段階で変わらない',
  itemEffect(bw, { effort:{ bw:0 } }).act, itemEffect(bw, { effort:{ bw:4 } }).act);

// 未記録・不正値は「ふつう」に寄せる
eq('effort 未記録はふつう',   itemEffect(bw, {}), { act:6, inc:4 });
eq('effort 範囲外はふつう',   itemEffect(bw, { effort:{ bw:99 } }), { act:6, inc:4 });
eq('effort 文字列はふつう',   itemEffect(bw, { effort:{ bw:'つよい' } }), { act:6, inc:4 });

// 歩数はデータから段階が決まる（本人に聞かない）
const walkEfforts = [
  { label:'3,000歩', min:3000, inc:0.5 }, { label:'5,000歩', min:5000, inc:1 },
  { label:'8,000歩', min:8000, inc:1.5 }, { label:'10,000歩', min:10000, inc:2 },
  { label:'15,000歩', min:15000, inc:3 },
];
const wk = { id:'wk', act:2, inc:0.5, auto:'steps', threshold:3000, manualFallback:true,
             efforts:walkEfforts, effortFrom:'steps' };
eq('effort 歩数3000は最小段階', itemEffect(wk, { steps:3000 }).inc, 0.5);
eq('effort 歩数8000',          itemEffect(wk, { steps:8000 }).inc, 1.5);
eq('effort 歩数20000は最大段階', itemEffect(wk, { steps:20000 }).inc, 3);
// 手動チェック（歩数0）でも最小段階として扱う＝申告だけで満額もらえてしまわない
eq('effort 手動チェックは最小段階', itemEffect(wk, { steps:0, checked:['wk'] }).inc, 0.5);

// evalDay ががんばり度を反映する
eq('evalDay がんばり度を反映',
  evalDay({ checked:['bw'], effort:{ bw:4 } }, [bw]), { actSum:6, incSum:8, points:6 });
eq('evalDay がんばり度ちょっとだけ',
  evalDay({ checked:['bw'], effort:{ bw:0 } }, [bw]), { actSum:6, incSum:1, points:6 });

/* --- v1.49: manualFallback の汎用化（auto==='steps' 限定をやめた） --- */
// 歩数はしきい値でこれまでどおり自動達成
eq('manualFallback steps しきい値で達成',
  isItemDone({ id:'w', auto:'steps', threshold:3000, manualFallback:true }, { steps:3000 }), true);
// 歩数が足りなくても、manualFallback があれば手動チェックで達成にできる
eq('manualFallback steps 手動チェックで達成',
  isItemDone({ id:'w', auto:'steps', threshold:3000, manualFallback:true }, { steps:0, checked:['w'] }), true);
// 歩数で判定できない種目（スイミング等）も manualFallback だけで達成にできる
eq('manualFallback 自動判定できない種目も手動で達成',
  isItemDone({ id:'swim', auto:'minutes', manualFallback:true }, { checked:['swim'] }), true);
// manualFallback が無い自動判定項目は、手動チェックしても達成にならない（タンパク質・腹七分目など）
eq('manualFallback 無しは手動チェックでも達成しない',
  isItemDone({ id:'protein', auto:'protein', threshold:1.6 }, { checked:['protein'], weight:60 }), false);
// 手動項目（autoなし）は従来どおりチェックだけで達成
eq('manualFallback 手動項目は従来どおり',
  isItemDone({ id:'m' }, { checked:['m'] }), true);

/* --- v1.49: 項目の有効期間（activeFrom / activeUntil） --- */
// 未設定なら常に有効（＝移行前のデータで挙動が変わらないことの担保）
eq('active 未設定は常に有効', isItemActiveOn({ id:'x' }, '2026-07-01'), true);
eq('active 日付未指定なら有効', isItemActiveOn({ id:'x', activeFrom:'2026-07-05' }, undefined), true);
eq('active itemがnullなら無効', isItemActiveOn(null, '2026-07-01'), false);

// activeFrom は境界を含む
eq('active from 前日は無効', isItemActiveOn({ activeFrom:'2026-07-05' }, '2026-07-04'), false);
eq('active from 当日は有効', isItemActiveOn({ activeFrom:'2026-07-05' }, '2026-07-05'), true);
eq('active from 翌日は有効', isItemActiveOn({ activeFrom:'2026-07-05' }, '2026-07-06'), true);

// activeUntil も境界を含む
eq('active until 当日は有効', isItemActiveOn({ activeUntil:'2026-07-05' }, '2026-07-05'), true);
eq('active until 翌日は無効', isItemActiveOn({ activeUntil:'2026-07-05' }, '2026-07-06'), false);

// 期間の両端を持つ場合
const spanItem = { activeFrom:'2026-07-05', activeUntil:'2026-07-07' };
eq('active span 開始前', isItemActiveOn(spanItem, '2026-07-04'), false);
eq('active span 期間内', isItemActiveOn(spanItem, '2026-07-06'), true);
eq('active span 終了後', isItemActiveOn(spanItem, '2026-07-08'), false);

// evalDay が有効期間でフィルタする
const datedItems = [
  { id:'old', act:5, inc:2, activeUntil:'2026-07-05' },   // 7/5で終了
  { id:'new', act:3, inc:1, activeFrom:'2026-07-06' },    // 7/6から開始
];
const bothChecked = { checked:['old', 'new'] };
eq('evalDay 日付なしは全項目（従来どおり）',
  evalDay(bothChecked, datedItems), { actSum:8, incSum:3, points:8 });
eq('evalDay 切替前は旧項目だけ',
  evalDay(bothChecked, datedItems, '2026-07-05'), { actSum:5, incSum:2, points:5 });
eq('evalDay 切替後は新項目だけ',
  evalDay(bothChecked, datedItems, '2026-07-06'), { actSum:3, incSum:1, points:3 });

/* --- v1.49: 項目を差し替えても過去の匹数・活性が変わらないこと（本丸の回帰テスト） --- */
// 7/1〜7/3 は old をチェックして育てた記録
const histDays = {
  '2026-07-01': { checked:['old'] },
  '2026-07-02': { checked:['old'] },
  '2026-07-03': { checked:['old'] },
};
// 差し替え前: old だけが存在
const beforeSwap = computeState(
  { startDate:'2026-07-01', items:[{ id:'old', act:20, inc:3 }], days:histDays }, '2026-07-03');
// 差し替え後: 7/3で old を終了させ、7/4から new を開始（過去日の定義は変えない）
const afterSwap = computeState({
  startDate:'2026-07-01',
  items:[
    { id:'old', act:20, inc:3, activeUntil:'2026-07-03' },
    { id:'new', act:20, inc:3, activeFrom:'2026-07-04' },
  ],
  days: histDays,
}, '2026-07-03');
eq('差し替えても過去の活性が変わらない', afterSwap.activation, beforeSwap.activation);
eq('差し替えても過去の匹数が変わらない', afterSwap.mito, beforeSwap.mito);
eq('差し替えても過去のピークが変わらない', afterSwap.peak, beforeSwap.peak);

// 有効期間を閉じた項目は、その後の日には効かない
const afterEnd = computeState({
  startDate:'2026-07-01',
  items:[{ id:'old', act:20, inc:3, activeUntil:'2026-07-03' }],
  days: { ...histDays, '2026-07-04': { checked:['old'] } },
}, '2026-07-04');
// 7/4は加点されないので、活性は回帰のみ（7/3時点から50へ30%戻る）
eq('終了後はチェックしても加点されない', afterEnd.activation, regress(beforeSwap.activation));

print(`RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) quit(1);
