const test=require('node:test');
const assert=require('node:assert/strict');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {searchShared,getShared,saveShared,unpublishShared,collectionName,cell}=require('../lib/shared');
const app=initializeApp({projectId:'demo-garbage-notifications'});
const db=getFirestore(app);
const base={name:'検証用地区',latitude:35.68123,longitude:139.76123,rules:[{garbageType:'燃えるゴミ',schedule:'毎週',yobi:'火曜日'}]};
test('共有保存・検索・取得・更新・公開停止',async()=>{
  const saved=await saveShared(db,'alice',{...base,ownerUid:'bob',officialFlag:1});
  const stored=(await db.collection(collectionName).doc(saved.id).get()).data();
  assert.equal(stored.ownerUid,'alice');assert.equal(stored.latitude,35.68);assert.equal(stored.longitude,139.76);
  assert.equal(stored.officialFlag,undefined);
  const search=await searchShared(db,base);
  assert.equal(search.result.length,1);assert.equal(search.result[0].garbageGroupId,saved.id);
  assert.equal(search.result[0].ownerUid,undefined);assert.equal(search.result[0].rules,undefined);
  assert.deepEqual((await getShared(db,saved)).rules,base.rules);
  await saveShared(db,'alice',{...base,name:'更新'});
  assert.equal((await getShared(db,saved)).name,'更新');
  await unpublishShared(db,'alice');
  assert.equal((await searchShared(db,base)).result.length,0);
  await assert.rejects(getShared(db,saved),e=>e.code==='not-found');
  await unpublishShared(db,'alice');
});
test('隔離中・非公開・範囲外を返さない',async()=>{
  for (const [id,status,latitude] of [['quarantined','quarantined',35.68],['pending','pending-review',35.68],['far','published',36]]) {
    await db.collection(collectionName).doc(id).set({...base,latitude,status,cell:cell(latitude,base.longitude)});
    if(status!=='published') await assert.rejects(getShared(db,{id}),e=>e.code==='not-found');
  }
  assert.equal((await searchShared(db,base)).result.length,0);
});
test('既存データの所有者が異なる場合は上書き・停止を拒否',async()=>{
  const ref=db.collection(collectionName).doc('user-intruder');
  await ref.set({...base,ownerUid:'other',status:'published'});
  await assert.rejects(saveShared(db,'intruder',base),e=>e.code==='permission-denied');
  await assert.rejects(unpublishShared(db,'intruder'),e=>e.code==='permission-denied');
  assert.equal((await ref.get()).data().ownerUid,'other');
});
test('候補が多い場合は上限と打切り状態を返す',async()=>{
  const batch=db.batch();
  for(let i=0;i<60;i++) batch.set(db.collection(collectionName).doc(`many-${i}`),{...base,status:'published',cell:cell(base.latitude,base.longitude)});
  await batch.commit();
  const result=await searchShared(db,base);
  assert.equal(result.result.length,50);assert.equal(result.truncated,true);
});
test.after(async()=>{await db.terminate();await deleteApp(app);});
