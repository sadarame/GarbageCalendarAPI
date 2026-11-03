const {test}=require('node:test');
const assert=require('node:assert/strict');
const {listMapSchedules,listMapMunicipalities}=require('../lib/admin');
function fakeDB(rows){
 let reads=0;const db={get reads(){return reads;},collection:()=>{
  let filters=[],after='',max=Infinity,fields=null;
  const query={where:(k,op,v)=>{assert.equal(op,'==');filters.push([k,v]);return query;},orderBy:()=>query,select:(...f)=>{fields=f;return query;},limit:n=>{max=n;return query;},startAfter:id=>{after=id;return query;},get:async()=>{
   reads++;const data=rows.filter(r=>filters.every(([k,v])=>r[k]===v)&&r.id>after).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,max);
   const docs=data.map(r=>({id:r.id,data:()=>Object.fromEntries(Object.entries(r).filter(([k])=>!fields||fields.includes(k)))}));return {docs,size:docs.length};
  }};return query;
 }};return db;
}
const row=(id,patch={})=>({id:'admin-'+id.toString(16).padStart(32,'0'),source:'admin',prefecture:'埼玉県',municipality:'草加市',district:'テスト地区',rules:[{private:'heavy schedule'}],notes:'internal',...patch});
test('map requires both area fields before reading any schedules',async()=>{
 const db=fakeDB([]);
 for(const input of [{},{prefecture:'埼玉県'},{prefecture:'埼玉県',municipality:' '},{prefecture:'埼玉県',municipality:'草加市',after:'bad'}])await assert.rejects(listMapSchedules(db,input));
 await assert.rejects(listMapMunicipalities(db,{}));assert.equal(db.reads,0);
});
test('map selects only requested admin municipality and omits heavy fields',async()=>{
 const db=fakeDB([row(1),row(2,{prefecture:'東京都'}),row(3,{municipality:'川口市'}),row(4,{source:'user'})]);
 const result=await listMapSchedules(db,{prefecture:'埼玉県',municipality:'草加市'});
 assert.equal(result.items.length,1);assert.equal(result.items[0].id,row(1).id);assert.equal(result.items[0].rules,undefined);assert.equal(result.items[0].notes,undefined);assert.equal(result.next,null);
});
test('municipality candidates are deduplicated and prefecture-scoped',async()=>{
 const db=fakeDB([row(1),row(2),row(3,{municipality:'川口市'}),row(4,{prefecture:'東京都',municipality:'新宿区'}),row(5,{source:'user',municipality:'別市'})]);
 assert.deepEqual(new Set((await listMapMunicipalities(db,{prefecture:'埼玉県'})).municipalities),new Set(['草加市','川口市']));
});
test('map paginates a large city without duplicates or leaking other cities',async()=>{
 const rows=Array.from({length:205},(_,i)=>row(i+1));rows.push(row(300,{municipality:'別市'}));const db=fakeDB(rows);const area={prefecture:'埼玉県',municipality:'草加市'};
 const first=await listMapSchedules(db,area);assert.equal(first.items.length,200);assert.equal(first.next,row(200).id);
 const last=await listMapSchedules(db,{...area,after:first.next});assert.equal(last.items.length,5);assert.equal(last.next,null);assert.equal(new Set([...first.items,...last.items].map(i=>i.id)).size,205);
});

const {listAdminSchedules}=require('../lib/admin');
test('editor reads no nationwide data without explicit backup and paginates only target city',async()=>{
 const rows=Array.from({length:75},(_,i)=>row(i+1));rows.push(row(100,{municipality:'別市'}));const db=fakeDB(rows);
 await assert.rejects(listAdminSchedules(db,{}));assert.equal(db.reads,0);
 const area={prefecture:'埼玉県',municipality:'草加市'};
 const first=await listAdminSchedules(db,area);const second=await listAdminSchedules(db,{...area,after:first.next});
 assert.equal(first.items.length,50);assert.equal(second.items.length,25);assert.equal(second.next,null);
 assert.equal((await listAdminSchedules(db,{backup:true})).items.length,50);
});
