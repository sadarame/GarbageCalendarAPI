const {test} = require('node:test');
const assert = require('node:assert/strict');
const {adminSchema, adminId, requireAdmin} = require('../lib/admin');
const value = {name:'新宿区 西新宿', prefecture:'東京都',municipality:'新宿区',district:'西新宿',latitude:35.69,longitude:139.69,
sourceUrl:'https://example.jp/waste',checkedOn:'2026-01-01',status:'draft',rules:[{garbageType:'可燃ごみ',schedule:'毎週',yobi:'月曜日'}]};
test('admin role is required, including authenticated ordinary users',()=>{
 for (const token of [undefined, {}, {scheduleAdmin:false}, {scheduleAdmin:'true'}]) assert.throws(()=>requireAdmin(token));
 assert.doesNotThrow(()=>requireAdmin({scheduleAdmin:true}));
});
test('source, real dates, region and valid schedules required',()=>{
 assert.equal(adminSchema.safeParse(value).success,true);
 for (const patch of [{sourceUrl:'javascript:alert(1)'},{checkedOn:'2026-02-30'},{checkedOn:'2999-01-01'},{district:''},{rules:[]}])
 assert.equal(adminSchema.safeParse({...value,...patch}).success,false);
});
test('same region deduplicates, district boundaries do not collide',()=>{
 assert.equal(adminId(value),adminId({...value,name:'別表示名'}));
 assert.notEqual(adminId(value),adminId({...value,district:'別地区'}));
});
const {saveAdminSchedule} = require('../lib/admin');
function fakeDB() {
 const docs = new Map();
 const query=(filters=[])=>({filters,where:(k,op,v)=>query([...filters,[k,v]]),limit:()=>query(filters),doc:id=>({id})});
 return {docs,collection:()=>query(),runTransaction:async fn=>fn({
 get:async ref=>{if(ref.filters){const matches=[...docs].filter(([id,d])=>ref.filters.every(([k,v])=>d[k]===v)).map(([id,d])=>({id,data:()=>d}));return {size:matches.length,docs:matches};}return {data:()=>docs.get(ref.id)};},set:(ref,data)=>docs.set(ref.id,{...docs.get(ref.id),...data})})};
}
test('draft, publish, revision conflicts and coordinate rounding', async()=>{
 const db=fakeDB();
 const saved=await saveAdminSchedule(db,'operator',{...value,latitude:35.69123,expectedRevision:0});
 assert.equal(saved.revision,1);assert.equal(db.docs.get(saved.id).status,'draft');
 assert.equal(db.docs.get(saved.id).source,'admin');
 assert.equal(require('../lib/shared').publicSummary(saved.id,db.docs.get(saved.id)).registrationSource,'admin');
 assert.equal(db.docs.get(saved.id).latitude,35.69);
 await assert.rejects(saveAdminSchedule(db,'other',{...value,expectedRevision:0}),{code:'aborted'});
 await saveAdminSchedule(db,'operator',{...value,status:'published',expectedRevision:1});
 assert.equal(db.docs.get(saved.id).status,'published');assert.equal(db.docs.get(saved.id).revision,2);
 await saveAdminSchedule(db,'operator',{...value,status:'draft',expectedRevision:2});
 assert.equal(db.docs.get(saved.id).status,'draft');
});
test('both admin endpoints reject anonymous and ordinary app users',async()=>{
 const api=require('../lib/index');
 for(const name of ['saveAdminScheduleV2','listAdminSchedulesV2']) {
  for(const auth of [undefined,{uid:'ordinary',token:{}},{uid:'ordinary',token:{scheduleAdmin:false}}])
   await assert.rejects(api[name].run({auth,data:{}}),{code:'permission-denied'});
 }
});

test('icon choice persists through admin save and public schedule; automatic stays optional', async()=>{
 const db=fakeDB();
 const rule={...value.rules[0],garbageType:'資源物2類',iconType:'古紙'};
 const saved=await saveAdminSchedule(db,'operator',{...value,status:'published',rules:[rule],expectedRevision:0});
 assert.equal(db.docs.get(saved.id).rules[0].iconType,'古紙');
 assert.equal(adminSchema.parse(value).rules[0].iconType,undefined);
 assert.equal(adminSchema.safeParse({...value,rules:[{...rule,iconType:'invalid'}]}).success,false);
 const {getShared}=require('../lib/shared');
 const publicDB={collection:()=>({doc:id=>({get:async()=>({data:()=>db.docs.get(id)})})})};
 assert.equal((await getShared(publicDB,{id:saved.id})).rules[0].iconType,'古紙');
});

test('targeted overwrite preserves omitted rules, dates, notes and other records', async()=>{
 const db=fakeDB();const initial={...value,notes:'keep',validFrom:'2026-01-01',validTo:'2026-12-31'};
 const first=await saveAdminSchedule(db,'operator',initial);
 const other=await saveAdminSchedule(db,'operator',{...value,district:'別地区'});
 const beforeOther=JSON.stringify(db.docs.get(other.id));
 const updated=await saveAdminSchedule(db,'operator',{districtId:first.id,name:'変更名'});
 assert.equal(updated.revision,2);assert.equal(updated.district.notes,'keep');
 assert.equal(updated.district.validTo,'2026-12-31');assert.deepEqual(updated.district.rules,db.docs.get(first.id).rules);
 assert.equal(JSON.stringify(db.docs.get(other.id)),beforeOther);
 await saveAdminSchedule(db,'operator',{prefecture:value.prefecture,municipality:value.municipality,district:value.district,notes:'上書き'});
 assert.equal(db.docs.size,2);assert.equal(db.docs.get(first.id).name,'変更名');
 await assert.rejects(saveAdminSchedule(db,'operator',{districtId:first.id,expectedRevision:1,notes:'stale'}),{code:'aborted'});
 assert.equal(db.docs.get(first.id).notes,'上書き');
});
