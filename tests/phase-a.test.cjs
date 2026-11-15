const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../www/tracker-core.js');

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key) { values.delete(key); },
    values
  };
}

const good = {
  days: {
    '2026-06-02': {
      checks: { 'Posture reset': true }, pain: '2', energy: '3', sleep: '7.5', notes: 'steady'
    }
  },
  measurements: [{ date: '2026-06-02', weight: '70.2', waist: '82', notes: 'weekly' }]
};

test('accepts the existing tracker backup shape', () => {
  assert.deepEqual(Core.validateBackup(good), { valid: true, error: '' });
});

test('rejects malformed top-level and nested backup types', () => {
  const invalid = [
    null,
    [],
    { days: [], measurements: [] },
    { days: {}, measurements: {} },
    { days: { '2026-06-02': { checks: [] } }, measurements: [] },
    { days: { '2026-02-30': { checks: {} } }, measurements: [] },
    { days: { '2026-06-02': { checks: { habit: 'yes' } } }, measurements: [] },
    { days: {}, measurements: [{ date: '2026-06-02', notes: { html: 'bad' } }] }
  ];
  for (const value of invalid) assert.equal(Core.validateBackup(value).valid, false);
});

test('HTML-like measurement notes remain literal text when rendered', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const originalDocument = global.document;
  global.document = { createElement() { return { textContent: '', nodeName: 'P' }; } };
  const rows = [];
  const container = {
    set textContent(value) { if (value === '') rows.length = 0; },
    appendChild(row) { rows.push(row); }
  };
  try {
    Core.renderMeasurements(container, [{ date: '2026-06-02', weight: '70', waist: '82', notes: payload }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].textContent, '2026-06-02 · 70 kg · 82 cm ' + payload);
  } finally {
    global.document = originalDocument;
  }
});

test('local date keys follow the local calendar across a UTC boundary', () => {
  const originalTZ = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Kolkata';
    const instant = new Date('2026-11-15T19:00:00.000Z');
    assert.equal(instant.toISOString().slice(0, 10), '2026-11-15');
    assert.equal(Core.localDateKey(instant), '2026-11-16');
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test('streak counts consecutive local days with at least one checked habit', () => {
  const days = {
    '2026-06-03': { checks: { a: true, b: false } },
    '2026-06-02': { checks: { a: true } },
    '2026-06-01': { checks: { a: false } },
    '2026-05-31': { checks: { a: true } }
  };
  assert.equal(Core.calculateStreak(days, '2026-06-03'), 2);
  assert.equal(Core.calculateStreak(days, '2026-06-02'), 1);
  assert.equal(Core.calculateStreak(days, '2026-06-01'), 0);
});

test('daily drafts persist all fields while preserving checks and the existing format', () => {
  let state = Core.emptyState();
  state.days['2026-06-03'] = { checks: { 'Posture reset': true } };
  state = Core.updateDailyDraft(state, '2026-06-03', {
    pain: '2', energy: '4', sleep: '7.5', notes: '<keep as text>'
  });
  const storage = memoryStorage();
  assert.equal(Core.writeState(storage, 'tracker', state).ok, true);
  const loaded = Core.readState(storage, 'tracker');
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.state.days['2026-06-03'], {
    checks: { 'Posture reset': true }, pain: '2', energy: '4', sleep: '7.5', notes: '<keep as text>'
  });
});

test('storage read errors preserve the original raw value and block overwrite', () => {
  const raw = '{corrupt data';
  const storage = memoryStorage({ tracker: raw });
  const result = Core.readState(storage, 'tracker');
  assert.equal(result.ok, false);
  assert.equal(result.raw, raw);
  assert.equal(storage.getItem('tracker'), raw);
});

test('write errors return a safe message without exposing exception text', () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('sensitive internal detail'); };
  const result = Core.writeState(storage, 'tracker', good);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /sensitive internal detail/);
});

test('failed safety backup leaves current tracker data untouched', () => {
  const raw = JSON.stringify(good);
  const storage = memoryStorage({ tracker: raw });
  storage.setItem = () => { throw new Error('quota'); };
  const result = Core.replaceStateSafely(storage, 'tracker', raw, { days: {}, measurements: [] });
  assert.equal(result.ok, false);
  assert.equal(storage.getItem('tracker'), raw);
});

