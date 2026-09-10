const {test, expect} = require('@playwright/test');
const {skipOnboarding} = require('./helpers');

test('a meal saves offline, earns food immediately and feeding survives reload', async ({page}) => {
  await skipOnboarding(page);
  await page.route('**/api/**', route => route.abort());
  await page.goto('/index.html');
  const before = await page.evaluate(() => ({bank:careBalance(DB.care), mito:computed.mito}));
  await page.locator('#careRecord').click();
  await page.locator('#addChoiceText').click();
  await page.locator('#mealNote').fill('Rice and salmon');
  await page.locator('#mealSave').click();
  await expect(page.locator('#tabHome')).toBeVisible();
  expect(await page.evaluate(() => careBalance(DB.care))).toBe(before.bank+3);
  expect(await page.evaluate(() => computed.mito)).toBe(before.mito);
  await page.locator('#careFeed').click();
  expect(await page.evaluate(() => computed.mito)).toBe(before.mito+1);
  await page.reload();
  expect(await page.evaluate(() => computed.mito)).toBe(before.mito+1);
  expect(await page.evaluate(() => careBalance(DB.care))).toBe(before.bank);
});

test('new onboarding earns food from yesterday without profile or network', async ({page}) => {
  await page.route('**/api/**', route => route.abort());
  await page.goto('/index.html');
  await page.locator('.tut-choice', {hasText:'English'}).click();
  await page.locator('#carePurpose button').filter({hasText:'Keep healthy habits'}).click();
  await page.locator('#tutNext').click();
  const yesterday = await page.evaluate(() => prevDate(today));
  await page.locator('#careMealDate').fill(yesterday);
  await page.locator('#careMealNote').fill('Noodles with vegetables');
  await page.locator('#tutNext').click();
  expect(await page.evaluate(() => careBalance(DB.care))).toBe(3);
  await page.locator('#tutNext').click();
  await expect(page.locator('#tutBody')).toContainText('Your first new friend');
  await page.locator('#tutNext').click();
  await expect(page.locator('#tutorial')).toBeHidden();
  expect(await page.evaluate(day => DB.days[day].mealAnalysis.dinner.note, yesterday)).toBe('Noodles with vegetables');
  expect(await page.evaluate(() => DB.profile.heightCm)).toBe(null);
  expect(await page.evaluate(() => DB.profile.targetRatio)).toBe(1);
  expect(await page.evaluate(() => DB.items.filter(it => ['hara7','nightfast','sugarCtrl'].includes(it.id) && isItemActiveOn(it,today)).length)).toBe(0);
  await page.reload();
  await expect(page.locator('#tutorial')).toBeHidden();
  expect(await page.evaluate(() => careFed(DB.care))).toBe(3);
});

test('practice can resume without creating a meal or duplicating food', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('.tut-choice', {hasText:'English'}).click();
  await page.locator('#carePurpose button').last().click();
  await page.locator('#tutNext').click();
  await page.locator('#carePractice').click();
  await page.locator('#tutNext').click();
  await page.reload();
  await page.locator('.tut-choice', {hasText:'English'}).click();
  await page.locator('#carePurpose button').last().click();
  await page.locator('#tutNext').click();
  await page.locator('#carePractice').click();
  await page.locator('#tutNext').click();
  await page.locator('#tutNext').click();
  expect(await page.evaluate(() => ({fed:careFed(DB.care),bank:careBalance(DB.care),meals:Object.values(DB.days).reduce((sum,rec)=>sum+countMealRecords(rec),0)}))).toEqual({fed:3,bank:0,meals:0});
});

test('delivery includes capped effort, persists claims and handles late health data', async ({page}) => {
  await skipOnboarding(page); await page.goto('/index.html');
  const result = await page.evaluate(() => {
    const yesterday=prevDate(today); DB.care.since=yesterday;
    getRec(yesterday,true).steps=9000; getRec(yesterday,true).sleepHours=7;
    commit();
    const first=claimCare(DB,today), second=claimCare(DB,today);
    getRec(yesterday,true).steps=12000;
    const late=claimCare(DB,today);
    const before=computed.mito; commit();
    return {first,second,late,unchanged:before===computed.mito};
  });
  expect(result).toEqual({first:7,second:0,late:1,unchanged:true});
});

test('failed storage never consumes food or grows a friend', async ({page}) => {
  await skipOnboarding(page); await page.goto('/index.html');
  const before=await page.evaluate(()=>({food:careBalance(DB.care),mito:computed.mito}));
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('quota');};});
  await page.locator('#careFeed').click();
  expect(await page.evaluate(()=>({food:careBalance(DB.care),mito:computed.mito}))).toEqual(before);
  await expect(page.locator('#toast')).toBeVisible();
});

