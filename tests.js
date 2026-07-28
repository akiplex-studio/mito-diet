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

/* --- v1.49: 選び直し（pickItem / unpickItem / 複数区間） --- */
eq('prevDate', prevDate('2026-07-01'), '2026-06-30');
eq('prevDate 年またぎ', prevDate('2027-01-01'), '2026-12-31');

// periods が無ければ activeFrom/activeUntil の1区間として扱う（移行前データ互換）
eq('itemPeriods 既定は1区間',
  itemPeriods({ activeFrom:'2026-07-01', activeUntil:null }), [{ from:'2026-07-01', until:null }]);

// 出戻り（禁酒→休肝日→また禁酒）を複数区間で表現できる
const comeback = { id:'nosake', periods:[
  { from:'2026-07-01', until:'2026-07-05' },
  { from:'2026-07-10', until:null },
] };
eq('複数区間 1つ目の中',   isItemActiveOn(comeback, '2026-07-03'), true);
eq('複数区間 すき間',      isItemActiveOn(comeback, '2026-07-07'), false);
eq('複数区間 2つ目の中',   isItemActiveOn(comeback, '2026-07-11'), true);

// 外すと「昨日まで有効」になる＝過去は残り、今日から効かない
const items1 = [{ id:'nosake', act:3, inc:0, periods:[{ from:'2026-07-01', until:null }] }];
unpickItem(items1, 'nosake', '2026-07-10');
eq('外した項目は配列から消えない', items1.length, 1);
eq('外しても前日までは有効', isItemActiveOn(items1[0], '2026-07-09'), true);
eq('外した当日から無効',     isItemActiveOn(items1[0], '2026-07-10'), false);

// 選ぶと今日から有効になる（過去には遡らない）
const items2 = [];
pickItem(items2, { id:'restday', act:2, inc:0 }, '2026-07-10');
eq('選んだ項目が追加される', items2.length, 1);
eq('選ぶ前日は無効', isItemActiveOn(items2[0], '2026-07-09'), false);
eq('選んだ当日から有効', isItemActiveOn(items2[0], '2026-07-10'), true);

// 選び直し（外して→また選ぶ）で、すき間だけが無効になる
const items3 = [{ id:'nosake', act:3, inc:0, periods:[{ from:'2026-07-01', until:null }] }];
unpickItem(items3, 'nosake', '2026-07-05');
pickItem(items3, { id:'nosake', act:3, inc:0 }, '2026-07-20');
eq('出戻り 最初の期間は有効', isItemActiveOn(items3[0], '2026-07-03'), true);
eq('出戻り すき間は無効',     isItemActiveOn(items3[0], '2026-07-10'), false);
eq('出戻り 再開後は有効',     isItemActiveOn(items3[0], '2026-07-21'), true);

// 今日追加して今日外す＝空区間は残さない
const items4 = [];
pickItem(items4, { id:'bath', act:2, inc:0 }, '2026-07-10');
unpickItem(items4, 'bath', '2026-07-10');
eq('同日に追加＆解除しても有効にならない', isItemActiveOn(items4[0], '2026-07-10'), false);
eq('同日に追加＆解除で空区間を残さない', items4[0].periods.length, 0);

// 既に有効なものを選び直しても区間は増えない
const items5 = [{ id:'juice', act:2, inc:0.1, periods:[{ from:'2026-07-01', until:null }] }];
pickItem(items5, { id:'juice', act:2, inc:0.1 }, '2026-07-10');
eq('有効な項目を再選択しても区間は増えない', items5[0].periods.length, 1);

/* --- v1.49: 選び直しても過去の集計が変わらないこと（設計の本丸） --- */
const swapDays = {
  '2026-07-01': { checked:['nosake'] },
  '2026-07-02': { checked:['nosake'] },
};
const swapItems = [{ id:'nosake', act:20, inc:3, periods:[{ from:'2026-07-01', until:null }] }];
const swapBefore = computeState({ startDate:'2026-07-01', items:swapItems, days:swapDays }, '2026-07-02');
// 7/3に禁酒をやめて休肝日へ
unpickItem(swapItems, 'nosake', '2026-07-03');
pickItem(swapItems, { id:'restday', act:15, inc:2 }, '2026-07-03');
const swapAfter = computeState({ startDate:'2026-07-01', items:swapItems, days:swapDays }, '2026-07-02');
eq('入れ替え後も過去の活性が同じ', swapAfter.activation, swapBefore.activation);
eq('入れ替え後も過去の匹数が同じ', swapAfter.mito, swapBefore.mito);

/* --- v1.50: 強度（しきい値）も期間ごとに持つ --- */
// 目標歩数を上げても、過去は当時の基準で判定されること
const thItems = [{ id:'walk', act:2, inc:1, auto:'steps', threshold:3000,
                   periods:[{ from:'2026-07-01', until:null }] }];
const thDays = { '2026-07-01': { steps:3500 }, '2026-07-02': { steps:3500 } };
const thBefore = computeState({ startDate:'2026-07-01', items:thItems, days:thDays }, '2026-07-02');
setItemThreshold(thItems, 'walk', 10000, '2026-07-03');
const thAfter = computeState({ startDate:'2026-07-01', items:thItems, days:thDays }, '2026-07-02');
eq('目標を上げても過去の匹数が変わらない', thAfter.mito, thBefore.mito);
eq('目標を上げても過去の活性が変わらない', thAfter.activation, thBefore.activation);
eq('項目の現在値は新しい基準', thItems[0].threshold, 10000);
eq('閉じた期間に当時の基準が焼き付く', thItems[0].periods[0].threshold, 3000);