test('rejected import leaves current tracker data untouched', () => {
  const raw = JSON.stringify(good);
  const storage = memoryStorage({ tracker: raw });
  const result = Core.replaceStateSafely(storage, 'tracker', raw, { days: {}, measurements: {} });
  assert.equal(result.ok, false);
  assert.equal(storage.getItem('tracker'), raw);
});

test('successful import stores a separately exportable recovery snapshot first', () => {
  const raw = JSON.stringify(good);
  const storage = memoryStorage({ tracker: raw });
  const next = { days: {}, measurements: [] };
  const result = Core.replaceStateSafely(storage, 'tracker', raw, next);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(storage.getItem('tracker')), next);
  assert.equal(Core.latestSafetyBackup(storage, 'tracker').raw, raw);
});

test('inline app script parses and essential tracker controls remain present', () => {
  const html = fs.readFileSync(require.resolve('../www/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
  assert.ok(scripts.length);
  for (const source of scripts) new vm.Script(source);
  for (const id of ['daily', 'plan', 'library', 'progress', 'save', 'savem', 'export', 'import']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /core\.renderMeasurements\(el\("measurements"\),state\.measurements\)/);
  assert.doesNotMatch(html, /measurements"\)\.innerHTML=state\.measurements/);
});

test('backup semantic ranges match the daily controls and unknown fields survive',()=>{
  for(const [field,value] of [['pain','11'],['pain','2.5'],['energy','0'],['energy','6'],['sleep','24.5'],['sleep','7.25']]){const copy=structuredClone(good);copy.days['2026-06-02'][field]=value;assert.equal(Core.validateBackup(copy).valid,false,field+': '+value)}
  const copy=structuredClone(good);copy.extraLegacy={origin:'older export'};copy.days['2026-06-02'].customField={kept:true};assert.equal(Core.validateBackup(copy).valid,true);assert.deepEqual(Core.replaceStateSafely(memoryStorage({tracker:JSON.stringify(good)}),'tracker',JSON.stringify(good),copy).ok,true);
});

test('local persistence failure preserves daily and habit candidates as explicit drafts',()=>{
  const storage=memoryStorage({tracker:JSON.stringify(good)});storage.setItem=(key,value)=>{if(key==='tracker')throw new Error('quota');storage.values.set(key,String(value))};const baseline=Core.readState(memoryStorage({tracker:JSON.stringify(good)}),'tracker').state;
  const daily=Core.updateDailyDraft(baseline,'2026-06-02',{pain:'4',energy:'2',sleep:'6',notes:'pending'});assert.equal(Core.writeState(storage,'tracker',daily).ok,false);assert.equal(daily.days['2026-06-02'].notes,'pending');assert.equal(Core.writePendingDraft(storage,'tracker',JSON.stringify(good),daily).ok,true);assert.equal(Core.readPendingDraft(storage,'tracker',JSON.stringify(good)).state.days['2026-06-02'].notes,'pending');
  const habit=Core.setHabitCheck(baseline,'2026-06-03','Walk',true);assert.equal(habit.days['2026-06-03'].checks.Walk,true);assert.equal(baseline.days['2026-06-03'],undefined);
});

test('recovery snapshots are enumerable, individually removable only after verified export',()=>{
  const storage=memoryStorage({tracker:JSON.stringify(good),'tracker.safety.1760000000000':JSON.stringify(good),'tracker.safety.1760000000001':JSON.stringify({days:{},measurements:[]})});const snapshots=Core.listSafetyBackups(storage,'tracker');assert.equal(snapshots.length,2);assert.equal(Core.removeSafetyBackup(storage,'tracker',snapshots[0].key,false).ok,false);assert.equal(Core.removeSafetyBackup(storage,'tracker',snapshots[0].key,true).ok,true);assert.equal(Core.listSafetyBackups(storage,'tracker').length,1);assert.ok(storage.getItem('tracker'));
});

test('cloud queue coalesces rapid edits and flushes the latest edit after an in-flight request',async()=>{
  const timers=[];let timerId=0;let currentState='initial';const setTimeoutFake=(fn,delay)=>{const item={id:++timerId,fn,delay,cancelled:false};timers.push(item);return item.id};const clearTimeoutFake=id=>{const t=timers.find(x=>x.id===id);if(t)t.cancelled=true};let resolveFirst;const calls=[];let statuses=[];const queue=Core.createSyncQueue(()=>{calls.push(currentState);return calls.length===1?new Promise(resolve=>resolveFirst=resolve):Promise.resolve({ok:true})},{delay:10,setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,onPending:()=>statuses.push('pending'),onSuccess:()=>statuses.push('success'),onFailure:()=>statuses.push('failure')});
  queue.schedule();queue.schedule();assert.equal(timers.filter(x=>!x.cancelled).length,1);const first=queue.flush();await Promise.resolve();currentState='latest';queue.schedule();resolveFirst({ok:true});await first;const rerun=timers.find(x=>!x.cancelled);assert.ok(rerun);await rerun.fn();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);assert.equal(calls[1],'latest');assert.equal(statuses.at(-1),'success');assert.equal(queue.isPending(),false);
});

test('cloud load does not announce ready after a successful remote read and failed upsert',async()=>{
  const html=fs.readFileSync(require.resolve('../www/index.html'),'utf8');const app=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(x=>x.includes('async function cloudLoad'));assert.ok(app);
  const save=app.match(/async function cloudSave\(\)\{[\s\S]*?\nasync function cloudLoad/)[0].replace(/\nasync function cloudLoad$/,'');const load=app.match(/async function cloudLoad\(\)\{[\s\S]*?\nasync function initCloud/)[0].replace(/\nasync function initCloud$/,'');
  const statuses=[];const context={window:{FF_SUPABASE:{user:{id:'u1',email:'user@example.test'},client:{from(){return{select(){return{eq(){return{maybeSingle:async()=>({data:{data:good},error:null})}}}},upsert:async()=>({error:{message:'offline'}})}}}}},core:Core,state:structuredClone(good),storedRaw:JSON.stringify(good),storageReadBlocked:false,key:'tracker',localStorage:memoryStorage({tracker:JSON.stringify(good)}),cloudStatus:t=>statuses.push(t),mergeTracker:(remote,local)=>local,render(){},history(){},cloudQueue:{flush:async()=>{const result=await context.window.FF_SUPABASE.client.from('tracker_data').upsert({});if(result.error){context.cloudStatus('Cloud save failed: '+result.error.message);return false}return true}}};
  vm.createContext(context);vm.runInContext(save+'\n'+load,context);await context.cloudLoad();assert.ok(statuses.some(x=>x.toLowerCase().includes('failed')));assert.equal(statuses.some(x=>x.includes('Cloud sync ready')),false);
});

test('root compatibility fallback renders measurement notes using text nodes and its inline script parses',()=>{const html=fs.readFileSync(require.resolve('../index.html'),'utf8');const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>x.trim());for(const script of scripts)new vm.Script(script);assert.match(html,/\.\/www\//);assert.doesNotMatch(html,/function render\(/)});


test('daily form event handlers retain candidate edits when local save fails',()=>{
 const html=fs.readFileSync(require.resolve('../www/index.html'),'utf8');const app=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(x=>x.includes('function render(){'));const source=app.match(/function render\(\)\{[\s\S]*?\nfunction summary/)[0].replace(/\nfunction summary$/,'');
 const els={groups:{set innerHTML(v){this.nodes=[]},append(n){this.nodes.push(n)}},pain:{},energy:{},sleep:{},notes:{}};let working=structuredClone(good),draft=null;const mk=()=>{const n={nodes:[],append(...xs){this.nodes.push(...xs)},appendChild(x){this.nodes.push(x)},style:{},className:'',textContent:'',checked:false};return n};const doc={createElement:mk};const context={document:doc,groups:[['Group',[['Habit','Description','1 rep']]]],selected:'2026-06-02',state:working,el:id=>els[id],getday:()=>working.days['2026-06-02']||{checks:{}},core:{setHabitCheck:Core.setHabitCheck},persist(ok,candidate){working=candidate;draft=candidate;return false},summary(){},render:null};vm.createContext(context);vm.runInContext(source,context);context.render();const checkbox=els.groups.nodes[0].nodes[1].nodes[0];checkbox.checked=true;checkbox.onchange();assert.equal(draft.days['2026-06-02'].checks.Habit,true);assert.equal(working.days['2026-06-02'].checks.Habit,true);
});


test('date helper covers leap days and year boundaries without rewriting keys',()=>{assert.equal(Core.validDateKey('2024-02-29'),true);assert.equal(Core.validDateKey('2025-02-29'),false);const keys={'2024-03-01':{checks:{a:true}},'2024-02-29':{checks:{b:true}},'2024-02-28':{checks:{c:true}}};assert.equal(Core.calculateStreak(keys,'2024-03-01'),3);assert.deepEqual(Object.keys(keys),['2024-03-01','2024-02-29','2024-02-28'])});

test('service worker validates matching release assets and preserves unrelated caches',()=>{const sw=fs.readFileSync(require.resolve('../www/sw.js'),'utf8');for(const token of ['release=([a-f0-9]{16})','crypto.subtle.digest','const response = await fetch(request)','await cache.put(url, response)','await releaseCache.match(request)','form-function-release-pointer-v1'])assert.equal(sw.includes(token),true,token);assert.equal(sw.includes('caches.keys()'),false);assert.match(sw,/await caches.delete\(name\)/)});
function appPersistenceHarness(options={}) {
  const html=fs.readFileSync(require.resolve('../www/index.html'),'utf8');
  const app=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(x=>x.includes('function persist('));
  const persistStart=app.indexOf('function persist('),persistEnd=app.indexOf('function setDailyStatus',persistStart);
  const queueStart=app.indexOf('var cloudQueue='),queueEnd=app.indexOf('\nfunction mergeTracker',queueStart);
  const fakeTimers=[];let nextTimer=0;
  const setTimer=(fn,delay)=>{const item={id:++nextTimer,fn,delay,cancelled:false};fakeTimers.push(item);return item.id};
  const clearTimer=id=>{const item=fakeTimers.find(x=>x.id===id);if(item)item.cancelled=true};
  const local=memoryStorage({tracker:JSON.stringify(good)}),session=memoryStorage();
  const originalSet=local.setItem.bind(local);
  local.setItem=(key,value)=>{if(options.localFail)throw new Error('quota');originalSet(key,value)};
  session.setItem=(key,value)=>{if(options.sessionFail)throw new Error('session quota');session.values.set(key,String(value))};
  const uploads=[],statuses=[];
  let resolveUpload;
  const client={from(){return{upsert:async row=>{uploads.push(structuredClone(row.data));if(options.deferUpload)return await new Promise(resolve=>resolveUpload=resolve);return{error:null}}}}};
  const wrappedCore=Object.assign({},Core,{createSyncQueue(save,queueOptions){return Core.createSyncQueue(save,Object.assign({},queueOptions,{delay:5,setTimeout:setTimer,clearTimeout:clearTimer}))}});
  const context={core:wrappedCore,window:{FF_SUPABASE:{client,user:{id:'u',email:'user@example.test'}}},localStorage:local,sessionStorage:session,key:'tracker',state:structuredClone(good),persistedState:structuredClone(good),storedRaw:JSON.stringify(good),storageReadBlocked:false,unsavedChanges:false,draftStorage:session,selected:'2026-06-02',uploads,statuses,setDailyStatus:m=>statuses.push(m),cloudStatus:m=>statuses.push(m),el:id=>({value:id==='mdate'?'2026-06-02':''}),scheduleCloudSave(){return context.cloudQueue.schedule()},fakeTimers};
  vm.createContext(context);
  vm.runInContext(app.slice(persistStart,persistEnd)+app.slice(queueStart,queueEnd),context);
  context.resolveUpload=()=>resolveUpload&&resolveUpload({error:null});
  context.fakeTimers=fakeTimers;
  return context;
}

test('failed local edit with a pending cloud timer uploads only the last persisted state',async()=>{
  const app=appPersistenceHarness({localFail:true});const before=structuredClone(good);const edited=Core.updateDailyDraft(app.state,'2026-06-02',{pain:'5',energy:'2',sleep:'6',notes:'draft'});
  app.cloudQueue.schedule();app.candidate=edited;assert.equal(vm.runInContext('persist(true,candidate)',app),false);
  const timer=app.fakeTimers.find(x=>!x.cancelled);await timer.fn();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.uploads.length,1);assert.deepEqual(app.uploads[0],before);assert.deepEqual(app.persistedState,before);assert.equal(app.state.days['2026-06-02'].notes,'draft');
});

test('failed local edit during an in-flight cloud request is not uploaded later',async()=>{
  const app=appPersistenceHarness({deferUpload:true,localFail:true});app.cloudQueue.schedule();const first=app.cloudQueue.flush();await Promise.resolve();await Promise.resolve();
  const candidate=Core.updateDailyDraft(app.state,'2026-06-02',{pain:'6',energy:'2',sleep:'5',notes:'not persisted'});app.candidate=candidate;
  assert.equal(vm.runInContext('persist(true,candidate)',app),false);app.resolveUpload();await first;
  assert.equal(app.uploads.length,1);assert.equal(app.uploads[0].days['2026-06-02'].notes,'steady');assert.equal(app.cloudQueue.isPending(),false);
});

test('later successful local write promotes and synchronizes the recovered edit',async()=>{
  const app=appPersistenceHarness({localFail:true});const candidate=Core.updateDailyDraft(app.state,'2026-06-02',{pain:'6',energy:'2',sleep:'5',notes:'now saved'});app.candidate=candidate;
  assert.equal(vm.runInContext('persist(true,candidate)',app),false);app.localStorage.setItem=(key,value)=>app.localStorage.values.set(key,String(value));
  assert.equal(vm.runInContext('persist(true,candidate)',app),true);assert.deepEqual(app.persistedState,candidate);
  const timer=app.fakeTimers.find(x=>!x.cancelled);await timer.fn();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.uploads.length,1);assert.equal(app.uploads[0].days['2026-06-02'].notes,'now saved');
});

test('both storage APIs failing keeps edit visible but never syncs it',()=>{
  const app=appPersistenceHarness({localFail:true,sessionFail:true});const candidate=Core.updateDailyDraft(app.state,'2026-06-02',{pain:'7',energy:'2',sleep:'5',notes:'memory only'});app.candidate=candidate;
  assert.equal(vm.runInContext('persist(true,candidate)',app),false);assert.equal(app.state.days['2026-06-02'].notes,'memory only');assert.equal(app.persistedState.days['2026-06-02'].notes,'steady');assert.equal(app.fakeTimers.length,0);assert.ok(app.statuses.some(x=>x.includes('only in memory')));
});

test('retrying a failed measurement saves exactly one record',()=>{
  const initial={days:{},measurements:[]},measurement={date:'2026-06-02',weight:'70',waist:'82',notes:'retry'};
  const failed=Core.addMeasurement(initial,measurement);assert.equal(Core.hasUnpersistedMeasurement(failed,initial,measurement),true);
  const retry=Core.hasUnpersistedMeasurement(failed,initial,measurement)?failed:Core.addMeasurement(failed,measurement);
  assert.equal(retry.measurements.length,1);const storage=memoryStorage();assert.equal(Core.writeState(storage,'tracker',retry).ok,true);assert.equal(Core.readState(storage,'tracker').state.measurements.length,1);
});

test('manual sync during unchanged in-flight upload does not duplicate it',async()=>{
  let resolve,calls=0;const timers=[];const queue=Core.createSyncQueue(()=>{calls++;return new Promise(done=>resolve=done)},{delay:1,setTimeout(fn,delay){timers.push(fn);return timers.length},clearTimeout(){}});
  queue.schedule();const first=queue.flush();await Promise.resolve();const manualOne=queue.flush(),manualTwo=queue.flush();resolve({ok:true});await Promise.all([first,manualOne,manualTwo]);assert.equal(calls,1);
});

test('multiple persisted edits during upload coalesce to one latest follow-up',async()=>{
  const timers=[];let resolve,current='saved-1';const sent=[];const queue=Core.createSyncQueue(()=>{sent.push(current);return sent.length===1?new Promise(done=>resolve=done):Promise.resolve({ok:true})},{delay:20,setTimeout(fn,delay){const item={fn,delay,cancelled:false};timers.push(item);return timers.length},clearTimeout(id){timers[id-1].cancelled=true}});
  queue.schedule();const first=queue.flush();await Promise.resolve();current='saved-2';queue.schedule();current='saved-3';queue.schedule();current='saved-4';queue.schedule();resolve({ok:true});await first;
  const followup=timers.find(x=>!x.cancelled);assert.ok(followup);await followup.fn();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(sent,['saved-1','saved-4']);
});

test('release stamping derives a stable helper ID from shell and helper contents',()=>{
  const release=require('../scripts/prepare-release.cjs'),source='<script src="./tracker-core.js"></script>',first=release.stamp(source,'helper-a',['manifest','icon','config']);
  assert.match(first,/tracker-core\.js\?release=[a-f0-9]{16}/);assert.equal(release.stamp(first,'helper-a',['manifest','icon','config']),first);assert.notEqual(release.stamp(first,'helper-b',['manifest','icon','config']),first);assert.notEqual(release.stamp(source+'<!--new shell-->','helper-a',['manifest','icon','config']),first);
});

test('root entry redirects to canonical www app without duplicate app logic',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');assert.match(html,/\.\/*www\//);assert.doesNotMatch(html,/formFunctionTrackerV1|function render\(/);
});
test('service worker stores only matching shell/helper releases and serves the cached shell offline',async()=>{
  const sw=fs.readFileSync(require.resolve('../www/sw.js'),'utf8');
  const html=fs.readFileSync(require.resolve('../www/index.html'),'utf8');
  const helper=fs.readFileSync(require.resolve('../www/tracker-core.js'),'utf8');
  const id=html.match(/tracker-core\.js\?release=([a-f0-9]{16})/)[1],scope='https://app.test/www/';
  const stores=new Map();class FakeCache{constructor(){this.entries=new Map()}async put(key,value){this.entries.set(String(key),value.clone())}async match(key){const value=this.entries.get(typeof key==='string'?key:key.url||String(key));return value&&value.clone()}}
  const caches={async open(name){if(!stores.has(name))stores.set(name,new FakeCache());return stores.get(name)},async has(name){return stores.has(name)},async delete(name){return stores.delete(name)}};
  let corrupt=false;
  const context={self:{registration:{scope},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener(){}},caches,URL,Response,TextEncoder,crypto:require('node:crypto').webcrypto,fetch:async url=>{const value=String(url);if(value.includes('tracker-core.js'))return new Response(corrupt?helper+'/* mismatch */':helper);if(value.includes('manifest.webmanifest'))return new Response(fs.readFileSync(require.resolve('../www/manifest.webmanifest'),'utf8'));if(value.includes('icon.svg'))return new Response(fs.readFileSync(require.resolve('../www/assets/icon.svg'),'utf8'));if(value.includes('supabase-config.js'))return new Response(fs.readFileSync(require.resolve('../www/supabase-config.js'),'utf8'));return new Response('missing',{status:404})}};
  stores.set('unrelated-cache',new FakeCache());vm.createContext(context);vm.runInContext(sw,context);
  const cacheName=await context.prepareRelease(new Response(html),scope+'index.html');
  assert.equal(cacheName,'form-function-release-'+id);assert.equal(await caches.has('unrelated-cache'),true);
  const releaseCache=await caches.open(cacheName);assert.ok(await releaseCache.match(scope+'index.html'));assert.ok(await releaseCache.match(scope+'tracker-core.js?release='+id));
  const offline=await context.offlineShell(scope);assert.match(await offline.text(),/Form & Function/);
  corrupt=true;await assert.rejects(()=>context.prepareRelease(new Response(html),scope+'index.html?second=1'),/do not match/);assert.equal(await caches.has(cacheName),true);
});