test('milestone homes unlock and selection persists', async ({page}) => {
  await skipOnboarding(page); await page.goto('/index.html');
  await page.evaluate(()=>{DB.care.welcome=60;DB.care.feedings=Array.from({length:6},()=>({date:today,amount:3}));commit();});
  await page.locator('#careJournal summary').click();
  await page.locator('#careThemes button').nth(1).click();
  await page.reload();
  await expect(page.locator('#tabHome .mito-stage')).toHaveAttribute('data-theme','pond');
});

test('all care translations and dynamic labels exist in both languages', async ({page}) => {
  await skipOnboarding(page); await page.goto('/index.html');
  const missing=await page.evaluate(()=>[...CARE_GOALS.flatMap(g=>[g.label,g.why]),...CARE_THEMES.map(g=>g.label),...Object.values(CARE_SOURCE_LABELS)].filter(key=>!I18N.ja[key]||!I18N.en[key]));
  expect(missing).toEqual([]);
});

test('photo earns food before analysis and remains attached to its original date', async ({page}) => {
  await skipOnboarding(page); await page.goto('/index.html');
  const result=await page.evaluate(async()=>{
    const original=today, following=nextDate(today), before=careBalance(DB.care);
    photoSlot='breakfast';
    const realResize=resizeImage;
    let finish;
    resizeImage=()=>new Promise(resolve=>{finish=resolve;});
    const task=addPhotoFile(new Blob(['test'],{type:'image/png'}));
    sel=following; photoSlot='dinner';
    finish('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=');
    await task; resizeImage=realResize;
    return {earned:careBalance(DB.care)-before,original:DB.days[original].photos.breakfast.length,wrong:!!DB.days[following],analysis:DB.days[original].mealAnalysis.breakfast};
  });
  expect(result).toEqual({earned:3,original:1,wrong:false,analysis:null});
});

test('health catchup reads recent days and preserves manual inputs', async({page})=>{
  await skipOnboarding(page); await page.goto('/index.html');
  const result=await page.evaluate(async()=>{
    DB.care.since=prevDate(prevDate(today));
    const previous=prevDate(today);getRec(previous,true).steps=1234;getRec(previous,true).stepsSource='manual';
    const calls=[];
    nativeHealthPlugin=()=>({});
    fetchHealthData=async date=>{calls.push(date);return{steps:9000,sleepHours:7};};
    await Promise.all([autoSyncHealthData(),autoSyncHealthData()]);
    return {calls:calls.length,steps:DB.days[previous].steps,sleep:DB.days[previous].sleepHours,pending:carePending(DB,today).filter(o=>o.kind==='sleep').length};
  });
  expect(result).toEqual({calls:3,steps:1234,sleep:7,pending:2});
});

test('legacy import migration and new data roundtrip preserve food and population', async({page})=>{
  await skipOnboarding(page); await page.goto('/index.html');
  const result=await page.evaluate(()=>{
    const original={version:5,startDate:prevDate(today),days:{},items:deepClone(DEFAULT_ITEMS),onboarded:true};
    const before=computeState(original,today).mito;
    const migrated=migrate(original);
    const after=computeState(migrated,today).mito;
    feedCare(migrated,today);
    const restored=migrate(JSON.parse(JSON.stringify(migrated)));
    return {before,after,roundtrip:computeState(restored,today).mito,food:careBalance(restored.care),events:restored.care.feedings.length};
  });
  expect(result.after).toBe(result.before);
  expect(result.roundtrip).toBe(result.before+1);
  expect(result.food).toBe(0);
  expect(result.events).toBe(1);
});

test('day rollover offers a new visit without expiring banked food', async({page})=>{
  await skipOnboarding(page);await page.goto('/index.html');
  const result=await page.evaluate(()=>{
    claimCare(DB,today);const bank=careBalance(DB.care), population=computed.mito;
    todayStr=()=>nextDate(today);checkDayChange();
    return {bank,after:careBalance(DB.care),population,afterPopulation:computed.mito,visit:claimCare(DB,today)};
  });
  expect(result.after).toBe(result.bank);
  expect(result.afterPopulation).toBe(result.population);
  expect(result.visit).toBe(1);
});

test('native notification listener handles do not interrupt startup', async ({page}) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.healthPromptCalls=0;
    window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',Plugins:{Health:{
      checkAuthorization:async()=>({readAuthorized:[]}),
      requestAuthorization:async()=>{window.healthPromptCalls++;}
    },LocalNotifications:{
      addListener:()=>({remove:async()=>{}}),
      checkPermissions:async()=>({display:'prompt'})
    }}};
  });
  await page.goto('/index.html');
  await expect(page.locator('#tutorial')).toBeVisible();
  await expect(page.locator('.tut-choice',{hasText:'English'})).toBeVisible();
  await page.locator('.tut-choice',{hasText:'English'}).click();
  await expect(page.locator('#carePurpose')).toBeVisible();
  await page.evaluate(()=>careSyncPromise);
  expect(await page.evaluate(()=>window.healthPromptCalls)).toBe(0);
  expect(errors).toEqual([]);
});