// itemForDate はその日の基準を返す
eq('itemForDate 過去は旧基準', itemForDate(thItems[0], '2026-07-02').threshold, 3000);
eq('itemForDate 今日は新基準', itemForDate(thItems[0], '2026-07-03').threshold, 10000);
eq('itemForDate 無効な日はnull', itemForDate(thItems[0], '2026-06-30'), null);

// 新しい基準は変更日から効く（3,500歩は10,000歩の目標では未達成）
const thDays2 = { '2026-07-01': { steps:3500 }, '2026-07-03': { steps:3500 } };
const thState = computeState({ startDate:'2026-07-01', items:thItems, days:thDays2 }, '2026-07-03');
eq('変更後は新基準で判定される（3500歩では未達成）',
  evalDay({ steps:3500 }, thItems, '2026-07-03').actSum, 0);
eq('変更前は旧基準で判定される（3500歩で達成）',
  evalDay({ steps:3500 }, thItems, '2026-07-01').actSum, 2);

// 同じ日に2回変えても期間が増えない
setItemThreshold(thItems, 'walk', 8000, '2026-07-03');
eq('同日に変え直しても期間は増えない', thItems[0].periods.length, 2);
eq('同日の変更は上書きされる', itemForDate(thItems[0], '2026-07-03').threshold, 8000);

/* --- v1.50: 食べたものを記録する（自動判定） --- */
eq('mealRec 記録ゼロ', countMealRecords({}), 0);
eq('mealRec 写真1食', countMealRecords({ photos:{ breakfast:[{data:'x'}], lunch:[], dinner:[] } }), 1);
eq('mealRec ことばの記録も1食',
  countMealRecords({ mealAnalysis:{ breakfast:{ fullness:'普通' }, lunch:null, dinner:null } }), 1);
eq('mealRec 写真とことばの重複は1食',
  countMealRecords({ photos:{ breakfast:[{data:'x'}], lunch:[], dinner:[] },
                     mealAnalysis:{ breakfast:{ fullness:'普通' }, lunch:null, dinner:null } }), 1);
const mrItem = { id:'mealrec', act:2, inc:0, auto:'mealRec', threshold:2 };
eq('mealRec 1食では未達成', isItemDone(mrItem, { photos:{ breakfast:[{data:'x'}], lunch:[], dinner:[] } }), false);
eq('mealRec 2食で達成',
  isItemDone(mrItem, { photos:{ breakfast:[{data:'x'}], lunch:[{data:'y'}], dinner:[] } }), true);

/* --- v1.50: 睡眠は本人が選んだ必要時間を下回った日が減点 --- */
const slp = { id:'sleeplack', act:-8, inc:0, auto:'sleepLack', threshold:8 };
eq('睡眠 8時間必要な人の7時間は減点', isItemDone(slp, { sleepHours:7 }), true);
eq('睡眠 8時間必要な人の8時間はセーフ', isItemDone(slp, { sleepHours:8 }), false);
const slp5 = { id:'sleeplack', act:-8, inc:0, auto:'sleepLack', threshold:5 };
eq('睡眠 5時間で足りる人の5.5時間はセーフ', isItemDone(slp5, { sleepHours:5.5 }), false);
eq('睡眠 未記録は減点しない', isItemDone(slp5, { sleepHours:null }), false);

/* --- v1.52: 体重は「その日に測った値」だけを採る（前の日の値を持ち越さない） ---
   実機で起きた不具合: readSamplesにlimit:1と降順を同時に渡すと窓のいちばん古い記録が返り、
   6/30の78.5が毎日の体重として入り続けていた。並べ替えはプラグイン任せにしない。 */
// サンプルの時刻はUTC文字列で来る。どのタイムゾーンで走らせても同じ結果になるよう、
// 「その土地の朝7時台」をローカル時刻から組み立てる（ヘルスデータは瞬間で届き、日付は現地で決まる）
const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm).toISOString();
const wSamples = [
  { value: 78.5,  startDate: at(2026, 7,  1, 7, 51) },  // 古い記録（別の日）
  { value: 80.2,  startDate: at(2026, 7, 27, 7, 52) },
  { value: 79.7,  startDate: at(2026, 7, 28, 7, 38) },
];
eq('体重 その日に測った値を採る', pickWeightForDate(wSamples, '2026-07-28'), 79.7);
eq('体重 別の日の値は採らない', pickWeightForDate(wSamples, '2026-07-27'), 80.2);
eq('体重 測っていない日はnull', pickWeightForDate(wSamples, '2026-07-25'), null);
eq('体重 並び順が古い順でも最新を選ぶ',
  pickWeightForDate([{ value: 70.1, startDate: at(2026, 7, 28, 8, 10) },
                     { value: 70.9, startDate: at(2026, 7, 28, 21, 0) }], '2026-07-28'), 70.9);
eq('体重 サンプルなしはnull', pickWeightForDate([], '2026-07-28'), null);
eq('体重 配列でなくてもnull', pickWeightForDate(null, '2026-07-28'), null);
eq('体重 値が数値でない行は無視', pickWeightForDate([{ value:'x', startDate: at(2026, 7, 28, 9, 0) }], '2026-07-28'), null);

print(`RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) quit(1);
