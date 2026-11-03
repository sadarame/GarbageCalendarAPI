const {test}=require('node:test');
const assert=require('node:assert/strict');
const {previewBulk,saveBulk,exportBulk,normalize}=require('../lib/bulk');
const {adminId}=require('../lib/admin');
const {matches}=require('../lib/schedule');
const base={prefecture:'埼玉県',municipality:'検証町',district:'全域',name:'検証町 全域',latitude:'36.07',longitude:'139.36',sourceUrl:'https://example.jp/calendar',checkedOn:'2026-01-01',validFrom:'2026-04-01',validTo:'2027-03-31',rules:[{garbageType:'燃えるゴミ',iconType:'燃えるゴミ',schedule:'毎週',yobi:'木曜日',excludedDates:'2026-12-31',additionalDates:'2026-12-28'}]};
function fakeDB(){
 const metrics={reads:0,queries:0,active:0,peak:0};
 const docs=new Map();let writes=0;
 const snap=(id)=>({id,data:()=>docs.get(id)});
 function query(filters=[]){return {where:(k,op,v)=>query([...filters,[k,v]]),limit:()=>query(filters),get:async()=>{metrics.queries++;return ({docs:[...docs.keys()].filter(id=>filters.every(([k,v])=>docs.get(id)[k]===v)).map(snap)});}};}
 return {docs,metrics,get writes(){return writes;},collection:()=>({...query(),doc:id=>({id,get:async()=>{metrics.reads++;await new Promise(r=>setTimeout(r,1));return snap(id);}})}),runTransaction:async fn=>{
  metrics.active++;metrics.peak=Math.max(metrics.peak,metrics.active);
  const pending=[];const result=await fn({get:async ref=>ref.get(),set:(ref,value)=>pending.push([ref.id,value])});
  for(const [id,v] of pending){docs.set(id,{...docs.get(id),...v});writes++;}metrics.active--;return result;
 }};
}
async function apply(db,input){const plan=await previewBulk(db,input);return saveBulk(db,'operator',{entries:plan.results.filter(r=>r.result!=='error')});}
test('new stays draft; replay, DB export and reimport are unchanged',async()=>{
 const db=fakeDB();const first=await apply(db,[{...base,status:'published'}]);
 assert.equal(first.results[0].result,'created');assert.equal(first.results[0].savedStatus,'draft');assert.equal(first.results[0].readbackMatches,true);
 assert.equal((await apply(db,[base])).results[0].result,'unchanged');assert.equal(db.docs.size,1);assert.equal(db.writes,1);
 const exp=await exportBulk(db,{ids:[first.results[0].districtId]});assert.equal((await apply(db,exp)).results[0].result,'unchanged');
});
test('ID patch preserves published state, omitted fields and unknown DB metadata',async()=>{
 const db=fakeDB();await apply(db,[base]);const id=adminId(base);const stored=db.docs.get(id);stored.status='published';stored.extraData={keep:true};
 const result=await apply(db,[{districtId:id,name:'新名称',status:'draft'}]);
 assert.equal(result.results[0].result,'updated');assert.equal(db.docs.get(id).status,'published');assert.deepEqual(db.docs.get(id).rules,stored.rules);assert.deepEqual(db.docs.get(id).extraData,{keep:true});
});
test('ID rename keeps immutable ID; ID-free replay resolves renamed record',async()=>{
 const db=fakeDB();await apply(db,[base]);const id=adminId(base);
 await apply(db,[{districtId:id,district:'改名'}]);
 const renamed={...base,district:'改名'};assert.equal((await apply(db,[renamed])).results[0].result,'unchanged');assert.equal(db.docs.size,1);
});
test('duplicates, ambiguous matches, unknown ID, unsupported rules and proposal fail without writing',async()=>{
 const db=fakeDB();assert.throws(()=>normalize({...base,documentType:'implementation-proposal-not-import-payload'}));
 const duplicate=await previewBulk(db,[base,base]);assert.ok(duplicate.results.every(r=>r.result==='error'));
 await apply(db,[base]);db.docs.set('admin-duplicate',{...db.docs.get(adminId(base))});
 assert.equal((await previewBulk(db,[base])).results[0].errors[0].code,'AMBIGUOUS_IDENTITY');
 for(const input of [{districtId:'missing'}, {...base,rules:[{...base.rules[0],schedule:'年2回'}]}, {...base,rules:[{...base.rules[0],iconType:'invalid'}]}, {...base,validFrom:'2026-02-30'}, {...base,latitude:999}]) assert.equal((await previewBulk(db,[input])).results[0].result,'error');
});
test('validation after dry-run and invalid second rule never partially replaces a district',async()=>{
 const db=fakeDB();await apply(db,[base]);const id=adminId(base);const old=JSON.stringify(db.docs.get(id));
 const result=await previewBulk(db,[{districtId:id,rules:[base.rules[0],{schedule:'指定日のみ',specificDates:['2026-02-30']}]}]);assert.equal(result.results[0].result,'error');assert.equal(JSON.stringify(db.docs.get(id)),old);
 const plan=await previewBulk(db,[{districtId:id,notes:'new'}]);db.docs.get(id).notes='someone else';
 assert.equal((await saveBulk(db,'x',{entries:plan.results})).results[0].result,'conflict');assert.equal(db.docs.get(id).notes,'someone else');
});
test('per-district failure does not roll back other successful districts; tampered input rejected',async()=>{
 const db=fakeDB();const plan=await previewBulk(db,[base,{...base,district:'別'}]);plan.results[0].input.notes='changed';
 const result=await saveBulk(db,'x',{entries:plan.results});assert.deepEqual(result.results.map(r=>r.result),['error','created']);assert.equal(db.docs.size,1);
});
test('holiday exceptions, fifth weekday, biweekly anchor and annual specific dates',()=>{
 const value=normalize(base);const rule={...value.rules[0],validFrom:value.validFrom,validTo:value.validTo};
 assert.equal(matches(rule,'2026-12-31'),false);assert.equal(matches(rule,'2026-12-28'),true);assert.equal(matches(rule,'2027-04-01'),false);
 const specific=normalize({...base,rules:[{garbageType:'廃乾電池',iconType:'危険・有害',schedule:'指定日のみ',specificDates:['2026-05-16','2026-11-07']}]});
 const r=specific.rules[0];for(const d of ['2026-05-16','2026-11-07'])assert.equal(matches(r,d),true);for(const d of ['2026-05-23','2027-05-16'])assert.equal(matches(r,d),false);
 assert.equal(matches({garbageType:'紙',schedule:'第○曜日',weekOfMonth:'第五',yobi:'月曜日'},'2026-02-23'),false);
 const bi={garbageType:'製品プラ',schedule:'隔週',yobi:'月曜日',strDate:'2026-04-13',freqWeek:'二週に一回',excludedDates:['2027-01-04'],additionalDates:['2027-01-11']};assert.equal(matches(bi,'2027-01-04'),false);assert.equal(matches(bi,'2027-01-11'),true);assert.equal(matches(bi,'2026-04-20'),false);
 assert.throws(()=>normalize({...base,rules:[{...base.rules[0],additionalDates:'2026-12-31'}]}));assert.throws(()=>normalize({...base,rules:[{...base.rules[0],additionalDates:'2027-04-01'}]}));
});
test('expected calendar groups multiple rules per type and blocks mismatched published changes',async()=>{
 const db=fakeDB();const raw={...base,validFrom:'2026-05-01',validTo:'2026-05-31',rules:[{garbageType:'電池',schedule:'指定日のみ',specificDates:['2026-05-16']},{garbageType:'電池',schedule:'指定日のみ',specificDates:['2026-05-23']}],expectedDatesByGarbageType:{電池:['2026-05-23','2026-05-16']}};
 assert.equal((await previewBulk(db,[raw])).results[0].expectedDatesMatch,true);await apply(db,[raw]);db.docs.get(adminId(base)).status='published';
 const bad={...raw,expectedDatesByGarbageType:{電池:['2026-05-16']}};assert.equal((await apply(db,[bad])).results[0].result,'error');
});
test('all new callable endpoints retain admin authorization',async()=>{
 const api=require('../lib/index');for(const name of ['previewAdminBulkV2','saveAdminBulkV2','exportAdminBulkV2'])for(const auth of [undefined,{uid:'ordinary',token:{}}])await assert.rejects(api[name].run({auth,data:{}}),{code:'permission-denied'});
});
test('explicit bulk publication publishes only selected verified entries and is idempotent',async()=>{
 const db=fakeDB();const plan=await previewBulk(db,[base,{...base,district:'未選択'}]);
 assert.equal(plan.results[0].previewValue.sourceUrl,base.sourceUrl);
 const result=await saveBulk(db,'operator',{entries:[plan.results[0]],publish:true});
 assert.equal(result.results[0].savedStatus,'published');assert.equal(result.results[0].readbackMatches,true);
 assert.equal(db.docs.size,1);assert.equal(db.docs.get(adminId(base)).revision,1);
 const again=await previewBulk(db,[base]);
 assert.equal((await saveBulk(db,'operator',{entries:again.results,publish:true})).results[0].result,'unchanged');
 assert.equal(db.writes,1);
});
test('bulk publication rejects stale preview and calendar mismatch while publishing other districts',async()=>{
 const db=fakeDB();await apply(db,[base]);
 const plan=await previewBulk(db,[{districtId:adminId(base)},{...base,district:'不一致',expectedDatesByGarbageType:{}},{...base,district:'成功'}]);
 db.docs.get(adminId(base)).notes='別編集';
 const result=await saveBulk(db,'operator',{entries:plan.results,publish:true});
 assert.deepEqual(result.results.map(r=>r.result),['conflict','error','created']);
 assert.equal(db.docs.get(adminId(base)).status,'draft');assert.equal(db.docs.has(adminId({...base,district:'不一致'})),false);
 assert.equal(db.docs.get(adminId({...base,district:'成功'})).status,'published');
});
test('publishing an unchanged draft increments revision and changes status',async()=>{
 const db=fakeDB();await apply(db,[base]);const plan=await previewBulk(db,[{districtId:adminId(base)}]);
 assert.equal(plan.results[0].result,'unchanged');
 const result=await saveBulk(db,'operator',{entries:plan.results,publish:true});
 assert.equal(result.results[0].result,'updated');assert.equal(result.results[0].revision,2);
 assert.equal(result.results[0].savedStatus,'published');
});

