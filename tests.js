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
// speechKeyForCheck
eq('speechKeyForCheck juice', speechKeyForCheck('juice'), 'juice');
eq('speechKeyForCheck bodyweight', speechKeyForCheck('bodyweight'), 'training');
eq('speechKeyForCheck sugar', speechKeyForCheck('sugar'), 'sugar');
eq('speechKeyForCheck darknight', speechKeyForCheck('darknight'), 'darkNight');
eq('speechKeyForCheck hara7', speechKeyForCheck('hara7'), 'hara7');
eq('speechKeyForCheck unknown', speechKeyForCheck('nosake'), null);

// speechKeyForMeal
eq('speechKeyForMeal low score', speechKeyForMeal(20, null), 'mealBad');
eq('speechKeyForMeal low score beats overfull', speechKeyForMeal(20, '食べ過ぎ'), 'mealBad');
eq('speechKeyForMeal overfull beats high score', speechKeyForMeal(80, '食べ過ぎ'), 'tooFull');
eq('speechKeyForMeal high score', speechKeyForMeal(80, null), 'mealGood');
eq('speechKeyForMeal hara7 (腹七分目)', speechKeyForMeal(50, '腹七分目くらい'), 'hara7');
eq('speechKeyForMeal hara7 (軽め)', speechKeyForMeal(50, '軽め'), 'hara7');
eq('speechKeyForMeal none', speechKeyForMeal(50, null), null);
eq('speechKeyForMeal null score overfull', speechKeyForMeal(null, '食べ過ぎ'), 'tooFull');

// speechKeyForSteps
eq('speechKeyForSteps crosses goal', speechKeyForSteps(2000, 3000, 3000), 'walked');
eq('speechKeyForSteps already achieved', speechKeyForSteps(3000, 3500, 3000), null);
eq('speechKeyForSteps null prev crosses goal', speechKeyForSteps(null, 3000, 3000), 'walked');
eq('speechKeyForSteps still under goal', speechKeyForSteps(2000, 2999, 3000), null);

// speechKeyForSleep
eq('speechKeyForSleep crosses 7h', speechKeyForSleep(6, 7), 'slept');
eq('speechKeyForSleep already 7h+', speechKeyForSleep(7, 8), null);
eq('speechKeyForSleep null prev crosses 7h', speechKeyForSleep(null, 7.5), 'slept');
eq('speechKeyForSleep still under 7h', speechKeyForSleep(6, 6.5), null);

// pickSpeechIndex
eq('pickSpeechIndex avoids last', pickSpeechIndex(5, 2, 0.4), 3);
eq('pickSpeechIndex picks 0', pickSpeechIndex(5, 1, 0.0), 0);
eq('pickSpeechIndex len1 always 0', pickSpeechIndex(1, 0, 0.9), 0);

// SPEECH 辞書の網羅性: 10キーすべてに5本以上の文があること
const SPEECH_KEYS = ['juice','training','walked','sugar','mealGood','mealBad','hara7','tooFull','slept','darkNight'];
eq('SPEECH has all 10 keys', SPEECH_KEYS.every(k => Array.isArray(SPEECH[k])), true);
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

print(`RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) quit(1);