test('100 ID patches use bounded concurrency, 3 reads each and preserve untouched data',async()=>{
 const db=fakeDB();const original=normalize(base);
 const ids=Array.from({length:100},(_,i)=>adminId({...original,district:String(i)}));
 ids.forEach((id,i)=>db.docs.set(id,{...original,district:String(i),source:'admin',revision:1,extraData:{keep:true}}));
 const untouched=adminId({...original,district:'untouched'});db.docs.set(untouched,{...original,district:'untouched',source:'admin',revision:1});
 const snapshot=JSON.stringify(db.docs.get(untouched));
 const input=ids.map(districtId=>({districtId,notes:'changed'}));
 const plan=await previewBulk(db,input);
 const result=await saveBulk(db,'operator',{entries:plan.results});
 assert.equal(result.results.length,100);assert.ok(result.results.every(r=>r.result==='updated'&&r.readbackMatches));
 assert.deepEqual(result.results.map(r=>r.districtId),ids);assert.deepEqual(result.districts.map(r=>r.districtId),ids);
 assert.equal(db.metrics.reads,300);assert.equal(db.metrics.queries,0);assert.equal(db.metrics.peak,4);
 assert.equal(JSON.stringify(db.docs.get(untouched)),snapshot);assert.equal(db.docs.size,101);
 for(const id of ids){assert.deepEqual(db.docs.get(id).rules,original.rules);assert.deepEqual(db.docs.get(id).extraData,{keep:true});}
 const retry=await apply(db,input);assert.ok(retry.results.every(r=>r.result==='unchanged'));assert.equal(db.writes,100);
 await assert.rejects(previewBulk(db,[...input,input[0]]));
 console.log('100 targeted patches: 300 document reads, 0 queries, max 4 concurrent transactions; idempotent retry; 101st input rejected');
});
